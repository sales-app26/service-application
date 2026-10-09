import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';

import { NOT_DUE_STATUSES, SUCCESS_MESSAGE, SQL_TABLE } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { EntryType, ProjectStatus } from '../../common/enums';
import { istDayRange, istToday } from '../../common/utils';
import { Lead } from '../../database/entities';
import { LeadSummaryDto } from '../leads/dto/lead.dto';
import { LeadPresenter } from '../leads/lead.presenter';
import { DueTodayQueryDto, HomeDto, TargetProgressDto } from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';
import { TargetsService } from './targets.service';

/**
 * The member's own screens (PRD §6: Home, My day): target progress, the
 * Due today list and a few counts.
 */
@Injectable()
export class MeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    private readonly scope: ReportScopeService,
    private readonly targets: TargetsService,
    private readonly leadPresenter: LeadPresenter,
  ) {}

  async home(actor: AuthenticatedUser, projectId?: string): Promise<HomeDto> {
    const projectIds = await this.scope.projectScope(actor, projectId);
    const today = istToday();
    const { start, end } = istDayRange(today);

    const [targets, due, counts] = await Promise.all([
      this.targets.progress(projectIds, { userId: actor.id }),
      this.dueQuery(actor.id, today, projectId)
        .select('count(*)::int', 'due')
        .addSelect('count(*) FILTER (WHERE l.next_follow_up_date < :today)::int', 'overdue')
        .getRawOne<{ due: number; overdue: number }>(),
      this.dataSource.query(
        `SELECT
           (SELECT count(*) FROM ${SQL_TABLE.FOLLOW_UPS} f
              JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
             WHERE f.user_id = $1 AND f.entry_type = $2 AND f.deleted_at IS NULL
               AND f.created_at >= $3 AND f.created_at < $4
               AND ($5::uuid[] IS NULL OR f.project_id = ANY($5::uuid[])))::int AS follow_ups_today,
           (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
             WHERE l.owner_id = $1 AND l.deleted_at IS NULL
               AND ($5::uuid[] IS NULL OR l.project_id = ANY($5::uuid[])))::int AS my_leads`,
        [actor.id, EntryType.FOLLOW_UP, start, end, projectIds],
      ) as Promise<Array<{ follow_ups_today: number; my_leads: number }>>,
    ]);

    return {
      targets: targets as TargetProgressDto[],
      dueToday: due?.due ?? 0,
      overdue: due?.overdue ?? 0,
      followUpsToday: counts[0]?.follow_ups_today ?? 0,
      myLeads: counts[0]?.my_leads ?? 0,
      notice: projectIds !== null && projectIds.length === 0 ? SUCCESS_MESSAGE.NO_PROJECTS : null,
    };
  }

  /**
   * Due today (FR-10, DB Design §5): leads the caller owns whose next date is
   * today or earlier, still open, in an active project he is still a member
   * of — oldest first, each overdue one marked "Overdue by N days".
   */
  async dueToday(
    actor: AuthenticatedUser,
    query: DueTodayQueryDto,
  ): Promise<PaginatedResponseDto<LeadSummaryDto>> {
    if (query.projectId) {
      await this.scope.projectScope(actor, query.projectId);
    }

    const [rows, total] = await this.dueQuery(actor.id, istToday(), query.projectId)
      .leftJoinAndSelect('l.owner', 'owner')
      .leftJoinAndSelect('l.location', 'location')
      .orderBy('l.nextFollowUpDate', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    const items = await this.leadPresenter.summaries(rows, { showOwnerTags: false });
    return PaginatedResponseDto.from([items, total], query.page, query.limit);
  }

  private dueQuery(userId: string, today: string, projectId?: string): SelectQueryBuilder<Lead> {
    const qb = this.leads
      .createQueryBuilder('l')
      .innerJoin('l.project', 'project', 'project.status = :activeStatus', {
        activeStatus: ProjectStatus.ACTIVE,
      })
      .where('l.owner_id = :userId', { userId })
      .andWhere('l.deleted_at IS NULL')
      .andWhere('l.next_follow_up_date <= :today', { today })
      .andWhere('l.status NOT IN (:...notDue)', { notDue: NOT_DUE_STATUSES })
      .andWhere(
        `EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                  WHERE pm.project_id = l.project_id AND pm.user_id = l.owner_id AND pm.is_active)`,
      );

    if (projectId) {
      qb.andWhere('l.project_id = :projectId', { projectId });
    }
    return qb;
  }
}
