import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE, ERROR_CODE } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { MailConfig } from '../../config/configuration';

const BREVO_SEND_PATH = '/v3/smtp/email';
const SEND_TIMEOUT_MS = 10_000;

export type AuthMailKind = 'invite' | 'recovery';

/**
 * The invite and password-reset emails, sent through Brevo's transactional API.
 *
 * The only way these emails go out: Supabase's own mailer is never used, so the
 * link is built from `APP_URL` and never depends on the Supabase dashboard's
 * Site URL. A send that fails throws, and the caller decides what to tell the user.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly config: MailConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<MailConfig>(CONFIG_NAMESPACE.MAIL);
  }

  async sendAuthLink(
    kind: AuthMailKind,
    to: { email: string; name?: string },
    link: string,
  ): Promise<void> {
    const copy =
      kind === 'invite'
        ? {
            subject: `You're invited to ${this.config.fromName}`,
            heading: `Welcome${to.name ? `, ${to.name}` : ''}!`,
            body: `You've been added to ${this.config.fromName}. Choose a password to sign in.`,
            button: 'Choose a password',
          }
        : {
            subject: `Reset your ${this.config.fromName} password`,
            heading: 'Reset your password',
            body: 'Someone asked to reset the password for this account. If it was you, choose a new one below. If not, you can ignore this email.',
            button: 'Choose a new password',
          };

    await this.send({
      to,
      subject: copy.subject,
      html: layout(copy.heading, copy.body, copy.button, link),
      text: `${copy.heading}\n\n${copy.body}\n\n${link}\n`,
    });
  }

  private async send(mail: {
    to: { email: string; name?: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.config.brevoApiUrl}${BREVO_SEND_PATH}`, {
        method: 'POST',
        headers: {
          'api-key': this.config.brevoApiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: this.config.fromEmail, name: this.config.fromName },
          to: [mail.to.name ? mail.to : { email: mail.to.email }],
          subject: mail.subject,
          htmlContent: mail.html,
          textContent: mail.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Brevo unreachable: ${(error as Error).message}`);
      throw unavailable();
    }
    if (!response.ok) {
      this.logger.error(
        `Brevo refused the email (HTTP ${response.status}): ${await response.text()}`,
      );
      throw unavailable();
    }
  }
}

const unavailable = (): BusinessException =>
  new BusinessException(
    'The email could not be sent. Please try again in a minute.',
    ERROR_CODE.INTEGRATION_ERROR,
    undefined,
    HttpStatus.SERVICE_UNAVAILABLE,
  );

const escape = (s: string): string =>
  s.replace(
    /[&<>"']/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * The email in Pronttera's brand: the mark (a PNG the portal serves, since mail clients don't
 * show SVG), the wordmark, and the app's action blue.
 */
function layout(heading: string, body: string, button: string, link: string): string {
  const href = escape(link);
  const logo = escape(`${new URL(link).origin}/brand/pronttera-mark.png`);
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:32px">
<tr><td><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px"><img src="${logo}" width="31" height="40" alt="Pronttera" style="display:block;border:0"></td>
<td style="font-size:20px;font-weight:700;line-height:1.2"><span style="color:#2a2a2a">Pronttera</span> <span style="color:#0a78b0">Sales</span></td>
</tr></table></td></tr>
<tr><td style="padding-top:24px;font-size:22px;font-weight:700">${escape(heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.5;color:#444">${escape(body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${href}" style="display:inline-block;background:#0a78b0;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">${escape(button)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:13px;line-height:1.5;color:#777">The link works once. If it has expired, ask for a new one. If the button doesn't work, open this address:<br><a href="${href}" style="color:#0a78b0;word-break:break-all">${href}</a></td></tr>
<tr><td style="padding-top:24px;border-top:1px solid #eee;font-size:12px;color:#999">Pronttera Sales · Made by Pronttera</td></tr>
</table></td></tr></table></body></html>`;
}
