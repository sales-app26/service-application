import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

import { METADATA_KEY } from '../constants';
import { UserRole } from '../enums';

/**
 * The signed-in person, attached to the request by the auth guard after the
 * Supabase token is verified and the `users` row is confirmed active.
 */
export interface AuthenticatedUser {
  /** `users.id`, which is also the Supabase `auth.users.id`. */
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** The raw Supabase access token, for the few Auth calls made as the user. */
  accessToken: string;
}

export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** Marks a route as reachable without authentication. */
export const Public = () => SetMetadata(METADATA_KEY.IS_PUBLIC, true);

/**
 * Restricts a route to the listed roles.
 *
 * The role is only the first gate: a moderator passing this still has to be a
 * member of the project in question, which the services check (BRD §2).
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(METADATA_KEY.ROLES, roles);

/** Overrides the `message` field of the success envelope. */
export const ResponseMessage = (message: string) =>
  SetMetadata(METADATA_KEY.RESPONSE_MESSAGE, message);

/** Returns the handler's value as the raw response body, unwrapped. */
export const SkipResponseWrapper = () => SetMetadata(METADATA_KEY.SKIP_RESPONSE_WRAPPER, true);

/** Injects the authenticated user, or one of its properties. */
export const CurrentUser = createParamDecorator(
  (property: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const user = context.switchToHttp().getRequest<RequestWithUser>().user;
    return property && user ? user[property] : user;
  },
);
