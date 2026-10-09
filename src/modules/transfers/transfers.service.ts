import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';

import { AUTO_REJECT_REASON, ERROR_CODE, SQL_TABLE, TRANSFER_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { TransferStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { Lead, LeadTransfer, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { LeadAccessService } from '../leads/lead-access.service';
import {
  BulkReassignDto,
  DecideTransferDto,
  ListTransfersQueryDto,
  PendingCountDto,
  ReassignResultDto,
  RequestTransferDto,
  TransferDto,
} from './dto/transfer.dto';
import { TransferRejectionsService } from './transfer-rejections.service';

/**
 * Lead transfers (PRD §5.10).
 *
 * Ownership moves only on approval by a moderator of the project or the Super
 * Admin, and never by someone deciding their own request. A direct
 * reassignment by an admin is the same row, created already approved.
 * Conversion credit never moves with the lead: `converted_by` keeps whoever
 * converted it.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(LeadTransfer) private readonly transfers: Repository<LeadTransfer>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly leadAccess: LeadAccessService,
    private readonly transferRejections: TransferRejectionsService,
  ) {}

  // ------------------------------------------------------------------ request

  /** PRD §7.3. The owner keeps working the lead while the request waits. */
  async request(
    actor: AuthenticatedUser,
    leadId: string,
    dto: RequestTransferDto,
  ): Promise<TransferDto> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    const visibility = await this.leadAccess.assertVisible(actor, lead);
    if (!visibility.isOwner || !visibility.isMember) {
      throw new ForbiddenBusinessException(TRANSFER_ERROR.ONLY_OWNER_REQUESTS);
    }
    this.access.assertWritable(lead.project);

    const transferId = await this.dataSource.transaction(async (manager) => {
      await this.access.lockOpenProject(manager, lead.projectId);
      const locked = await this.leadAccess.lockLead(manager, leadId);
      if (locked.ownerId !== actor.id) {
        throw await this.leadAccess.notYoursError(actor, locked, manager);
      }
      await this.assertRecipient(manager, locked, dto.toUserId);

      if (
        await manager.exists(LeadTransfer, { where: { leadId, status: TransferStatus.PENDING } })
      ) {
        throw new BusinessException(TRANSFER_ERROR.PENDING_EXISTS, ERROR_CODE.TRANSFER_PENDING);
      }

      const saved = await manager.save(
        manager.create(LeadTransfer, {
          leadId,
          fromUserId: actor.id,
          toUserId: dto.toUserId,
          reason: dto.reason,
          status: TransferStatus.PENDING,
          requestedBy: actor.id,
        }),
      );
      return saved.id;
    });

    return this.findOne(actor, transferId);
  }

  // ----------------------------------------------------------------- decision

  async approve(
    actor: AuthenticatedUser,
    transferId: string,
    dto: DecideTransferDto,
  ): Promise<TransferDto> {
    return this.decide(actor, transferId, TransferStatus.APPROVED, dto.note ?? null);
  }

  async reject(
    actor: AuthenticatedUser,
    transferId: string,
    dto: DecideTransferDto,
  ): Promise<TransferDto> {
    return this.decide(actor, transferId, TransferStatus.REJECTED, dto.note ?? null);
  }

  /**
   * The transfer row is locked for the decision, so two admins deciding at
   * once are serialised: the first decision stands and the second is told
   * who made it (PRD §5.10).
   */
  private async decide(
    actor: AuthenticatedUser,
    transferId: string,
    decision: TransferStatus.APPROVED | TransferStatus.REJECTED,
    note: string | null,
  ): Promise<TransferDto> {
    const transfer = await this.transfers.findOne({
      where: { id: transferId },
      relations: { lead: true },
    });
    if (!transfer) {
      throw new NotFoundBusinessException(TRANSFER_ERROR.NOT_FOUND);
    }
    await this.assertCanDecide(actor, transfer);

    await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(LeadTransfer)
        .createQueryBuilder('t')
        .setLock('pessimistic_write')
        .where('t.id = :transferId', { transferId })
        .getOneOrFail();

      if (locked.status !== TransferStatus.PENDING) {
        const decider = locked.decidedBy
          ? await manager.findOne(User, { where: { id: locked.decidedBy } })
          : null;
        throw new BusinessException(
          TRANSFER_ERROR.ALREADY_DECIDED(decider?.name ?? 'another admin'),
          ERROR_CODE.TRANSFER_ALREADY_DECIDED,
          { status: locked.status },
        );
      }

      if (decision === TransferStatus.APPROVED) {
        await this.access.lockOpenProject(manager, transfer.lead.projectId);
        const lead = await this.leadAccess.lockLead(manager, locked.leadId);
        if (lead.ownerId !== locked.fromUserId) {
          throw new BusinessException(TRANSFER_ERROR.OWNER_CHANGED, ERROR_CODE.CONFLICT);
        }
        await this.assertRecipient(manager, lead, locked.toUserId);
        // Ownership only. The conversion credit stays with whoever converted it,
        // and a due follow-up moves to the new owner's Due today list.
        await manager.update(Lead, { id: lead.id }, { ownerId: locked.toUserId });
      }

      await manager.update(
        LeadTransfer,
        { id: locked.id },
        { status: decision, decidedBy: actor.id, decidedAt: new Date(), decisionNote: note },
      );
    });

    return this.findOne(actor, transferId);
  }

  // --------------------------------------------------------------- reassign

  /** An admin moves one lead directly — e.g. its owner was deactivated. */
  async reassign(
    actor: AuthenticatedUser,
    leadId: string,
    dto: RequestTransferDto,
  ): Promise<ReassignResultDto> {
    const lead = await this.leadAccess.findLiveLead(leadId);
    const result = await this.reassignMany(actor, lead.projectId, [leadId], dto);
    if (result.skipped > 0) {
      throw new BusinessException(TRANSFER_ERROR.RECIPIENT_INVALID, ERROR_CODE.UNPROCESSABLE);
    }
    return result;
  }

  /** PRD §5.10: several leads of a departed person to one member, in one action. */
  async bulkReassign(
    actor: AuthenticatedUser,
    projectId: string,
    dto: BulkReassignDto,
  ): Promise<ReassignResultDto> {
    return this.reassignMany(actor, projectId, dto.leadIds, dto);
  }

  private async reassignMany(
    actor: AuthenticatedUser,
    projectId: string,
    leadIds: string[],
    dto: RequestTransferDto,
  ): Promise<ReassignResultDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);

    const isModerator = actor.role === UserRole.MODERATOR;
    if (isModerator && dto.toUserId === actor.id) {
      throw new ForbiddenBusinessException(TRANSFER_ERROR.SELF_REASSIGN);
    }

    return this.dataSource.transaction(async (manager) => {
      await this.access.lockOpenProject(manager, projectId);

      const leads = await manager
        .getRepository(Lead)
        .createQueryBuilder('l')
        .setLock('pessimistic_write')
        .where('l.id IN (:...leadIds)', { leadIds })
        .andWhere('l.project_id = :projectId', { projectId })
        .andWhere('l.deleted_at IS NULL')
        .orderBy('l.id')
        .getMany();

      if (leads.length !== leadIds.length) {
        throw new NotFoundBusinessException(TRANSFER_ERROR.LEADS_NOT_IN_PROJECT);
      }
      if (isModerator && leads.some((lead) => lead.ownerId === actor.id)) {
        throw new ForbiddenBusinessException(TRANSFER_ERROR.SELF_REASSIGN);
      }

      await this.assertRecipient(manager, leads[0], dto.toUserId, { allowCurrentOwner: true });

      const moving = leads.filter((lead) => lead.ownerId !== dto.toUserId);
      if (moving.length === 0) {
        return { reassigned: 0, skipped: leads.length };
      }

      const movingIds = moving.map((lead) => lead.id);
      await this.transferRejections.rejectPending(
        manager,
        { leadIds: movingIds },
        actor.id,
        AUTO_REJECT_REASON.SUPERSEDED,
      );

      const now = new Date();
      await manager.insert(
        LeadTransfer,
        moving.map((lead) => ({
          leadId: lead.id,
          fromUserId: lead.ownerId,
          toUserId: dto.toUserId,
          reason: dto.reason,
          status: TransferStatus.APPROVED,
          requestedBy: actor.id,
          decidedBy: actor.id,
          decidedAt: now,
        })),
      );
      await manager
        .createQueryBuilder()
        .update(Lead)
        .set({ ownerId: dto.toUserId })
        .where('id IN (:...movingIds)', { movingIds })
        .execute();

      return { reassigned: moving.length, skipped: leads.length - moving.length };
    });
  }

  // -------------------------------------------------------------------- reads

  /**
   * Admins: transfers on leads in their projects. Sales persons: the
   * requests they made, so they see each decision and who made it.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListTransfersQueryDto,
  ): Promise<PaginatedResponseDto<TransferDto>> {
    const qb = this.baseQuery();
    await this.applyScope(qb, actor);

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.projectId)
      qb.andWhere('lead.project_id = :projectId', { projectId: query.projectId });

    const [rows, total] = await qb
      .orderBy('t.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    const adminOf = await this.adminProjects(actor);
    const items = rows.map((row) => this.toDto(row, actor, adminOf));
    return PaginatedResponseDto.from([items, total], query.page, query.limit);
  }

  /** The badge on the Transfers menu. */
  async pendingCount(actor: AuthenticatedUser): Promise<PendingCountDto> {
    const qb = this.baseQuery().where('t.status = :status', { status: TransferStatus.PENDING });
    await this.applyScope(qb, actor);
    return { pending: await qb.getCount() };
  }

  async findOne(actor: AuthenticatedUser, transferId: string): Promise<TransferDto> {
    const qb = this.baseQuery().where('t.id = :transferId', { transferId });
    await this.applyScope(qb, actor);

    const transfer = await qb.getOne();
    if (!transfer) {
      throw new NotFoundBusinessException(TRANSFER_ERROR.NOT_FOUND);
    }
    return this.toDto(transfer, actor, await this.adminProjects(actor));
  }

  // ------------------------------------------------------------------ helpers

  /** Projects the caller administers: all for the Super Admin. */
  private async adminProjects(actor: AuthenticatedUser): Promise<Set<string> | 'all'> {
    if (this.access.isSuperAdmin(actor)) return 'all';
    if (actor.role !== UserRole.MODERATOR) return new Set();
    return new Set(await this.access.activeProjectIds(actor.id));
  }

  private baseQuery(): SelectQueryBuilder<LeadTransfer> {
    return this.transfers
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.lead', 'lead')
      .innerJoinAndSelect('lead.project', 'project')
      .innerJoinAndSelect('t.fromUser', 'fromUser')
      .innerJoinAndSelect('t.toUser', 'toUser')
      .innerJoinAndSelect('t.requester', 'requester')
      .leftJoinAndSelect('t.decider', 'decider')
      .andWhere('lead.deleted_at IS NULL');
  }

  private async applyScope(
    qb: SelectQueryBuilder<LeadTransfer>,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (this.access.isSuperAdmin(actor)) return;

    if (actor.role === UserRole.MODERATOR) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                  WHERE pm.project_id = lead.project_id AND pm.user_id = :scopeUserId AND pm.is_active)`,
        { scopeUserId: actor.id },
      );
      return;
    }

    qb.andWhere('(t.from_user_id = :scopeUserId OR t.requested_by = :scopeUserId)', {
      scopeUserId: actor.id,
    });
  }

  /** Admin of the lead's project, and not a party to the request. */
  private async assertCanDecide(actor: AuthenticatedUser, transfer: LeadTransfer): Promise<void> {
    if (!(await this.access.isAdminOf(actor, transfer.lead.projectId))) {
      throw new NotFoundBusinessException(TRANSFER_ERROR.NOT_FOUND);
    }
    if (this.isParty(actor, transfer)) {
      throw new ForbiddenBusinessException(TRANSFER_ERROR.SELF_DECISION);
    }
  }

  private isParty(actor: AuthenticatedUser, transfer: LeadTransfer): boolean {
    return [transfer.fromUserId, transfer.toUserId, transfer.requestedBy].includes(actor.id);
  }

  /**
   * An active account, an active member of the lead's project, a role that
   * owns leads, and not the current owner (PRD §5.10).
   */
  private async assertRecipient(
    manager: EntityManager,
    lead: Lead,
    toUserId: string,
    options: { allowCurrentOwner?: boolean } = {},
  ): Promise<void> {
    if (!options.allowCurrentOwner && lead.ownerId === toUserId) {
      throw new BusinessException(TRANSFER_ERROR.RECIPIENT_INVALID, ERROR_CODE.UNPROCESSABLE);
    }

    const recipient = await manager.findOne(User, { where: { id: toUserId } });
    const valid =
      recipient !== null &&
      recipient.isActive &&
      recipient.role !== UserRole.SUPER_ADMIN &&
      (await this.access.isActiveMember(lead.projectId, toUserId, manager));

    if (!valid) {
      throw new BusinessException(TRANSFER_ERROR.RECIPIENT_INVALID, ERROR_CODE.UNPROCESSABLE);
    }
  }

  private toDto(
    transfer: LeadTransfer,
    actor: AuthenticatedUser,
    adminOf: Set<string> | 'all',
  ): TransferDto {
    const canDecide =
      transfer.status === TransferStatus.PENDING &&
      !this.isParty(actor, transfer) &&
      (adminOf === 'all' || adminOf.has(transfer.lead.projectId));

    return {
      id: transfer.id,
      lead: {
        id: transfer.lead.id,
        name: transfer.lead.name,
        businessName: transfer.lead.businessName,
        projectId: transfer.lead.projectId,
        projectName: transfer.lead.project.name,
      },
      fromUser: { id: transfer.fromUser.id, name: transfer.fromUser.name },
      toUser: { id: transfer.toUser.id, name: transfer.toUser.name },
      requestedBy: { id: transfer.requester.id, name: transfer.requester.name },
      reason: transfer.reason,
      status: transfer.status,
      createdAt: transfer.createdAt,
      decidedBy: transfer.decider ? { id: transfer.decider.id, name: transfer.decider.name } : null,
      decidedAt: transfer.decidedAt,
      decisionNote: transfer.decisionNote,
      canDecide,
    };
  }
}
