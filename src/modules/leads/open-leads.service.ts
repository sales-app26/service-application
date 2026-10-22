import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';

import { LEAD_ERROR, OPEN_LEAD } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { TransferStatus, UserRole } from '../../common/enums';
import {
  ConflictBusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { escapeLike } from '../../common/utils';
import { Lead, LeadTransfer, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { ClaimLeadResultDto, ListOpenLeadsQueryDto, OpenLeadDto } from './dto/open-lead.dto';
import { LeadAccessService } from './lead-access.service';

/**
 * Open leads: the ones a bulk upload left unassigned, offered to the campaign's reps to take
 * for themselves (admin request after the PRD). Anyone on the team sees the list; a sales
 * person takes a lead with one tap and it becomes theirs like any assigned lead. From then on
 * it moves only by handover, the same as every other lead: nobody puts it back in the list.
 */
@Injectable()
export class OpenLeadsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly leadAccess: LeadAccessService,
  ) {}

  /** Newest first. What a rep needs to decide; the phone stays hidden until it is theirs. */
  async list(
    actor: AuthenticatedUser,
    projectId: string,
    query: ListOpenLeadsQueryDto,
  ): Promise<PaginatedResponseDto<OpenLeadDto>> {
    await this.access.assertCanView(actor, projectId);

    const qb = this.leads
      .createQueryBuilder('l')
      .innerJoinAndSelect('l.location', 'location')
      .where('l.project_id = :projectId', { projectId })
      .andWhere('l.owner_id IS NULL')
      .andWhere('l.deleted_at IS NULL');

    if (query.search) {
      const term = `%${escapeLike(query.search.toLowerCase())}%`;
      qb.andWhere(
        new Brackets((inner) => {
          inner
            .where("lower(coalesce(l.business_name, '')) LIKE :term", { term })
            .orWhere("lower(coalesce(l.name, '')) LIKE :term", { term })
            .orWhere('lower(location.name) LIKE :term', { term });
        }),
      );
    }

    // Entity property names: with paging and a join, TypeORM can't order by column names.
    qb.orderBy('l.createdAt', 'DESC').addOrderBy('l.id', 'ASC').skip(query.skip).take(query.limit);
    const [entities, total] = await qb.getManyAndCount();
    // Who added each one: a handful of people per page, looked up once.
    const adderIds = [
      ...new Set(entities.flatMap((lead) => (lead.createdBy ? [lead.createdBy] : []))),
    ];
    const adders = new Map(
      adderIds.length
        ? (
            await this.users.find({ where: { id: In(adderIds) }, select: { id: true, name: true } })
          ).map((user) => [user.id, { id: user.id, name: user.name }])
        : [],
    );

    const items: OpenLeadDto[] = entities.map((lead) => ({
      id: lead.id,
      businessName: lead.businessName,
      name: lead.name,
      location: { id: lead.location.id, name: lead.location.name },
      notes: lead.notes,
      hasPhone: lead.phone !== null,
      source: lead.source,
      addedBy: (lead.createdBy && adders.get(lead.createdBy)) || null,
      createdAt: lead.createdAt,
    }));
    return PaginatedResponseDto.from([items, total], query.page, query.limit);
  }

  /**
   * A sales person on the campaign takes an open lead. Recorded as an approved handover from
   * no one, like an admin assigning it. If two people tap at once, the first wins and the
   * second hears who has it; taking a lead you already took is a harmless repeat.
   */
  async claim(actor: AuthenticatedUser, leadId: string): Promise<ClaimLeadResultDto> {
    if (actor.role !== UserRole.SALES_PERSON) {
      throw new ForbiddenBusinessException(LEAD_ERROR.CLAIM_REPS_ONLY);
    }
    const lead = await this.leadAccess.findLiveLead(leadId);
    // Someone off the team can't learn that the lead exists.
    if (!(await this.access.isActiveMember(lead.projectId, actor.id))) {
      throw new NotFoundBusinessException(LEAD_ERROR.NOT_FOUND);
    }
    this.access.assertWritable(lead.project);

    return this.dataSource.transaction(async (manager) => {
      await this.access.lockOpenProject(manager, lead.projectId);
      const locked = await this.leadAccess.lockLead(manager, leadId);

      if (locked.ownerId === actor.id) return { leadId };
      if (locked.ownerId) {
        const owner = await manager.findOne(User, { where: { id: locked.ownerId } });
        throw new ConflictBusinessException(LEAD_ERROR.ALREADY_TAKEN(owner?.name ?? 'a teammate'));
      }

      const now = new Date();
      await manager.insert(LeadTransfer, {
        leadId,
        fromUserId: null,
        toUserId: actor.id,
        reason: OPEN_LEAD.CLAIM_REASON,
        status: TransferStatus.APPROVED,
        requestedBy: actor.id,
        decidedBy: actor.id,
        decidedAt: now,
      });
      await manager.update(Lead, { id: leadId }, { ownerId: actor.id });
      return { leadId };
    });
  }
}
