import { COMMENT_ERROR, ERROR_CODE } from '../../common/constants';
import { NotificationKind } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';

/**
 * Who a comment may mention and who hears about it, as pure functions — no
 * database — so the rules are unit-tested in isolation.
 */

/**
 * Every mentioned person must be someone the caller may mention on this lead
 * (`GET /leads/:id/mentionable`): a mention notifies, so it may only reach
 * people who can open the lead.
 */
export const assertMentionsAllowed = (
  mentionIds: readonly string[],
  mentionable: ReadonlySet<string>,
): void => {
  if (mentionIds.some((id) => !mentionable.has(id))) {
    throw new BusinessException(COMMENT_ERROR.MENTION_INVALID, ERROR_CODE.VALIDATION_FAILED);
  }
};

export interface CommentAudience {
  authorId: string;
  mentionIds: readonly string[];
  /** The lead's owner, when he can open the lead; else null. */
  ownerId: string | null;
  /** Feedback: who logged the entry it is about; else null. */
  entryAuthorId: string | null;
}

export type CommentNotificationKind =
  NotificationKind.MENTION | NotificationKind.FEEDBACK | NotificationKind.COMMENT;

export interface PlannedNotification {
  userId: string;
  kind: CommentNotificationKind;
}

/**
 * One notification per person, never to the author:
 *
 *  1. each mentioned person — `mention`;
 *  2. for feedback, the entry's author unless already mentioned — `feedback`;
 *  3. the lead's owner unless already told — `comment`.
 */
export const planCommentNotifications = (audience: CommentAudience): PlannedNotification[] => {
  const planned = new Map<string, CommentNotificationKind>();
  const add = (userId: string | null, kind: CommentNotificationKind): void => {
    if (userId && userId !== audience.authorId && !planned.has(userId)) planned.set(userId, kind);
  };

  audience.mentionIds.forEach((id) => add(id, NotificationKind.MENTION));
  add(audience.entryAuthorId, NotificationKind.FEEDBACK);
  add(audience.ownerId, NotificationKind.COMMENT);

  return [...planned].map(([userId, kind]) => ({ userId, kind }));
};
