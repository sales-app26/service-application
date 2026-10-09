import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors as joseErrors,
  JWTPayload,
  jwtVerify,
} from 'jose';

import { CONFIG_NAMESPACE } from '../../common/constants';
import { SupabaseConfig } from '../../config/configuration';

/** Supabase issues user tokens for this audience. */
const SUPABASE_AUDIENCE = 'authenticated';
const HMAC_ALGORITHM = 'HS256';

export interface VerifiedToken {
  /** Supabase `auth.users.id` — equal to `users.id`. */
  userId: string;
  email?: string;
}

export enum TokenFailure {
  EXPIRED = 'expired',
  INVALID = 'invalid',
}

export class TokenVerificationError extends Error {
  constructor(readonly failure: TokenFailure) {
    super(failure);
  }
}

/**
 * Verifies Supabase access tokens locally, without a round trip per request.
 *
 * Supabase projects sign either with the legacy shared secret (HS256) or with
 * asymmetric keys published as a JWKS. The token's own header says which, so
 * both are supported: HS256 needs `SUPABASE_JWT_SECRET`; anything else is
 * checked against `/auth/v1/.well-known/jwks.json`, which `jose` caches and
 * refreshes when it meets an unknown key id.
 *
 * Issuer and audience are pinned, so a token minted by another Supabase
 * project — or a service-role key — is refused even if it is well signed.
 */
@Injectable()
export class TokenVerifierService {
  private readonly logger = new Logger(TokenVerifierService.name);
  private readonly issuer: string;
  private readonly secret?: Uint8Array;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<SupabaseConfig>(CONFIG_NAMESPACE.SUPABASE);
    this.issuer = `${config.url}/auth/v1`;
    this.secret = config.jwtSecret ? new TextEncoder().encode(config.jwtSecret) : undefined;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<VerifiedToken> {
    let payload: JWTPayload;

    try {
      const { alg } = decodeProtectedHeader(token);
      const options = { issuer: this.issuer, audience: SUPABASE_AUDIENCE };

      if (alg === HMAC_ALGORITHM) {
        if (!this.secret) {
          this.logger.error('Received an HS256 token but SUPABASE_JWT_SECRET is not set.');
          throw new TokenVerificationError(TokenFailure.INVALID);
        }
        ({ payload } = await jwtVerify(token, this.secret, {
          ...options,
          algorithms: [HMAC_ALGORITHM],
        }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, options));
      }
    } catch (error) {
      if (error instanceof TokenVerificationError) throw error;
      throw new TokenVerificationError(
        error instanceof joseErrors.JWTExpired ? TokenFailure.EXPIRED : TokenFailure.INVALID,
      );
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new TokenVerificationError(TokenFailure.INVALID);
    }

    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  }
}
