/**
 * Who covers whom, as a pure function — no database, no clock — so the rule
 * is unit-tested in isolation and the service applies exactly one
 * implementation of it.
 */

export interface CoverageFacts {
  actorId: string;
  ownerId: string;
  /** The owner's `project_members.backup_user_id` in the lead's project. */
  ownerBackupId: string | null;
  /** The owner still works in the project (active membership). */
  ownerIsActiveMember: boolean;
  /** The owner has an active leave that includes today (IST). */
  ownerOnLeaveToday: boolean;
  /** The actor is an active member of the same project. */
  actorIsActiveMember: boolean;
}

/**
 * Actor A covers owner O in project P today when O is on leave today, O's
 * backup in P is A, and A is still an active member of P. Nobody covers
 * himself, and a leave or a backup on its own is not enough.
 */
export const isCovering = (facts: CoverageFacts): boolean =>
  facts.actorId !== facts.ownerId &&
  facts.ownerBackupId === facts.actorId &&
  facts.ownerIsActiveMember &&
  facts.ownerOnLeaveToday &&
  facts.actorIsActiveMember;
