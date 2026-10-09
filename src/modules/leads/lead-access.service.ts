import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { ERROR_CODE, FOLLOW_UP_ERROR, LEAD_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { TransferStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { FollowUp, Lead, LeadTransfer, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';

export interface LeadVisibility {
  /** Super Admin, or a moderator who is a member of the lead's project. */
  isAdmin: boolean;
  isOwner: boolean;
  /** The caller is an active member of the project. */
  isMember: boolean;
}

/**
 * Who may see and touch one lead (BRD §2, FR-7).
 *
 *  - Admins of the project see every lead in it.
 *  - Everyone else sees only leads they own, and only while still a member.
 *
 * Anything else answers 404, so lead ids do not confirm their own existence —
 * with one deliberate exception from PRD §5.6: a former owner whose open form
 * outlived a transfer is told who has the lead now.
 */
@Injectable()
export class LeadAccessService {
  constructor(
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    @InjectRepository(LeadTransfer) private readonly transfers: Repository<LeadTransfer>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
  ) {}

  /** A lead that is not deleted, with its project, owner and location. */
  async findLiveLead(leadId: string): Promise<Lead> {
    const lead = await this.leads.findOne({
      where: { id: leadId, deletedAt: IsNull() },
      relations: { project: true, owner: true, location: true },
    });
    if (!lead) {
      throw new NotFoundBusinessException(LEAD_ERROR.NOT_FOUND);
    }
    return lead;
  }

  async visibility(actor: AuthenticatedUser, lead: Lead): Promise<LeadVisibility> {
    const isOwner = lead.ownerId === actor.id;

    if (this.access.isSuperAdmin(actor)) {
      return { isAdmin: true, isOwner, isMember: false };
    }

    const isMember = await this.access.isActiveMember(lead.projectId, actor.id);
    const isAdmin = isMember && actor.role === UserRole.MODERATOR;
    return { isAdmin, isOwner, isMember };
  }

  /** The caller's visibility, or 404 when the lead is not theirs to see. */
  async assertVisible(actor: AuthenticatedUser, lead: Lead): Promise<LeadVisibility> {
    const visibility = await this.visibility(actor, lead);
    if (visibility.isAdmin || (visibility.isOwner && visibility.isMember)) {
      return visibility;
    }
    throw await this.notYoursError(actor, lead);
  }

  /**
   * Why someone who is not the owner cannot act: "This lead now belongs to
   * [name]" for the person it was transferred away from, 404 for anyone else.
   *
   * Inside a transaction pass its manager: asking the pool for a second
   * connection while holding one can wait forever when the pool is full.
   */
  async notYoursError(
    actor: AuthenticatedUser,
    lead: Pick<Lead, 'id' | 'ownerId'>,
    manager?: EntityManager,
  ): Promise<BusinessException> {
    const transfers = manager ? manager.getRepository(LeadTransfer) : this.transfers;
    const users = manager ? manager.getRepository(User) : this.users;

    const handedOver = await transfers.exists({
      where: { leadId: lead.id, fromUserId: actor.id, status: TransferStatus.APPROVED },
    });

    if (handedOver && lead.ownerId !== actor.id) {
      const owner = await users.findOne({ where: { id: lead.ownerId } });
      return new BusinessException(
        FOLLOW_UP_ERROR.LEAD_TRANSFERRED(owner?.name ?? 'another member'),
        ERROR_CODE.LEAD_TRANSFERRED,
      );
    }
    return new NotFoundBusinessException(LEAD_ERROR.NOT_FOUND);
  }

  /** Locks the lead row for the rest of the transaction. */
  async lockLead(
    manager: EntityManager,
    leadId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<Lead> {
    const qb = manager
      .getRepository(Lead)
      .createQueryBuilder('l')
      .setLock('pessimistic_write')
      .where('l.id = :leadId', { leadId });
    if (!options.includeDeleted) {
      qb.andWhere('l.deleted_at IS NULL');
    }

    const lead = await qb.getOne();
    if (!lead) {
      throw new NotFoundBusinessException(LEAD_ERROR.NOT_FOUND);
    }
    return lead;
  }

  /**
   * The entry an earlier attempt with this one-time id saved, if any (PRD
   * §5.6: a double tap or a retry saves once). An id reused by someone else is
   * a client bug, not a retry.
   */
  async findReplay(clientRequestId: string, actorId: string): Promise<FollowUp | null> {
    const existing = await this.followUps.findOne({ where: { clientRequestId } });
    if (existing && existing.userId !== actorId) {
      throw new ConflictBusinessException(FOLLOW_UP_ERROR.CLIENT_REQUEST_REUSED);
    }
    return existing;
  }
}
