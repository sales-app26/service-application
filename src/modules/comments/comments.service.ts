import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import {
  COMMENT_ERROR,
  DB_CONSTRAINT,
  ERROR_CODE,
  NOTIFICATION_LINK,
  NOTIFICATION_TEXT,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { CommentKind, NotificationKind, ProjectStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { istDateOf, isUniqueViolation, leadLabel } from '../../common/utils';
import { FollowUp, Lead, LeadComment, ProjectMember, User } from '../../database/entities';
import { CoverageService } from '../access/coverage.service';
import { ProjectAccessService } from '../access/project-access.service';
import { PersonRefDto } from '../leads/dto/entry.dto';
import { LeadAccessService, LeadVisibility } from '../leads/lead-access.service';
import {
  NotificationInput,
  NotificationSenderService,
} from '../notifications/notification-sender.service';
import { assertMentionsAllowed, planCommentNotifications } from './comment-rules';
import { CommentDto, CreateCommentDto, HelpRequestDto, UpdateCommentDto } from './dto/comment.dto';

/** A lead the caller may see, and how. */
interface VisibleLead {
  lead: Lead;
  visibility: LeadVisibility;
}

/**
 * Comments on a lead: plain comments with mentions, an admin's feedback on one
 * entry, help requests to the project's moderators, and the handover notes
 * transfers write.
 *
 * Whoever may open the lead — its owner, the project's admins, the backup
 * covering for the owner — may read and write its comments; nobody else
 * learns they exist (404). Notifications go only to people who can open the
 * lead, so they never carry a comment to someone who could not read it.
 */
@Injectable()
export class CommentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(LeadComment) private readonly comments: Repository<LeadComment>,
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly coverage: CoverageService,
    private readonly leadAccess: LeadAccessService,
    private readonly notifications: NotificationSenderService,
  ) {}

  // -------------------------------------------------------------------- reads

  /** Every live comment on the lead, oldest first. */
  async list(actor: AuthenticatedUser, leadId: string): Promise<CommentDto[]> {
    const target = await this.visibleLead(actor, leadId);
    const rows = await this.comments.find({
      where: { leadId, deletedAt: IsNull() },
      relations: { user: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return this.present(rows, actor, target);
  }

  /**
   * Who the caller may mention on this lead: its owner, the project's active
   * moderators and — while the owner is on leave — the backup covering for
   * him. Active people who can open the lead, never the caller.
   */
  async mentionable(actor: AuthenticatedUser, leadId: string): Promise<PersonRefDto[]> {
    const { lead } = await this.visibleLead(actor, leadId);
    return this.mentionablePeople(actor, lead);
  }

  // ------------------------------------------------------------------- writes

  async create(
    actor: AuthenticatedUser,
    leadId: string,
    dto: CreateCommentDto,
  ): Promise<CommentDto> {
    const target = await this.visibleLead(actor, leadId);
    const { lead, visibility } = target;
    this.access.assertWritable(lead.project);

    const kind = dto.kind ?? CommentKind.COMMENT;
    if (dto.pinned && !mayPin(visibility)) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.PIN_NOT_ALLOWED);
    }
    if (kind === CommentKind.FEEDBACK) {
      if (!visibility.isAdmin) {
        throw new ForbiddenBusinessException(COMMENT_ERROR.FEEDBACK_ADMIN_ONLY);
      }
      if (!dto.entryId) {
        throw new BusinessException(
          COMMENT_ERROR.FEEDBACK_NEEDS_ENTRY,
          ERROR_CODE.VALIDATION_FAILED,
        );
      }
    }

    const entry = dto.entryId
      ? await this.followUps.findOne({
          where: { id: dto.entryId, leadId, deletedAt: IsNull() },
          relations: { user: true },
        })
      : null;
    if (dto.entryId && !entry) {
      throw new BusinessException(COMMENT_ERROR.ENTRY_NOT_ON_LEAD, ERROR_CODE.VALIDATION_FAILED);
    }

    const mentionIds = dto.mentionIds ?? [];
    if (mentionIds.length > 0) {
      const mentionable = await this.mentionablePeople(actor, lead);
      assertMentionsAllowed(mentionIds, new Set(mentionable.map((person) => person.id)));
    }

    // An unassigned lead has no owner to tell.
    const ownerSees = lead.owner ? await this.leadAccess.canUserSee(lead.owner, lead) : false;
    const planned = planCommentNotifications({
      authorId: actor.id,
      mentionIds,
      ownerId: ownerSees ? lead.ownerId : null,
      entryAuthorId: kind === CommentKind.FEEDBACK && entry?.user.isActive ? entry.userId : null,
    });
    const link = NOTIFICATION_LINK.LEAD(lead.id);
    const items: NotificationInput[] = planned.map(({ userId, kind: notificationKind }) => ({
      userId,
      kind: notificationKind,
      leadId: lead.id,
      body: dto.body,
      ...(notificationKind === NotificationKind.MENTION
        ? { title: NOTIFICATION_TEXT.MENTION_TITLE(actor.name, leadLabel(lead)), link }
        : notificationKind === NotificationKind.FEEDBACK
          ? {
              title: NOTIFICATION_TEXT.FEEDBACK_TITLE(actor.name, leadLabel(lead)),
              link: NOTIFICATION_LINK.DAY(istDateOf(entry!.createdAt)),
            }
          : { title: NOTIFICATION_TEXT.COMMENT_TITLE(actor.name, leadLabel(lead)), link }),
    }));

    const commentId = await this.dataSource.transaction(async (manager) => {
      await this.access.lockOpenProject(manager, lead.projectId);
      const saved = await manager.save(
        manager.create(LeadComment, {
          leadId: lead.id,
          projectId: lead.projectId,
          userId: actor.id,
          entryId: entry?.id ?? null,
          kind,
          body: dto.body,
          mentionIds,
          pinned: dto.pinned ?? false,
        }),
      );
      await this.notifications.send(manager, actor.id, items);
      return saved.id;
    });

    return this.presentOne(commentId, actor, target);
  }

  /** The author edits the text; the lead's owner or an admin pins and unpins. */
  async update(
    actor: AuthenticatedUser,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentDto> {
    if (dto.body === undefined && dto.pinned === undefined) {
      throw new BusinessException(COMMENT_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }
    const { comment, target } = await this.visibleComment(actor, commentId);

    if (dto.body !== undefined && comment.userId !== actor.id) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.ONLY_AUTHOR_EDITS);
    }
    if (dto.pinned !== undefined && !mayPin(target.visibility)) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.PIN_NOT_ALLOWED);
    }
    this.access.assertWritable(target.lead.project);

    await this.comments.update(
      { id: comment.id, deletedAt: IsNull() },
      {
        ...(dto.body !== undefined ? { body: dto.body, editedAt: new Date() } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
    );
    return this.presentOne(comment.id, actor, target);
  }

  /** Soft delete, by the author or the Super Admin. */
  async remove(actor: AuthenticatedUser, commentId: string): Promise<void> {
    const { comment } = await this.visibleComment(actor, commentId);
    if (comment.userId !== actor.id && !this.access.isSuperAdmin(actor)) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.ONLY_AUTHOR_DELETES);
    }
    await this.comments.update({ id: comment.id, deletedAt: IsNull() }, { deletedAt: new Date() });
  }

  /**
   * The owner, or the backup covering for him, asks the project's moderators
   * for help: a `help` comment mentioning every active moderator of the
   * project, each notified. One open help request per lead.
   */
  async requestHelp(
    actor: AuthenticatedUser,
    leadId: string,
    dto: HelpRequestDto,
  ): Promise<CommentDto> {
    const target = await this.visibleLead(actor, leadId);
    const { lead, visibility } = target;
    if (!(visibility.isOwner && visibility.isMember) && !visibility.isCovering) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.HELP_NOT_ALLOWED);
    }
    this.access.assertWritable(lead.project);
    await this.assertNoOpenHelp(lead.id);

    const moderators = (await this.dataSource.query(
      `SELECT u.id
         FROM ${SQL_TABLE.USERS} u
         JOIN ${SQL_TABLE.PROJECT_MEMBERS} pm
           ON pm.user_id = u.id AND pm.project_id = $1 AND pm.is_active
        WHERE u.role = $2 AND u.is_active AND u.deleted_at IS NULL AND u.id <> $3
        ORDER BY u.name`,
      [lead.projectId, UserRole.MODERATOR, actor.id],
    )) as Array<{ id: string }>;
    const mentionIds = moderators.map((row) => row.id);

    let commentId: string;
    try {
      commentId = await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, lead.projectId);
        const saved = await manager.save(
          manager.create(LeadComment, {
            leadId: lead.id,
            projectId: lead.projectId,
            userId: actor.id,
            kind: CommentKind.HELP,
            body: dto.body,
            mentionIds,
          }),
        );
        await this.notifications.send(
          manager,
          actor.id,
          mentionIds.map((userId) => ({
            userId,
            kind: NotificationKind.HELP_REQUESTED,
            title: NOTIFICATION_TEXT.HELP_REQUESTED_TITLE(actor.name, leadLabel(lead)),
            body: dto.body,
            link: NOTIFICATION_LINK.LEAD(lead.id),
            leadId: lead.id,
          })),
        );
        return saved.id;
      });
    } catch (error) {
      // Two help requests at the same moment: the first one stands.
      if (isUniqueViolation(error, DB_CONSTRAINT.LEAD_COMMENTS_ONE_OPEN_HELP)) {
        throw new ConflictBusinessException(COMMENT_ERROR.HELP_OPEN);
      }
      throw error;
    }

    return this.presentOne(commentId, actor, target);
  }

  /** An admin of the project, or whoever asked, marks a help request resolved. */
  async resolve(actor: AuthenticatedUser, commentId: string): Promise<CommentDto> {
    const { comment, target } = await this.visibleComment(actor, commentId);
    const { lead, visibility } = target;

    if (comment.kind !== CommentKind.HELP) {
      throw new BusinessException(COMMENT_ERROR.NOT_HELP, ERROR_CODE.UNPROCESSABLE);
    }
    if (comment.resolvedAt) {
      throw new ConflictBusinessException(COMMENT_ERROR.ALREADY_RESOLVED);
    }
    if (!visibility.isAdmin && comment.userId !== actor.id) {
      throw new ForbiddenBusinessException(COMMENT_ERROR.RESOLVE_NOT_ALLOWED);
    }
    this.access.assertWritable(lead.project);

    const authorSees = await this.leadAccess.canUserSee(comment.user, lead);
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(
        LeadComment,
        { id: comment.id, resolvedAt: IsNull(), deletedAt: IsNull() },
        { resolvedAt: new Date(), resolvedBy: actor.id },
      );
      if (!result.affected) {
        throw new ConflictBusinessException(COMMENT_ERROR.ALREADY_RESOLVED);
      }
      if (authorSees) {
        await this.notifications.send(manager, actor.id, [
          {
            userId: comment.userId,
            kind: NotificationKind.HELP_RESOLVED,
            title: NOTIFICATION_TEXT.HELP_RESOLVED_TITLE(actor.name, leadLabel(lead)),
            link: NOTIFICATION_LINK.LEAD(lead.id),
            leadId: lead.id,
          },
        ]);
      }
    });

    return this.presentOne(comment.id, actor, target);
  }

  // ------------------------------------------------------------------ helpers

  private async visibleLead(actor: AuthenticatedUser, leadId: string): Promise<VisibleLead> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    const visibility = await this.leadAccess.assertVisible(actor, lead);
    return { lead, visibility };
  }

  /** A live comment on a lead the caller may see; 404 for anything else. */
  private async visibleComment(
    actor: AuthenticatedUser,
    commentId: string,
  ): Promise<{ comment: LeadComment; target: VisibleLead }> {
    const comment = await this.comments.findOne({
      where: { id: commentId, deletedAt: IsNull() },
      relations: { user: true },
    });
    if (!comment) {
      throw new NotFoundBusinessException(COMMENT_ERROR.NOT_FOUND);
    }
    try {
      return { comment, target: await this.visibleLead(actor, comment.leadId) };
    } catch (error) {
      if (error instanceof BusinessException) {
        throw new NotFoundBusinessException(COMMENT_ERROR.NOT_FOUND);
      }
      throw error;
    }
  }

  private async assertNoOpenHelp(leadId: string): Promise<void> {
    const open = await this.comments.exists({
      where: { leadId, kind: CommentKind.HELP, resolvedAt: IsNull(), deletedAt: IsNull() },
    });
    if (open) {
      throw new ConflictBusinessException(COMMENT_ERROR.HELP_OPEN);
    }
  }

  private async mentionablePeople(actor: AuthenticatedUser, lead: Lead): Promise<PersonRefDto[]> {
    // An unassigned lead has no owner, so no backup covering for one: its admins only.
    const ownerId = lead.ownerId;
    const ownerMembership = ownerId
      ? await this.members.findOne({ where: { projectId: lead.projectId, userId: ownerId } })
      : null;
    const backupId = ownerMembership?.backupUserId ?? null;
    const coveringBackup =
      backupId && ownerId && (await this.coverage.covers(backupId, ownerId, lead.projectId))
        ? backupId
        : null;

    return (await this.dataSource.query(
      `SELECT u.id, u.name
         FROM ${SQL_TABLE.USERS} u
        WHERE u.is_active AND u.deleted_at IS NULL AND u.id <> $1
          AND EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                       WHERE pm.project_id = $2 AND pm.user_id = u.id AND pm.is_active)
          AND (u.id = $3::uuid OR u.role = $4 OR u.id = $5::uuid)
        ORDER BY u.name`,
      [actor.id, lead.projectId, lead.ownerId, UserRole.MODERATOR, coveringBackup],
    )) as PersonRefDto[];
  }

  private async presentOne(
    commentId: string,
    actor: AuthenticatedUser,
    target: VisibleLead,
  ): Promise<CommentDto> {
    const row = await this.comments.findOneOrFail({
      where: { id: commentId },
      relations: { user: true },
    });
    const [dto] = await this.present([row], actor, target);
    return dto;
  }

  private async present(
    rows: LeadComment[],
    actor: AuthenticatedUser,
    { lead, visibility }: VisibleLead,
  ): Promise<CommentDto[]> {
    const ids = new Set<string>();
    rows.forEach((row) => {
      row.mentionIds.forEach((id) => ids.add(id));
      if (row.resolvedBy) ids.add(row.resolvedBy);
    });
    const people =
      ids.size > 0
        ? await this.users
            .createQueryBuilder('u')
            .select(['u.id', 'u.name'])
            .where('u.id IN (:...ids)', { ids: [...ids] })
            .getMany()
        : [];
    const byId = new Map(people.map((person) => [person.id, { id: person.id, name: person.name }]));

    const open = lead.project.status === ProjectStatus.ACTIVE;
    const isSuperAdmin = this.access.isSuperAdmin(actor);

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      user: { id: row.user.id, name: row.user.name },
      mentions: row.mentionIds
        .map((id) => byId.get(id))
        .filter((person): person is PersonRefDto => person !== undefined),
      pinned: row.pinned,
      entryId: row.entryId,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy ? (byId.get(row.resolvedBy) ?? null) : null,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      canEdit: open && row.userId === actor.id,
      canDelete: row.userId === actor.id || isSuperAdmin,
      canPin: open && mayPin(visibility),
      canResolve:
        open &&
        row.kind === CommentKind.HELP &&
        row.resolvedAt === null &&
        (visibility.isAdmin || row.userId === actor.id),
    }));
  }
}

/** The lead's owner, while he works in the project, or an admin of it. */
const mayPin = (visibility: LeadVisibility): boolean =>
  (visibility.isOwner && visibility.isMember) || visibility.isAdmin;
