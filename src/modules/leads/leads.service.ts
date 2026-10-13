import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import {
  AUTO_REJECT_REASON,
  BUSINESS_RULE,
  COVER_ERROR,
  DB_CONSTRAINT,
  ERROR_CODE,
  LEAD_ERROR,
  PROJECT_ERROR,
  SORT_ORDER,
  SortDirection,
  SQL_TABLE,
  TERMINAL_STATUSES,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import {
  CommentKind,
  EntryType,
  LeadDue,
  LeadStatus,
  ProjectStatus,
  TransferStatus,
  UserRole,
} from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import {
  addDays,
  escapeLike,
  isUniqueViolation,
  istToday,
  normaliseIndianMobile,
  phoneSearchDigits,
} from '../../common/utils';
import { FollowUp, Lead, LeadComment, LeadTransfer, User } from '../../database/entities';
import { CoverageService } from '../access/coverage.service';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationsService } from '../locations/locations.service';
import { TransferRejectionsService } from '../transfers/transfer-rejections.service';
import { StoredVisitProof, VisitProofService } from '../visits/visit-proof.service';
import { EntryDto, ListEntriesQueryDto } from './dto/entry.dto';
import {
  BulkDeleteLeadsDto,
  BulkDeleteResultDto,
  CreateLeadDto,
  LeadDetailDto,
  LeadPermissionsDto,
  LeadSummaryDto,
  LeadSort,
  LeadTransferRefDto,
  ListLeadsQueryDto,
  PinnedCommentDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { EntryPresenter } from './entry.presenter';
import { LeadAccessService, LeadVisibility } from './lead-access.service';
import { coldSince, resolveNextFollowUpDate, resolveReason } from './lead-rules';
import { LeadPresenter } from './lead.presenter';

interface UploadedPhoto {
  buffer: Buffer;
}

const SORT: Record<LeadSort, { column: string; direction: SortDirection }> = {
  updated: { column: 'l.updatedAt', direction: SORT_ORDER.DESC },
  created: { column: 'l.createdAt', direction: SORT_ORDER.DESC },
  name: { column: 'l.name', direction: SORT_ORDER.ASC },
  next_follow_up: { column: 'l.nextFollowUpDate', direction: SORT_ORDER.ASC },
  value: { column: 'l.dealValue', direction: SORT_ORDER.DESC },
  // Longest untouched first.
  activity: { column: 'l.lastActivityAt', direction: SORT_ORDER.ASC },
};

/**
 * Leads (PRD §5.5): one client in one project, one owner, unique by phone
 * within the project. A lead is born with its first follow-up in the same
 * transaction, so every lead has a history from its first second.
 */
@Injectable()
export class LeadsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    @InjectRepository(LeadTransfer) private readonly transfers: Repository<LeadTransfer>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LeadComment) private readonly comments: Repository<LeadComment>,
    private readonly access: ProjectAccessService,
    private readonly coverage: CoverageService,
    private readonly leadAccess: LeadAccessService,
    private readonly locations: LocationsService,
    private readonly visitProof: VisitProofService,
    private readonly leadPresenter: LeadPresenter,
    private readonly entryPresenter: EntryPresenter,
    private readonly transferRejections: TransferRejectionsService,
  ) {}

  // ------------------------------------------------------------------- create

  /**
   * PRD §7.1. Order matters:
   *
   *  1. A retry of a request that already saved returns that lead.
   *  2. Everything checkable without side effects — membership, open project,
   *     phone, location, status rules, visit proof — so a refused form never
   *     uploads a photo.
   *  3. The photo is stamped and uploaded *outside* the transaction (it takes
   *     seconds on mobile data and must not hold a row lock).
   *  4. One transaction writes the location, the lead and its first entry.
   *     If it fails for any reason, the uploaded photo is removed.
   */
  async create(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateLeadDto,
    photo?: UploadedPhoto,
  ): Promise<LeadDetailDto> {
    const replay = await this.leadAccess.findReplay(dto.clientRequestId, actor.id);
    if (replay) {
      return this.findDetail(actor, replay.leadId);
    }

    const project = await this.access.assertWorker(actor, projectId);
    this.access.assertWritable(project);

    const phone = this.normalisePhone(dto.phone);
    await this.assertPhoneFree(projectId, phone, actor.id, { offerRequest: true });
    const locationName = this.locations.normaliseName(dto.location);

    const now = new Date();
    const nextFollowUpDate = resolveNextFollowUpDate(
      dto.status,
      dto.nextFollowUpDate,
      istToday(now),
    );
    const reason = resolveReason(dto.status, dto.reason);
    const needsProof = this.visitProof.requiresProof(project.type);
    const proofInput = { ...dto, photo };
    if (needsProof) {
      this.visitProof.validate(proofInput, actor, now);
    }

    const leadId = randomUUID();
    const entryId = randomUUID();
    let proof: StoredVisitProof | null = null;

    try {
      if (needsProof) {
        proof = await this.visitProof.store(proofInput, {
          projectId,
          entryId,
          createdAt: now,
          personName: actor.name,
        });
      }

      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, projectId);
        if (!(await this.access.isActiveMember(projectId, actor.id, manager))) {
          throw new NotFoundBusinessException(PROJECT_ERROR.NOT_FOUND);
        }

        const location = await this.locations.findOrCreate(
          manager,
          projectId,
          locationName,
          actor.id,
        );
        const converted = dto.status === LeadStatus.CONVERTED;

        await manager.insert(Lead, {
          id: leadId,
          projectId,
          ownerId: actor.id,
          name: dto.name,
          businessName: dto.businessName ?? null,
          phone,
          locationId: location.id,
          notes: dto.notes ?? null,
          status: dto.status,
          nextFollowUpDate,
          convertedAt: converted ? now : null,
          convertedBy: converted ? actor.id : null,
          dealValue: dto.dealValue ?? null,
          plan: dto.plan ?? null,
          source: dto.source ?? null,
          createdBy: actor.id,
          lastActivityAt: now,
        });

        await manager.insert(FollowUp, {
          id: entryId,
          leadId,
          projectId,
          userId: actor.id,
          entryType: EntryType.FOLLOW_UP,
          status: dto.status,
          note: dto.note,
          reason,
          nextFollowUpDate,
          locationId: location.id,
          photoPath: proof?.photoPath ?? null,
          latitude: proof?.latitude ?? null,
          longitude: proof?.longitude ?? null,
          gpsAccuracyM: proof?.gpsAccuracyM ?? null,
          placeName: proof?.placeName ?? null,
          captureTokenHash: proof?.captureTokenHash ?? null,
          clientRequestId: dto.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      await this.visitProof.discard(proof);

      if (
        isUniqueViolation(error, DB_CONSTRAINT.FOLLOW_UPS_CLIENT_REQUEST) ||
        this.visitProof.isTokenReuse(error)
      ) {
        const saved = await this.leadAccess.findReplay(dto.clientRequestId, actor.id);
        if (saved) return this.findDetail(actor, saved.leadId);
      }
      if (this.visitProof.isTokenReuse(error)) throw this.visitProof.tokenReuseError();
      // Two people adding the same phone at the same moment: the first save
      // wins and the second gets the same message it would have had a second
      // later (PRD §5.5).
      if (isUniqueViolation(error, DB_CONSTRAINT.LEADS_PROJECT_PHONE)) {
        await this.assertPhoneFree(projectId, phone, actor.id, { offerRequest: true });
      }
      throw error;
    }

    return this.findDetail(actor, leadId);
  }

  // -------------------------------------------------------------------- reads

  /**
   * A sales person sees only leads he owns. Admins see every lead in the
   * project and can filter by owner or by "owner unavailable". A backup
   * covering for an owner on leave asks for that owner's leads with
   * `coveringFor`.
   */
  async list(
    actor: AuthenticatedUser,
    projectId: string,
    query: ListLeadsQueryDto,
  ): Promise<PaginatedResponseDto<LeadSummaryDto>> {
    await this.access.assertCanView(actor, projectId);
    const isAdmin = await this.access.isAdminOf(actor, projectId);
    if (
      query.coveringFor &&
      !(await this.coverage.covers(actor.id, query.coveringFor, projectId))
    ) {
      throw new ForbiddenBusinessException(COVER_ERROR.NOT_COVERING);
    }

    const qb = this.leads
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.owner', 'owner')
      .leftJoinAndSelect('l.location', 'location')
      .where('l.project_id = :projectId', { projectId })
      .andWhere('l.deleted_at IS NULL');

    if (query.coveringFor) {
      qb.andWhere('l.owner_id = :coveredOwner', { coveredOwner: query.coveringFor });
    } else if (!isAdmin || query.mine) {
      qb.andWhere('l.owner_id = :me', { me: actor.id });
    } else if (query.ownerId) {
      qb.andWhere('l.owner_id = :ownerId', { ownerId: query.ownerId });
    }

    if (isAdmin && query.ownerUnavailable) {
      qb.andWhere(
        `(owner.is_active = false OR NOT EXISTS (
            SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
             WHERE pm.project_id = l.project_id AND pm.user_id = l.owner_id AND pm.is_active))`,
      );
    }

    if (query.status) {
      qb.andWhere('l.status = :status', { status: query.status });
    }

    if (query.source) {
      qb.andWhere('l.source = :source', { source: query.source });
    }

    if (query.due) {
      this.whereDue(qb, query.due, istToday());
    }

    if (query.cold) {
      qb.andWhere('l.status NOT IN (:...terminal)', { terminal: TERMINAL_STATUSES }).andWhere(
        'l.last_activity_at < :coldBefore',
        { coldBefore: coldSince(new Date()) },
      );
    }

    if (query.search) {
      const term = `%${escapeLike(query.search.toLowerCase())}%`;
      const digits = phoneSearchDigits(query.search);
      qb.andWhere(
        new Brackets((inner) => {
          inner
            .where('lower(l.name) LIKE :term', { term })
            .orWhere("lower(coalesce(l.business_name, '')) LIKE :term", { term });
          if (digits) {
            inner.orWhere('l.phone LIKE :digits', { digits: `%${digits}%` });
          }
        }),
      );
    }

    const sort = SORT[query.sort ?? 'updated'];
    qb.orderBy(sort.column, sort.direction, 'NULLS LAST')
      .addOrderBy('l.id', 'ASC')
      .skip(query.skip)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    const items = await this.leadPresenter.summaries(rows, { showOwnerTags: isAdmin });
    return PaginatedResponseDto.from([items, total], query.page, query.limit);
  }

  async findDetail(actor: AuthenticatedUser, leadId: string): Promise<LeadDetailDto> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    const visibility = await this.leadAccess.assertVisible(actor, lead);

    const [summary] = await this.leadPresenter.summaries([lead], {
      showOwnerTags: visibility.isAdmin,
    });
    const [entries, entryCount, pending, lastDecided, convertedBy, comments] = await Promise.all([
      this.followUps.find({
        where: { leadId, deletedAt: IsNull() },
        relations: { user: true, location: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: BUSINESS_RULE.LEAD_DETAIL_RECENT_ENTRIES,
      }),
      this.followUps.count({ where: { leadId, deletedAt: IsNull() } }),
      this.transfers.findOne({
        where: { leadId, status: TransferStatus.PENDING },
        relations: { toUser: true },
      }),
      this.transfers.findOne({
        where: {
          leadId,
          fromUserId: lead.ownerId,
          status: In([TransferStatus.APPROVED, TransferStatus.REJECTED]),
        },
        relations: { toUser: true, decider: true },
        order: { decidedAt: 'DESC' },
      }),
      lead.convertedBy
        ? this.users.findOne({ where: { id: lead.convertedBy } })
        : Promise.resolve(null),
      this.commentSummary(leadId),
    ]);

    const projectOpen = lead.project.status === ProjectStatus.ACTIVE;
    const recentEntries = await this.entryPresenter.present(entries, {
      viewerId: actor.id,
      isProjectOpen: () => projectOpen,
    });

    return {
      ...summary,
      notes: lead.notes,
      project: {
        id: lead.project.id,
        name: lead.project.name,
        type: lead.project.type,
        status: lead.project.status,
      },
      convertedBy: convertedBy ? { id: convertedBy.id, name: convertedBy.name } : null,
      recentEntries,
      entryCount,
      pendingTransfer: pending ? toTransferRef(pending) : null,
      lastDecidedTransfer: lastDecided ? toTransferRef(lastDecided) : null,
      permissions: this.permissions(actor, lead, visibility, projectOpen, pending !== null),
      coveringFor: visibility.isCovering ? { id: lead.owner.id, name: lead.owner.name } : null,
      ...comments,
    };
  }

  /** The lead's comment count, whether help is waiting, and the newest pinned comment. */
  private async commentSummary(
    leadId: string,
  ): Promise<{ openHelp: boolean; pinnedComment: PinnedCommentDto | null; commentCount: number }> {
    const [commentCount, openHelp, pinned] = await Promise.all([
      this.comments.count({ where: { leadId, deletedAt: IsNull() } }),
      this.comments.exists({
        where: { leadId, kind: CommentKind.HELP, resolvedAt: IsNull(), deletedAt: IsNull() },
      }),
      this.comments.findOne({
        where: { leadId, pinned: true, deletedAt: IsNull() },
        relations: { user: true },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    ]);

    return {
      openHelp,
      commentCount,
      pinnedComment: pinned
        ? {
            id: pinned.id,
            body: pinned.body,
            user: { id: pinned.user.id, name: pinned.user.name },
            createdAt: pinned.createdAt,
          }
        : null,
    };
  }

  async listEntries(
    actor: AuthenticatedUser,
    leadId: string,
    query: ListEntriesQueryDto,
  ): Promise<PaginatedResponseDto<EntryDto>> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    await this.leadAccess.assertVisible(actor, lead);

    const [rows, total] = await this.followUps.findAndCount({
      where: { leadId, deletedAt: IsNull() },
      relations: { user: true, location: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });

    const projectOpen = lead.project.status === ProjectStatus.ACTIVE;
    const items = await this.entryPresenter.present(rows, {
      viewerId: actor.id,
      isProjectOpen: () => projectOpen,
    });
    return PaginatedResponseDto.from([items, total], query.page, query.limit);
  }

  // ------------------------------------------------------------------- update

  /**
   * The owner edits name, business name, phone, notes, location, deal value,
   * plan and source at any time (Assumption 5). A new phone is checked for
   * duplicates again.
   */
  async update(
    actor: AuthenticatedUser,
    leadId: string,
    dto: UpdateLeadDto,
  ): Promise<LeadDetailDto> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    const visibility = await this.leadAccess.assertVisible(actor, lead);

    if (!visibility.isOwner || !visibility.isMember) {
      throw new ForbiddenBusinessException(LEAD_ERROR.ONLY_OWNER_EDITS);
    }
    this.access.assertWritable(lead.project);

    const phone = dto.phone !== undefined ? this.normalisePhone(dto.phone) : undefined;
    if (phone !== undefined && phone !== lead.phone) {
      await this.assertPhoneFree(lead.projectId, phone, actor.id, { excludingLeadId: lead.id });
    }
    const locationName =
      dto.location !== undefined ? this.locations.normaliseName(dto.location) : undefined;

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, lead.projectId);
        const locked = await this.leadAccess.lockLead(manager, lead.id);
        if (locked.ownerId !== actor.id) {
          throw await this.leadAccess.notYoursError(actor, locked, manager);
        }

        const changes: Partial<Lead> = {};
        if (dto.name !== undefined) changes.name = dto.name;
        if (dto.businessName !== undefined) changes.businessName = dto.businessName;
        if (dto.notes !== undefined) changes.notes = dto.notes;
        if (dto.dealValue !== undefined) changes.dealValue = dto.dealValue;
        if (dto.plan !== undefined) changes.plan = dto.plan;
        if (dto.source !== undefined) changes.source = dto.source;
        if (phone !== undefined) changes.phone = phone;
        if (locationName !== undefined) {
          changes.locationId = (
            await this.locations.findOrCreate(manager, lead.projectId, locationName, actor.id)
          ).id;
        }

        if (Object.keys(changes).length > 0) {
          await manager.update(Lead, { id: lead.id }, changes);
        }
      });
    } catch (error) {
      if (phone !== undefined && isUniqueViolation(error, DB_CONSTRAINT.LEADS_PROJECT_PHONE)) {
        await this.assertPhoneFree(lead.projectId, phone, actor.id, { excludingLeadId: lead.id });
      }
      throw error;
    }

    return this.findDetail(actor, lead.id);
  }

  /**
   * Super Admin only (PRD §5.5): hidden everywhere, its phone free to add
   * again, its pending transfer rejected, and a conversion no longer counts.
   */
  async remove(actor: AuthenticatedUser, leadId: string): Promise<void> {
    await this.leadAccess.findLiveLead(leadId);

    await this.dataSource.transaction(async (manager) => {
      const locked = await this.leadAccess.lockLead(manager, leadId);
      await manager.update(Lead, { id: locked.id }, { deletedAt: new Date() });
      await this.transferRejections.rejectPending(
        manager,
        { leadIds: [locked.id] },
        actor.id,
        AUTO_REJECT_REASON.LEAD_DELETED,
      );
    });
  }

  /**
   * Deletes several leads of one campaign at once (Super Admin), the same soft delete as one:
   * hidden everywhere, phones free to add again, pending handovers rejected, wins no longer
   * counted. All or nothing: if any lead isn't a live lead of this campaign, nothing changes.
   */
  async removeMany(
    actor: AuthenticatedUser,
    projectId: string,
    dto: BulkDeleteLeadsDto,
  ): Promise<BulkDeleteResultDto> {
    return this.dataSource.transaction(async (manager) => {
      const leads = await manager
        .getRepository(Lead)
        .createQueryBuilder('l')
        .setLock('pessimistic_write')
        .where('l.id IN (:...leadIds)', { leadIds: dto.leadIds })
        .andWhere('l.project_id = :projectId', { projectId })
        .andWhere('l.deleted_at IS NULL')
        .orderBy('l.id')
        .getMany();
      if (leads.length !== dto.leadIds.length) {
        throw new NotFoundBusinessException(LEAD_ERROR.LEADS_NOT_IN_PROJECT);
      }

      const ids = leads.map((lead) => lead.id);
      await manager.update(Lead, { id: In(ids) }, { deletedAt: new Date() });
      await this.transferRejections.rejectPending(
        manager,
        { leadIds: ids },
        actor.id,
        AUTO_REJECT_REASON.LEAD_DELETED,
      );
      return { deleted: ids.length };
    });
  }

  // ------------------------------------------------------------------ helpers

  /**
   * The `due` filter on the next follow-up date, India time. A closed lead
   * never has a date, so only `none` has to leave closed leads out itself.
   */
  private whereDue(qb: SelectQueryBuilder<Lead>, due: LeadDue, today: string): void {
    const tomorrow = addDays(today, 1);
    switch (due) {
      case LeadDue.OVERDUE:
        qb.andWhere('l.next_follow_up_date < :today', { today });
        break;
      case LeadDue.TODAY:
        qb.andWhere('l.next_follow_up_date = :today', { today });
        break;
      case LeadDue.TOMORROW:
        qb.andWhere('l.next_follow_up_date = :tomorrow', { tomorrow });
        break;
      case LeadDue.WEEK:
        qb.andWhere('l.next_follow_up_date BETWEEN :tomorrow AND :weekEnd', {
          tomorrow,
          weekEnd: addDays(today, 7),
        });
        break;
      case LeadDue.NONE:
        qb.andWhere('l.next_follow_up_date IS NULL').andWhere('l.status NOT IN (:...terminal)', {
          terminal: TERMINAL_STATUSES,
        });
        break;
    }
  }

  private normalisePhone(raw: string): string {
    const phone = normaliseIndianMobile(raw);
    if (!phone) {
      throw new BusinessException(LEAD_ERROR.INVALID_PHONE, ERROR_CODE.VALIDATION_FAILED);
    }
    return phone;
  }

  /**
   * PRD §5.5: the owner is told "You already have this lead." with a link;
   * anyone else learns only who owns it.
   */
  private async assertPhoneFree(
    projectId: string,
    phone: string,
    actorId: string,
    options: { excludingLeadId?: string; offerRequest?: boolean } = {},
  ): Promise<void> {
    const existing = await this.leads.findOne({
      where: { projectId, phone, deletedAt: IsNull() },
      relations: { owner: true },
    });
    if (!existing || existing.id === options.excludingLeadId) return;

    if (existing.ownerId === actorId) {
      throw new BusinessException(LEAD_ERROR.DUPLICATE_OWN, ERROR_CODE.DUPLICATE_LEAD_OWN, {
        leadId: existing.id,
      });
    }
    // A member adding a lead can ask for this one instead (request-by-phone).
    throw new BusinessException(
      LEAD_ERROR.DUPLICATE_OTHER(existing.owner.name),
      ERROR_CODE.DUPLICATE_LEAD_OTHER,
      { ownerName: existing.owner.name, ...(options.offerRequest ? { canRequest: true } : {}) },
    );
  }

  private permissions(
    actor: AuthenticatedUser,
    lead: Lead,
    visibility: LeadVisibility,
    projectOpen: boolean,
    hasPendingTransfer: boolean,
  ): LeadPermissionsDto {
    const ownerWorks = visibility.isOwner && visibility.isMember;
    const covering = visibility.isCovering;
    const canChangeStatus = projectOpen && (ownerWorks || visibility.isAdmin || covering);
    const moderatorOwnsIt = actor.role === UserRole.MODERATOR && visibility.isOwner;

    return {
      canLogFollowUp: projectOpen && (ownerWorks || covering),
      canChangeStatus,
      canLeaveConverted: canChangeStatus && visibility.isAdmin,
      canEdit: projectOpen && ownerWorks,
      canRequestTransfer: projectOpen && ownerWorks && !hasPendingTransfer,
      canReassign: projectOpen && visibility.isAdmin && !moderatorOwnsIt,
      canDelete: actor.role === UserRole.SUPER_ADMIN,
      covering,
    };
  }
}

const toTransferRef = (transfer: LeadTransfer): LeadTransferRefDto => ({
  id: transfer.id,
  status: transfer.status,
  toUser: { id: transfer.toUser.id, name: transfer.toUser.name },
  reason: transfer.reason,
  createdAt: transfer.createdAt,
  decidedBy: transfer.decider ? { id: transfer.decider.id, name: transfer.decider.name } : null,
  decidedAt: transfer.decidedAt,
  decisionNote: transfer.decisionNote,
});
