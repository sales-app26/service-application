import { createHash, randomBytes } from 'node:crypto';

const INVITE_TOKEN_BYTES = 32;

/** The secret that goes in the invite link. Only its hash is stored. */
export const newInviteToken = (): string => randomBytes(INVITE_TOKEN_BYTES).toString('base64url');

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
