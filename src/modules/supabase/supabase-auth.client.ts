import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AUTH_ERROR, CONFIG_NAMESPACE, ERROR_CODE } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { SupabaseConfig } from '../../config/configuration';

/** The session Supabase returns from the token endpoints. */
export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email?: string };
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
}

/** Why a Supabase call failed, reduced to what the callers branch on. */
export enum SupabaseFailure {
  /** 400/401/403/422 — the credentials, token or request were refused. */
  REJECTED = 'rejected',
  /** The email is already registered in `auth.users`. */
  EMAIL_EXISTS = 'email_exists',
  RATE_LIMITED = 'rate_limited',
  /** Network error, timeout or 5xx — not the caller's fault. */
  UNAVAILABLE = 'unavailable',
}

export class SupabaseCallError extends Error {
  constructor(
    readonly failure: SupabaseFailure,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface SupabaseErrorBody {
  error?: string;
  error_code?: string;
  error_description?: string;
  msg?: string;
  message?: string;
}

const EMAIL_EXISTS_CODES = new Set(['email_exists', 'user_already_exists']);

/**
 * Supabase Auth (GoTrue) over its REST API.
 *
 * Plain `fetch` rather than the JS SDK, as in the Frostique service: the API
 * needs a dozen endpoints, no realtime and no session storage, and the SDK's
 * client-side session handling is exactly what a server must not have.
 *
 * Two kinds of call:
 *  - **as the user** (`apikey` = anon key): password and refresh grants, the
 *    recovery email, setting a password with a link's token, logout.
 *  - **as the service** (`apikey` + bearer = service-role key): inviting a new
 *    user, changing an email, deleting a half-created account.
 */
@Injectable()
export class SupabaseAuthClient {
  private readonly logger = new Logger(SupabaseAuthClient.name);
  private readonly config: SupabaseConfig;

  constructor(configService: ConfigService) {
    this.config = configService.getOrThrow<SupabaseConfig>(CONFIG_NAMESPACE.SUPABASE);
  }

  // ---------------------------------------------------------------- as the user

  signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
    return this.call<SupabaseSession>('POST', '/token?grant_type=password', {
      key: this.config.anonKey,
      body: { email, password },
    });
  }

  refresh(refreshToken: string): Promise<SupabaseSession> {
    return this.call<SupabaseSession>('POST', '/token?grant_type=refresh_token', {
      key: this.config.anonKey,
      body: { refresh_token: refreshToken },
    });
  }

  /** Sends the reset email. Supabase answers 200 for unknown emails too. */
  async sendRecoveryEmail(email: string): Promise<void> {
    await this.call('POST', `/recover${this.redirectQuery()}`, {
      key: this.config.anonKey,
      body: { email },
    });
  }

  /** Sets the password of the user a recovery or invite link signed in. */
  async setPasswordWithToken(accessToken: string, password: string): Promise<void> {
    await this.call('PUT', '/user', {
      key: this.config.anonKey,
      bearer: accessToken,
      body: { password },
    });
  }

  /** Revokes this device's refresh token. */
  async signOut(accessToken: string): Promise<void> {
    await this.call('POST', '/logout?scope=local', {
      key: this.config.anonKey,
      bearer: accessToken,
    });
  }

  // ------------------------------------------------------------- as the service

  /**
   * Creates the login and emails a link to set the password (PRD §5.2).
   * The returned id becomes `users.id`.
   */
  inviteUser(email: string, name: string): Promise<SupabaseAuthUser> {
    return this.call<SupabaseAuthUser>('POST', `/invite${this.redirectQuery()}`, {
      key: this.config.serviceRoleKey,
      bearer: this.config.serviceRoleKey,
      body: { email, data: { name } },
    });
  }

  /** Seeding only: a confirmed login with a known password. */
  createConfirmedUser(email: string, password: string, name: string): Promise<SupabaseAuthUser> {
    return this.call<SupabaseAuthUser>('POST', '/admin/users', {
      key: this.config.serviceRoleKey,
      bearer: this.config.serviceRoleKey,
      body: { email, password, email_confirm: true, user_metadata: { name } },
    });
  }

  async updateUserAsAdmin(
    userId: string,
    changes: { email?: string; password?: string },
  ): Promise<void> {
    await this.call('PUT', `/admin/users/${encodeURIComponent(userId)}`, {
      key: this.config.serviceRoleKey,
      bearer: this.config.serviceRoleKey,
      body: { ...changes, ...(changes.email ? { email_confirm: true } : {}) },
    });
  }

  /** Best effort: used only to undo a login whose `users` row failed to save. */
  async deleteUserAsAdmin(userId: string): Promise<void> {
    try {
      await this.call('DELETE', `/admin/users/${encodeURIComponent(userId)}`, {
        key: this.config.serviceRoleKey,
        bearer: this.config.serviceRoleKey,
      });
    } catch (error) {
      this.logger.error(
        `Could not remove orphaned auth user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------------ plumbing

  /**
   * Maps a failure the caller did not specifically handle onto the API's
   * error envelope — a Supabase outage reads as "try again", never as "your
   * password is wrong".
   */
  static toBusinessException(error: unknown): BusinessException {
    if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.RATE_LIMITED) {
      return new BusinessException(
        'Too many attempts. Please wait a minute and try again.',
        ERROR_CODE.RATE_LIMITED,
      );
    }
    return new BusinessException(
      AUTH_ERROR.AUTH_UNAVAILABLE,
      ERROR_CODE.INTEGRATION_ERROR,
      undefined,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private redirectQuery(): string {
    return this.config.authRedirectUrl
      ? `?redirect_to=${encodeURIComponent(this.config.authRedirectUrl)}`
      : '';
  }

  private async call<T = unknown>(
    method: string,
    path: string,
    options: { key: string; bearer?: string; body?: unknown },
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.config.url}/auth/v1${path}`, {
        method,
        headers: {
          apikey: options.key,
          'Content-Type': 'application/json',
          ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      this.logger.error(
        `Supabase Auth ${method} ${path.split('?')[0]} failed: ${(error as Error).message}`,
      );
      throw new SupabaseCallError(SupabaseFailure.UNAVAILABLE, 0, 'Supabase Auth unreachable');
    }

    const text = await response.text();
    const payload = text
      ? (safeJson(text) as T & SupabaseErrorBody)
      : ({} as T & SupabaseErrorBody);

    if (response.ok) {
      return payload;
    }

    const code = payload.error_code ?? payload.error ?? '';
    const message =
      payload.msg ?? payload.error_description ?? payload.message ?? `HTTP ${response.status}`;

    if (EMAIL_EXISTS_CODES.has(code) || /already (been )?registered/iu.test(message)) {
      throw new SupabaseCallError(SupabaseFailure.EMAIL_EXISTS, response.status, message);
    }
    if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
      throw new SupabaseCallError(SupabaseFailure.RATE_LIMITED, response.status, message);
    }
    if (response.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Supabase Auth ${method} ${path.split('?')[0]} -> ${response.status}: ${message}`,
      );
      throw new SupabaseCallError(SupabaseFailure.UNAVAILABLE, response.status, message);
    }
    // The API key itself was refused — rotated or disabled in the dashboard.
    // That is our misconfiguration, not the caller's: telling them "email or
    // password is incorrect" would send them to reset a password that is fine.
    if (isApiKeyRejection(response.status, message)) {
      this.logger.error(
        `Supabase rejected the API key (${message}). Check SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — the key may have been rotated or disabled.`,
      );
      throw new SupabaseCallError(SupabaseFailure.UNAVAILABLE, response.status, message);
    }

    throw new SupabaseCallError(SupabaseFailure.REJECTED, response.status, message);
  }
}

/**
 * Supabase's gateway answers 401 with "Unregistered API key" or "Invalid API
 * key" when the `apikey` header is wrong — distinct from a refused login,
 * which comes back as 400 from Auth itself.
 */
const isApiKeyRejection = (status: number, message: string): boolean =>
  status === HttpStatus.UNAUTHORIZED && /api key/iu.test(message);

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};
