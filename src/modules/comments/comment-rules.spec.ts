import { COMMENT_ERROR, ERROR_CODE } from '../../common/constants';
import { NotificationKind } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { assertMentionsAllowed, planCommentNotifications } from './comment-rules';

describe('assertMentionsAllowed', () => {
  const mentionable = new Set(['owner', 'moderator']);

  it('accepts nobody, or people from the mentionable list', () => {
    expect(() => assertMentionsAllowed([], mentionable)).not.toThrow();
    expect(() => assertMentionsAllowed(['owner', 'moderator'], mentionable)).not.toThrow();
  });

  it('refuses anyone else as a validation error', () => {
    let caught: unknown;
    try {
      assertMentionsAllowed(['owner', 'stranger'], mentionable);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BusinessException);
    expect((caught as BusinessException).errorCode).toBe(ERROR_CODE.VALIDATION_FAILED);
    expect((caught as BusinessException).message).toBe(COMMENT_ERROR.MENTION_INVALID);
  });
});

describe('planCommentNotifications', () => {
  it('tells each mentioned person, then the owner, never the author', () => {
    expect(
      planCommentNotifications({
        authorId: 'author',
        mentionIds: ['moderator', 'author'],
        ownerId: 'owner',
        entryAuthorId: null,
      }),
    ).toEqual([
      { userId: 'moderator', kind: NotificationKind.MENTION },
      { userId: 'owner', kind: NotificationKind.COMMENT },
    ]);
  });

  it('does not tell a mentioned owner twice, nor an owner who wrote it', () => {
    expect(
      planCommentNotifications({
        authorId: 'author',
        mentionIds: ['owner'],
        ownerId: 'owner',
        entryAuthorId: null,
      }),
    ).toEqual([{ userId: 'owner', kind: NotificationKind.MENTION }]);
    expect(
      planCommentNotifications({
        authorId: 'owner',
        mentionIds: [],
        ownerId: 'owner',
        entryAuthorId: null,
      }),
    ).toEqual([]);
  });

  it('tells the entry’s author about feedback, once, before the owner', () => {
    expect(
      planCommentNotifications({
        authorId: 'admin',
        mentionIds: [],
        ownerId: 'owner',
        entryAuthorId: 'owner',
      }),
    ).toEqual([{ userId: 'owner', kind: NotificationKind.FEEDBACK }]);
    expect(
      planCommentNotifications({
        authorId: 'admin',
        mentionIds: [],
        ownerId: 'owner',
        entryAuthorId: 'backup',
      }),
    ).toEqual([
      { userId: 'backup', kind: NotificationKind.FEEDBACK },
      { userId: 'owner', kind: NotificationKind.COMMENT },
    ]);
  });

  it('skips an owner who cannot open the lead', () => {
    expect(
      planCommentNotifications({
        authorId: 'admin',
        mentionIds: [],
        ownerId: null,
        entryAuthorId: null,
      }),
    ).toEqual([]);
  });
});
