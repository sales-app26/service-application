import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';

import {
  AUTO_REJECT_REASON,
  BUSINESS_RULE,
  DB_CONSTRAINT,
  ERROR_CODE,
  LEAD_ERROR,
  PROJECT_ERROR,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { EntryType, LeadStatus, ProjectStatus, TransferStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import {
  escapeLike,
  isUniqueViolation,
  istToday,
  normaliseIndianMobile,
  phoneSearchDigits,
} from '../../common/utils';
import { FollowUp, Lead, LeadTransfer, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationsService } from '../locations/locations.service';
import { TransferRejectionsService } from '../transfers/transfer-rejections.service';
import { StoredVisitProof, VisitProofService } from '../visits/visit-proof.service';
import { EntryDto, ListEntriesQueryDto } from './dto/entry.dto';
import {
  CreateLeadDto,
  LeadDetailDto,
  LeadPermissionsDto,
  LeadSummaryDto,
  LeadTransferRefDto,
  ListLeadsQueryDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { EntryPresenter } from './entry.presenter';
import { LeadAccessService, LeadVisibility } from './lead-access.service';
import { resolveNextFollowUpDate } from './lead-rules';
import { LeadPresenter } from './lead.presenter';

interface UploadedPhoto {
  buffer: Buffer;
}

const SORT_COLUMN = {
  updated: 'l.updatedAt',
  created: 'l.createdAt',
  name: 'l.name',
  next_follow_up: 'l.nextFollowUpDate',
} as const;

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
    private readonly access: ProjectAccessService,
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
    await this.assertPhoneFree(projectId, phone, actor.id);
    const locationName = this.locations.normaliseName(dto.location);

    const now = new Date();
    const nextFollowUpDate = resolveNextFollowUpDate(
      dto.status,
      dto.nextFollowUpDate,
      istToday(now),
    );
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
        });

        await manager.insert(FollowUp, {
          id: entryId,
          leadId,
          projectId,
          userId: actor.id,
          entryType: EntryType.FOLLOW_UP,
          status: dto.status,
          note: dto.note,
          nextFollowUpDate,
          locationId: location.id,
          photoPath: proof?.photoPath ?? null,
          latitude: proof?.latitude ?? null,
          longitude: proof?.longitude ?? null,
          gpsAccuracyM: proof?.gpsAccuracyM ?? null,
          clientRequestId: dto.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      await this.visitProof.discard(proof);

      if (isUniqueViolation(error, DB_CONSTRAINT.FOLLOW_UPS_CLIENT_REQUEST)) {
        const saved = await this.leadAccess.findReplay(dto.clientRequestId, actor.id);
        if (saved) return this.findDetail(actor, saved.leadId);
      }
      // Two people adding the same phone at the same moment: the first save
      // wins and the second gets the same message it would have had a second
      // later (PRD §5.5).
      if (isUniqueViolation(error, DB_CONSTRAINT.LEADS_PROJECT_PHONE)) {
        await this.assertPhoneFree(projectId, phone, actor.id);
      }
      throw error;
    }

    return this.findDetail(actor, leadId);
  }

  // -------------------------------------------------------------------- reads

  /**
   * A sales person sees only leads he owns. Admins see every lead in the
   * project and can filter by owner or by "owner unavailable".
   */
  async list(
    actor: AuthenticatedUser,
    projectId: string,
    query: ListLeadsQueryDto,
  ): Promise<PaginatedResponseDto<LeadSummaryDto>> {
    await this.access.assertCanView(actor, projectId);
    const isAdmin = await this.access.isAdminOf(actor, projectId);

    const qb = this.leads
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.owner', 'owner')
      .leftJoinAndSelect('l.location', 'location')
      .where('l.project_id = :projectId', { projectId })
      .andWhere('l.deleted_at IS NULL');

    if (!isAdmin || query.mine) {
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

    const sort = query.sort ?? 'updated';
    qb.orderBy(
      SORT_COLUMN[sort],
      sort === 'name' || sort === 'next_follow_up' ? 'ASC' : 'DESC',
      'NULLS LAST',
    )
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
    const [entries, entryCount, pending, lastDecided, convertedBy] = await Promise.all([
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
   * The owner edits name, business name, phone, notes and location at any
   * time (Assumption 5). A new phone is checked for duplicates again.
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
      await this.assertPhoneFree(lead.projectId, phone, actor.id, lead.id);
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
        await this.assertPhoneFree(lead.projectId, phone, actor.id, lead.id);
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

  // ------------------------------------------------------------------ helpers

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
    excludingLeadId?: string,
  ): Promise<void> {
    const existing = await this.leads.findOne({
      where: { projectId, phone, deletedAt: IsNull() },
      relations: { owner: true },
    });
    if (!existing || existing.id === excludingLeadId) return;

    if (existing.ownerId === actorId) {
      throw new BusinessException(LEAD_ERROR.DUPLICATE_OWN, ERROR_CODE.DUPLICATE_LEAD_OWN, {
        leadId: existing.id,
      });
    }
    throw new BusinessException(
      LEAD_ERROR.DUPLICATE_OTHER(existing.owner.name),
      ERROR_CODE.DUPLICATE_LEAD_OTHER,
      { ownerName: existing.owner.name },
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
    const canChangeStatus = projectOpen && (ownerWorks || visibility.isAdmin);
    const moderatorOwnsIt = actor.role === UserRole.MODERATOR && visibility.isOwner;

    return {
      canLogFollowUp: projectOpen && ownerWorks,
      canChangeStatus,
      canLeaveConverted: canChangeStatus && visibility.isAdmin,
      canEdit: projectOpen && ownerWorks,
      canRequestTransfer: projectOpen && ownerWorks && !hasPendingTransfer,
      canReassign: projectOpen && visibility.isAdmin && !moderatorOwnsIt,
      canDelete: actor.role === UserRole.SUPER_ADMIN,
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
