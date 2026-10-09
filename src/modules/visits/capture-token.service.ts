import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE, ERROR_CODE, VISIT_ERROR } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { VisitConfig } from '../../config/configuration';

const TOKEN_VERSION = 'v1';
const MS_PER_MINUTE = 60_000;
/** Two API instances may disagree by a little; never by this much. */
const CLOCK_SKEW_MS = 30_000;

interface CapturePayload {
  /** User id. A token is useless to anyone else. */
  u: string;
  /** Server time it was issued, epoch ms. */
  i: number;
}

export interface IssuedCaptureToken {
  captureToken: string;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * The 10-minute photo window (PRD §5.7, Assumption 4), measured on the
 * server's clock.
 *
 * The app asks for a token when the sales person taps "Take photo" and sends
 * it back with the form. A capture time from the phone could not enforce the
 * window — PRD §5.7 is explicit that a wrong or changed phone clock has no
 * effect — so the start of the window is the server's own signed timestamp.
 *
 * Stateless: an HMAC over the user id and issue time. Retaking the photo asks
 * for a fresh token, which restarts the window.
 */
@Injectable()
export class CaptureTokenService {
  private readonly secret: Buffer;
  private readonly windowMs: number;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<VisitConfig>(CONFIG_NAMESPACE.VISIT);
    this.secret = Buffer.from(config.captureTokenSecret, 'utf8');
    this.windowMs = config.captureWindowMinutes * MS_PER_MINUTE;
  }

  issue(userId: string, now: Date = new Date()): IssuedCaptureToken {
    const payload = Buffer.from(
      JSON.stringify({ u: userId, i: now.getTime() } satisfies CapturePayload),
    ).toString('base64url');
    return {
      captureToken: `${TOKEN_VERSION}.${payload}.${this.sign(payload)}`,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + this.windowMs),
    };
  }

  /** Throws unless the token was issued to this user within the window. */
  verify(token: string | undefined, userId: string, now: Date = new Date()): void {
    if (!token) {
      throw new BusinessException(
        VISIT_ERROR.CAPTURE_TOKEN_REQUIRED,
        ERROR_CODE.VISIT_PROOF_REQUIRED,
      );
    }

    const [version, payload, signature] = token.split('.');
    if (
      version !== TOKEN_VERSION ||
      !payload ||
      !signature ||
      !this.signatureMatches(payload, signature)
    ) {
      throw new BusinessException(VISIT_ERROR.CAPTURE_INVALID, ERROR_CODE.VISIT_PROOF_REQUIRED);
    }

    let parsed: CapturePayload;
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CapturePayload;
    } catch {
      throw new BusinessException(VISIT_ERROR.CAPTURE_INVALID, ERROR_CODE.VISIT_PROOF_REQUIRED);
    }

    if (parsed.u !== userId || typeof parsed.i !== 'number') {
      throw new BusinessException(VISIT_ERROR.CAPTURE_INVALID, ERROR_CODE.VISIT_PROOF_REQUIRED);
    }

    const age = now.getTime() - parsed.i;
    if (age < -CLOCK_SKEW_MS || age > this.windowMs) {
      throw new BusinessException(VISIT_ERROR.CAPTURE_EXPIRED, ERROR_CODE.CAPTURE_EXPIRED);
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  private signatureMatches(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}
