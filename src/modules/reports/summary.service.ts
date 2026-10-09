import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  BUSINESS_RULE,
  COMMON_ERROR,
  ERROR_CODE,
  SQL_TABLE,
  USER_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { EntryType, UserRole } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { addDays, daysBetween } from '../../common/utils';
import { User } from '../../database/entities';
import { DaySummaryDto, SummaryDto, SummaryQueryDto } from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';

/** The India calendar date of a timestamptz column, whatever time zone the session uses. */
const IST_DAY = (column: string): string =>
  `to_char((${column} AT TIME ZONE 'UTC') + interval '5 hours 30 minutes', 'YYYY-MM-DD')`;

type Counts = Partial<
  Pick<DaySummaryDto, 'followUps' | 'visits' | 'statusChanges' | 'newLeads' | 'conversions'>
>;

/**
 * One person over a week, a month or any range (admin request after the v1 PRD):
 * what the daily timeline shows, counted per day so a range reads at a glance.
 *
 * It uses the same definitions as the dashboard — a lead is "added" by whoever
 * logged its first entry, a conversion is credited to `converted_by` — so the
 * totals here match the dashboard for the same person and dates.
 */
@Injectable()
export class SummaryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly scope: ReportScopeService,
  ) {}

  async build(actor: AuthenticatedUser, query: SummaryQueryDto): Promise<SummaryDto> {
    const { from, to } = query;
    if (from > to) {
      throw new BusinessException(COMMON_ERROR.INVALID_DATE_RANGE, ERROR_CODE.VALIDATION_FAILED);
    }
    if (daysBetween(from, to) + 1 > BUSINESS_RULE.SUMMARY_MAX_DAYS) {
      throw new BusinessException(
        `A summary can cover at most ${BUSINESS_RULE.SUMMARY_MAX_DAYS} days.`,
        ERROR_CODE.VALIDATION_FAILED,
      );
    }

    const userId = query.userId ?? actor.id;
    if (actor.role === UserRole.SALES_PERSON && userId !== actor.id) {
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }
    const person = await this.users.findOne({ where: { id: userId } });
    if (!person) throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);

    const projectIds = await this.scope.projectScope(actor, query.projectId);
    const byDay = new Map<string, Counts>();
    const add = (date: string, counts: Counts): void => {
      byDay.set(date, { ...byDay.get(date), ...counts });
    };

    if (projectIds === null || projectIds.length > 0) {
      const { start, end } = this.scope.range(from, to);
      const [entries, added, converted] = await Promise.all([
        this.entriesByDay(userId, projectIds, start, end),
        this.leadsAddedByDay(userId, projectIds, start, end),
        this.conversionsByDay(userId, projectIds, start, end),
      ]);
      entries.forEach((row) =>
        add(row.day, {
          followUps: row.follow_ups,
          visits: row.visits,
          statusChanges: row.status_changes,
        }),
      );
      added.forEach((row) => add(row.day, { newLeads: row.count }));
      converted.forEach((row) => add(row.day, { conversions: row.count }));
    }

    const days: DaySummaryDto[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const c = byDay.get(date) ?? {};
      days.push({
        date,
        followUps: c.followUps ?? 0,
        visits: c.visits ?? 0,
        statusChanges: c.statusChanges ?? 0,
        newLeads: c.newLeads ?? 0,
        conversions: c.conversions ?? 0,
      });
    }

    const sum = (pick: (d: DaySummaryDto) => number): number =>
      days.reduce((n, d) => n + pick(d), 0);
    return {
      from,
      to,
      user: { id: person.id, name: person.name },
      totals: {
        followUps: sum((d) => d.followUps),
        visits: sum((d) => d.visits),
        statusChanges: sum((d) => d.statusChanges),
        newLeads: sum((d) => d.newLeads),
        conversions: sum((d) => d.conversions),
        activeDays: days.filter((d) => d.followUps + d.statusChanges > 0).length,
      },
      days,
    };
  }

  private entriesByDay(userId: string, scope: string[] | null, start: Date, end: Date) {
    return this.dataSource.query(
      `SELECT ${IST_DAY('f.created_at')} AS day,
              count(*) FILTER (WHERE f.entry_type = $5)::int AS follow_ups,
              count(*) FILTER (WHERE f.entry_type = $5 AND f.photo_path IS NOT NULL)::int AS visits,
              count(*) FILTER (WHERE f.entry_type <> $5)::int AS status_changes
         FROM ${SQL_TABLE.FOLLOW_UPS} f
         JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
          AND f.user_id = $1
          AND f.created_at >= $2 AND f.created_at < $3
          AND ($4::uuid[] IS NULL OR f.project_id = ANY($4::uuid[]))
        GROUP BY 1`,
      [userId, start, end, scope, EntryType.FOLLOW_UP],
    ) as Promise<
      Array<{ day: string; follow_ups: number; visits: number; status_changes: number }>
    >;
  }

  /** Leads whose first entry was this person's, by the day the lead was added. */
  private leadsAddedByDay(userId: string, scope: string[] | null, start: Date, end: Date) {
    return this.dataSource.query(
      `SELECT ${IST_DAY('l.created_at')} AS day, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
         CROSS JOIN LATERAL (
           SELECT f.user_id FROM ${SQL_TABLE.FOLLOW_UPS} f
            WHERE f.lead_id = l.id
            ORDER BY f.created_at, f.id
            LIMIT 1
         ) creator
        WHERE l.deleted_at IS NULL
          AND creator.user_id = $1
          AND l.created_at >= $2 AND l.created_at < $3
          AND ($4::uuid[] IS NULL OR l.project_id = ANY($4::uuid[]))
        GROUP BY 1`,
      [userId, start, end, scope],
    ) as Promise<Array<{ day: string; count: number }>>;
  }

  private conversionsByDay(userId: string, scope: string[] | null, start: Date, end: Date) {
    return this.dataSource.query(
      `SELECT ${IST_DAY('l.converted_at')} AS day, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.converted_by = $1
          AND l.converted_at >= $2 AND l.converted_at < $3
          AND ($4::uuid[] IS NULL OR l.project_id = ANY($4::uuid[]))
        GROUP BY 1`,
      [userId, start, end, scope],
    ) as Promise<Array<{ day: string; count: number }>>;
  }
}
