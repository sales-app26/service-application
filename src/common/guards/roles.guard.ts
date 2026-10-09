import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { COMMON_ERROR, METADATA_KEY } from '../constants';
import { RequestWithUser } from '../decorators';
import { UserRole } from '../enums';
import { ForbiddenBusinessException } from '../exceptions/business.exception';

/**
 * Enforces `@Roles(...)`. Runs after the auth guard has attached the user.
 *
 * A route with no `@Roles` passes straight through — authentication is then
 * the gate, and the service applies project scope and ownership.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(METADATA_KEY.IS_PUBLIC, targets)) {
      return true;
    }

    const allowed = this.reflector.getAllAndOverride<UserRole[]>(METADATA_KEY.ROLES, targets);
    if (!allowed?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user || !allowed.includes(user.role)) {
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }
    return true;
  }
}
