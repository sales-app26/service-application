import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AUTH_ERROR,
  COMMON_ERROR,
  ERROR_CODE,
  HTTP_HEADER,
  METADATA_KEY,
} from '../../../common/constants';
import { RequestWithUser } from '../../../common/decorators';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { User } from '../../../database/entities';
import {
  TokenFailure,
  TokenVerificationError,
  TokenVerifierService,
} from '../token-verifier.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Global authentication gate.
 *
 * Registered as an `APP_GUARD`, so every route is protected unless it opts out
 * with `@Public()` — a new endpoint cannot be left open by omission.
 *
 * The token proves who is calling; the `users` row decides whether they may.
 * Reading the row on every request is what makes PRD §5.1 hold: a user
 * deactivated while signed in is refused on their **next** action, not when
 * their token happens to expire an hour later.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifierService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(METADATA_KEY.IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers[HTTP_HEADER.AUTHORIZATION];
    const token =
      typeof header === 'string' && header.startsWith(BEARER_PREFIX)
        ? header.slice(BEARER_PREFIX.length).trim()
        : '';

    if (!token) {
      throw new BusinessException(COMMON_ERROR.UNAUTHORIZED, ERROR_CODE.UNAUTHORIZED);
    }

    let userId: string;
    try {
      ({ userId } = await this.tokenVerifier.verify(token));
    } catch (error) {
      const expired =
        error instanceof TokenVerificationError && error.failure === TokenFailure.EXPIRED;
      throw new BusinessException(
        expired ? COMMON_ERROR.TOKEN_EXPIRED : COMMON_ERROR.UNAUTHORIZED,
        ERROR_CODE.UNAUTHORIZED,
      );
    }

    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new BusinessException(AUTH_ERROR.ACCOUNT_NOT_SET_UP, ERROR_CODE.UNAUTHORIZED);
    }
    if (!user.isActive) {
      throw new BusinessException(AUTH_ERROR.ACCOUNT_DEACTIVATED, ERROR_CODE.ACCOUNT_DEACTIVATED);
    }

    request.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      accessToken: token,
    };
    return true;
  }
}
