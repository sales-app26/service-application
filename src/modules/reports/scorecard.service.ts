import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  BUSINESS_RULE,
  COMMON_ERROR,
  ERROR_CODE,
  FUNNEL_INTERESTED_STATUSES,
  REASON_LABEL,
  REASON_STATUSES,
  REPORT_ERROR,
  SQL_TABLE,
  TERMINAL_STATUSES,
  UNSPECIFIED,
  USER_ERROR,
  YES,
  NO,
  PLAN_LABEL,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { wonMonthlyRevenueSql } from './revenue-rules';
import {
  CommentKind,
  EntryType,
  FunnelStage,
  LeadSource,
  LeadStatus,
  LostReason,
  ProjectStatus,
  TransferStatus,
  UserRole,
} from '../../common/enums';
import {
  BusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { daysBetween, istDateSpan, istDateSql, istToday, toCsv } from '../../common/utils';
import { User } from '../../database/entities';
import { FunnelStepDto, ReasonCountDto, SourceCountDto } from './dto/report.dto';
import {
  PlanMixDto,
  RepReviewDto,
  ReviewFeedbackDto,
  ReviewWinDto,
  ScorecardDto,
  ScorecardNumbersDto,
  ScorecardQueryDto,
  ScorecardRowDto,
} from './dto/scorecard.dto';
import { CsvFile } from './exports.service';
import { ReportScopeService } from './report-scope.service';
import {
  conversionPercent,
  elapsedRange,
  mostCommon,
  oneDecimal,
  percentOf,
  periodTarget,
  ReviewTrendCounts,
  reviewTrend,
  teamAverages,
  teamTotals,
  weekdayOf,
} from './scorecard-rules';
import { TargetsService } from './targets.service';

/**
 * Monthly revenue won, summed over `leads l` exactly as the dashboard sums it
 * (`DashboardService.conversionsByUser`): the deal values of the leads won.
 * Kept in this one place so it can move to the shared won-revenue helper in
 * step with the dashboard.
 */
/** Won revenue per month after discounts: the same rule as the dashboard and exports. */
const WON_REVENUE_SUM = `round(coalesce(sum(${wonMonthlyRevenueSql('l')}), 0), 2)::float8`;
/** The plan's name: the Frostique plan picked, or the free text older deals were saved with. */
const PLAN_NAME_SQL = `CASE l.plan_code ${Object.entries(PLAN_LABEL)
  .map(([code, label]) => `WHEN '${code}' THEN '${label}'`)
  .join(' ')} ELSE nullif(l.plan, '') END`;

const RECENT_WINS = 10;
const RECENT_FEEDBACK = 5;
const DAY_SECONDS = 86_400;

type Reason = LostReason | typeof UNSPECIFIED;

/** The dates a scorecard or review covers, as India dates and as instants. */
interface Window {
  from: string;
  to: string;
  start: Date;
  end: Date;
  today: string;
  /** The part up to today, or null when the period is still ahead. */
  elapsed: { from: string; to: string; days: number } | null;
}

interface Person {
  id: string;
  name: string;
  isActive: boolean;
  onTeam: boolean;
  campaigns: string[];
}

interface WinsRow {
  user_id: string;
  project_id: string;
  count: number;
  revenue: number;
  days: number;
}

/**
 * The team scorecard, its CSV, and one rep's review (sales head and sales
 * managers, to review reps and decide incentives).
 *
 * Every number uses the dashboard's definitions — a lead is added by
 * `created_by`, won by `converted_by` at `converted_at`, a follow-up is an
 * entry of type follow-up and a visit one with a photo — and every query takes
 * the caller's campaign scope as `$scope::uuid[]` (null = every campaign), so
 * a sales manager only ever sees numbers from the campaigns he manages.
 */
@Injectable()
export class ScorecardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly scope: ReportScopeService,
    private readonly targets: TargetsService,
  ) {}

  async scorecard(actor: AuthenticatedUser, query: ScorecardQueryDto): Promise<ScorecardDto> {
    const window = this.window(query, BUSINESS_RULE.DASHBOARD_MAX_DAYS);
    const projectIds = await this.scope.projectScope(actor, query.projectId);
    const rows = await this.rows(projectIds, window);
    return {
      from: window.from,
      to: window.to,
      daysSoFar: window.elapsed?.days ?? 0,
      rows,
      totals: teamTotals(rows),
      averages: teamAverages(rows),
    };
  }

  /** The scorecard as a CSV, with the export limits (at most `EXPORT_MAX_DAYS` days). */
  async scorecardCsv(actor: AuthenticatedUser, query: ScorecardQueryDto): Promise<CsvFile> {
    const window = this.window(query, BUSINESS_RULE.EXPORT_MAX_DAYS);
    const projectIds = await this.scope.projectScope(actor, query.projectId);
    const rows = await this.rows(projectIds, window);
    const averages = teamAverages(rows);

    const cells = (n: ScorecardNumbersDto) => [
      n.leadsAdded,
      n.followUps,
      n.visits,
      n.activeDays,
      n.leaveDays,
      n.dealsWon,
      n.wonRevenue,
      n.conversionPercent,
      n.avgDaysToWin,
      n.target,
      n.achieved,
      n.targetPercent,
      n.overdueNow,
      n.openNow,
      n.lostLeads,
    ];
    const csv = toCsv(
      [
        'Sales rep',
        'Campaign(s)',
        'Leads added',
        'Follow-ups',
        'Visits',
        'Active days',
        'Days on leave',
        'Deals won',
        'Revenue won (₹/month)',
        'Conversion %',
        'Avg days to win',
        'Target',
        'Achieved',
        'Target %',
        'Overdue now',
        'Open leads now',
        'Lost leads',
        'Top lost reason',
        'Handovers asked',
        'Handovers received',
        'Working days',
        'Still on team',
      ],
      [
        ...rows.map((row) => [
          row.user.name,
          row.campaigns.join(', '),
          ...cells(row),
          reasonLabel(row.topLostReason),
          row.handoversAsked,
          row.handoversReceived,
          row.workingDays,
          row.isActive ? YES : NO,
        ]),
        ...(rows.length
          ? [
              summaryRow('Team total', teamTotals(rows)),
              ...(averages ? [summaryRow('Team average', averages)] : []),
            ]
          : []),
      ],
    );
    return {
      fileName: `scorecard_${window.from}_${window.to}.csv`,
      content: Buffer.from(csv, 'utf8'),
    };

    function summaryRow(label: string, n: ScorecardNumbersDto) {
      return [label, '', ...cells(n), '', n.handoversAsked, n.handoversReceived, n.workingDays, ''];
    }
  }

  /** One rep's review: the scorecard numbers beside the team's, plus the detail behind them. */
  async review(
    actor: AuthenticatedUser,
    personId: string,
    query: ScorecardQueryDto,
  ): Promise<RepReviewDto> {
    const window = this.window(query, BUSINESS_RULE.DASHBOARD_MAX_DAYS);
    const person = await this.users.findOne({ where: { id: personId } });
    if (
      !person ||
      person.role === UserRole.SUPER_ADMIN ||
      !(await this.scope.canSeePerson(actor, personId))
    ) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
    const projectIds = await this.scope.projectScope(actor, query.projectId);

    const team = await this.rows(projectIds, window);
    const own =
      team.find((row) => row.user.id === personId) ??
      (await this.rows(projectIds, window, personId))[0] ??
      this.emptyRow(person);

    const empty = projectIds !== null && projectIds.length === 0;
    const [byDay, funnel, sources, lostReasons, planMix, recentWins, feedback] = empty
      ? [new Map(), zeroFunnel(), [], [], [], [], { count: 0, recent: [] }]
      : await Promise.all([
          this.activityByDay(projectIds, window, personId),
          this.funnel(projectIds, window, personId),
          this.sources(projectIds, window, personId),
          this.lostReasons(projectIds, window, personId),
          this.planMix(projectIds, window, personId),
          this.recentWins(projectIds, window, personId),
          this.feedback(projectIds, window, personId),
        ]);

    const trend = reviewTrend(window.from, window.to, byDay);
    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      followUps: 0,
      visits: 0,
    }));
    for (const [day, counts] of byDay) {
      const slot = weekdays[weekdayOf(day)];
      slot.followUps += counts.followUps ?? 0;
      slot.visits += counts.visits ?? 0;
    }

    return {
      from: window.from,
      to: window.to,
      person: {
        id: person.id,
        name: person.name,
        role: person.role,
        isActive: person.isActive && !person.deletedAt,
        campaigns: own.campaigns,
      },
      numbers: own,
      teamAverage: teamAverages(team),
      teamSize: team.length,
      trendBucket: trend.bucket,
      trend: trend.points,
      funnel,
      lostReasons,
      sources,
      planMix,
      recentWins,
      weekdays,
      feedback,
    };
  }

  // ------------------------------------------------------------------ rows

  private window(query: ScorecardQueryDto, maxDays: number): Window {
    if (query.from > query.to) {
      throw new BusinessException(COMMON_ERROR.INVALID_DATE_RANGE, ERROR_CODE.VALIDATION_FAILED);
    }
    if (daysBetween(query.from, query.to) + 1 > maxDays) {
      throw new BusinessException(
        maxDays === BUSINESS_RULE.EXPORT_MAX_DAYS
          ? REPORT_ERROR.EXPORT_RANGE_TOO_LONG
          : REPORT_ERROR.SCORECARD_RANGE_TOO_LONG,
        ERROR_CODE.VALIDATION_FAILED,
      );
    }
    const today = istToday();
    return {
      from: query.from,
      to: query.to,
      ...istDateSpan(query.from, query.to),
      today,
      elapsed: elapsedRange(query.from, query.to, today),
    };
  }

  /**
   * One row per sales rep in scope, by name: everyone on a campaign team now,
   * plus anyone who has since left but did something in the period. With
   * `onlyUserId`, that one person whatever their role (a review of a manager
   * who also sells).
   */
  private async rows(
    scope: string[] | null,
    window: Window,
    onlyUserId: string | null = null,
  ): Promise<ScorecardRowDto[]> {
    if (scope !== null && scope.length === 0) return [];
    const { start, end } = window;
    const params = [start, end, scope, onlyUserId] as const;

    const [people, added, entries, activeDays, leaveDays, wins, lost, pipeline, asked, received] =
      await Promise.all([
        this.population(scope, onlyUserId),
        this.countBy(
          `SELECT l.created_by AS user_id, count(*)::int AS count
             FROM ${SQL_TABLE.LEADS} l
            WHERE l.deleted_at IS NULL
              AND l.created_at >= $1 AND l.created_at < $2
              AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
              AND ($4::uuid IS NULL OR l.created_by = $4::uuid)
            GROUP BY 1`,
          [...params],
        ),
        this.dataSource.query(
          `SELECT f.user_id,
                  count(*) FILTER (WHERE f.entry_type = $5)::int AS follow_ups,
                  count(*) FILTER (WHERE f.entry_type = $5 AND f.photo_path IS NOT NULL)::int AS visits
             FROM ${SQL_TABLE.FOLLOW_UPS} f
             JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
            WHERE f.deleted_at IS NULL
              AND f.created_at >= $1 AND f.created_at < $2
              AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
              AND ($4::uuid IS NULL OR f.user_id = $4::uuid)
            GROUP BY 1`,
          [...params, EntryType.FOLLOW_UP],
        ) as Promise<Array<{ user_id: string; follow_ups: number; visits: number }>>,
        this.daysWithEntries(scope, window, onlyUserId),
        this.daysOnLeave(window, onlyUserId),
        this.dataSource.query(
          `SELECT l.converted_by AS user_id, l.project_id, count(*)::int AS count,
                  ${WON_REVENUE_SUM} AS revenue,
                  coalesce(sum(extract(epoch FROM (l.converted_at - l.created_at))), 0)::float8 / ${DAY_SECONDS} AS days
             FROM ${SQL_TABLE.LEADS} l
            WHERE l.deleted_at IS NULL
              AND l.converted_at >= $1 AND l.converted_at < $2
              AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
              AND ($4::uuid IS NULL OR l.converted_by = $4::uuid)
            GROUP BY 1, 2`,
          [...params],
        ) as Promise<WinsRow[]>,
        this.lostLeads(scope, window, onlyUserId),
        this.dataSource.query(
          `SELECT l.owner_id AS user_id, count(*)::int AS open,
                  count(*) FILTER (WHERE l.next_follow_up_date < $3::date)::int AS overdue
             FROM ${SQL_TABLE.LEADS} l
             JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id AND p.status = $4
            WHERE l.deleted_at IS NULL
              AND l.status <> ALL($5::text[])
              AND ($1::uuid[] IS NULL OR l.project_id = ANY($1::uuid[]))
              AND ($2::uuid IS NULL OR l.owner_id = $2::uuid)
            GROUP BY 1`,
          [scope, onlyUserId, window.today, ProjectStatus.ACTIVE, TERMINAL_STATUSES],
        ) as Promise<Array<{ user_id: string; open: number; overdue: number }>>,
        this.countBy(
          `SELECT t.requested_by AS user_id, count(*)::int AS count
             FROM ${SQL_TABLE.LEAD_TRANSFERS} t
             JOIN ${SQL_TABLE.LEADS} l ON l.id = t.lead_id AND l.deleted_at IS NULL
            WHERE t.created_at >= $1 AND t.created_at < $2
              AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
              AND ($4::uuid IS NULL OR t.requested_by = $4::uuid)
            GROUP BY 1`,
          [...params],
        ),
        this.countBy(
          `SELECT t.to_user_id AS user_id, count(*)::int AS count
             FROM ${SQL_TABLE.LEAD_TRANSFERS} t
             JOIN ${SQL_TABLE.LEADS} l ON l.id = t.lead_id AND l.deleted_at IS NULL
            WHERE t.status = $5
              AND t.decided_at >= $1 AND t.decided_at < $2
              AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
              AND ($4::uuid IS NULL OR t.to_user_id = $4::uuid)
            GROUP BY 1`,
          [...params, TransferStatus.APPROVED],
        ),
      ]);

    // Targets of active members in active campaigns in scope, scaled to the dates.
    const targetRows = await this.targets.progress(scope, { userId: onlyUserId ?? undefined });
    const targets = new Map<string, Map<string, number>>();
    for (const t of targetRows) {
      const scaled = periodTarget(t.targetCount, t.targetPeriod, window.from, window.to);
      if (scaled === null) continue;
      const byProject = targets.get(t.user.id) ?? new Map<string, number>();
      byProject.set(t.projectId, scaled);
      targets.set(t.user.id, byProject);
    }

    const entriesBy = new Map(entries.map((row) => [row.user_id, row]));
    const pipelineBy = new Map(pipeline.map((row) => [row.user_id, row]));
    const winsBy = groupBy(wins, (row) => row.user_id);

    const busy = new Set<string>([
      ...added.keys(),
      ...entriesBy.keys(),
      ...winsBy.keys(),
      ...lost.keys(),
      ...asked.keys(),
      ...received.keys(),
    ]);

    return people
      .filter((person) => person.onTeam || onlyUserId !== null || busy.has(person.id))
      .map((person): ScorecardRowDto => {
        const leave = leaveDays.get(person.id) ?? new Set<string>();
        const active = [...(activeDays.get(person.id) ?? [])].filter((day) => !leave.has(day));
        const won = winsBy.get(person.id) ?? [];
        const dealsWon = won.reduce((n, row) => n + row.count, 0);
        const reasons = lost.get(person.id) ?? new Map<Reason, number>();
        const lostLeads = [...reasons.values()].reduce((n, count) => n + count, 0);
        const ownTargets = targets.get(person.id);
        const target = ownTargets ? [...ownTargets.values()].reduce((a, b) => a + b, 0) : null;
        const achieved = ownTargets
          ? won.filter((row) => ownTargets.has(row.project_id)).reduce((n, row) => n + row.count, 0)
          : dealsWon;

        return {
          user: { id: person.id, name: person.name },
          isActive: person.isActive,
          campaigns: person.campaigns,
          leadsAdded: added.get(person.id) ?? 0,
          followUps: entriesBy.get(person.id)?.follow_ups ?? 0,
          visits: entriesBy.get(person.id)?.visits ?? 0,
          activeDays: active.length,
          workingDays: Math.max(0, (window.elapsed?.days ?? 0) - leave.size),
          leaveDays: leave.size,
          dealsWon,
          wonRevenue: won.reduce((n, row) => n + row.revenue, 0),
          lostLeads,
          conversionPercent: conversionPercent(dealsWon, lostLeads),
          avgDaysToWin: dealsWon
            ? oneDecimal(won.reduce((n, row) => n + row.days, 0) / dealsWon)
            : null,
          target,
          achieved,
          targetPercent: percentOf(achieved, target),
          overdueNow: pipelineBy.get(person.id)?.overdue ?? 0,
          openNow: pipelineBy.get(person.id)?.open ?? 0,
          topLostReason: mostCommon(reasons),
          handoversAsked: asked.get(person.id) ?? 0,
          handoversReceived: received.get(person.id) ?? 0,
        };
      });
  }

  /**
   * Sales reps with a campaign membership in scope (now or before), with the
   * campaigns they are on now — or, if they left them all, the ones they were on.
   */
  private async population(scope: string[] | null, onlyUserId: string | null): Promise<Person[]> {
    const rows = (await this.dataSource.query(
      `SELECT u.id, u.name, (u.is_active AND u.deleted_at IS NULL) AS is_active,
              (bool_or(pm.is_active) AND u.is_active AND u.deleted_at IS NULL) AS on_team,
              array_agg(DISTINCT p.name) FILTER (WHERE pm.is_active) AS current_campaigns,
              array_agg(DISTINCT p.name) AS all_campaigns
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id
        WHERE ($1::uuid[] IS NULL OR pm.project_id = ANY($1::uuid[]))
          AND (($2::uuid IS NULL AND u.role = $3) OR u.id = $2::uuid)
        GROUP BY u.id, u.name, u.is_active, u.deleted_at
        ORDER BY u.name`,
      [scope, onlyUserId, UserRole.SALES_PERSON],
    )) as Array<{
      id: string;
      name: string;
      is_active: boolean;
      on_team: boolean;
      current_campaigns: string[] | null;
      all_campaigns: string[];
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      onTeam: row.on_team,
      campaigns: [...(row.current_campaigns ?? row.all_campaigns)].sort((a, b) =>
        a.localeCompare(b),
      ),
    }));
  }

  private async countBy(sql: string, params: unknown[]): Promise<Map<string, number>> {
    const rows = (await this.dataSource.query(sql, params)) as Array<{
      user_id: string | null;
      count: number;
    }>;
    return new Map(
      rows.filter((row) => row.user_id !== null).map((row) => [row.user_id!, row.count]),
    );
  }

  /** India days on which each person logged any entry in scope. */
  private async daysWithEntries(
    scope: string[] | null,
    window: Window,
    onlyUserId: string | null,
  ): Promise<Map<string, Set<string>>> {
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT f.user_id, ${istDateSql('f.created_at')} AS day
         FROM ${SQL_TABLE.FOLLOW_UPS} f
         JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
          AND f.created_at >= $1 AND f.created_at < $2
          AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR f.user_id = $4::uuid)`,
      [window.start, window.end, scope, onlyUserId],
    )) as Array<{ user_id: string; day: string }>;
    return toDaySets(rows);
  }

  /**
   * India days each person was on leave (not cancelled) in the part of the
   * period up to today. Overlapping leaves count a day once. Leave is per
   * person, not per campaign.
   */
  private async daysOnLeave(
    window: Window,
    onlyUserId: string | null,
  ): Promise<Map<string, Set<string>>> {
    if (!window.elapsed) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT lv.user_id, to_char(d, 'YYYY-MM-DD') AS day
         FROM ${SQL_TABLE.USER_LEAVES} lv
         CROSS JOIN LATERAL generate_series(
                GREATEST(lv.starts_on, $1::date)::timestamp,
                LEAST(lv.ends_on, $2::date)::timestamp,
                interval '1 day') AS d
        WHERE lv.cancelled_at IS NULL
          AND lv.starts_on <= $2::date AND lv.ends_on >= $1::date
          AND ($3::uuid IS NULL OR lv.user_id = $3::uuid)`,
      [window.elapsed.from, window.elapsed.to, onlyUserId],
    )) as Array<{ user_id: string; day: string }>;
    return toDaySets(rows);
  }

  /**
   * Leads each person marked Not interested or Lost in the period, each lead
   * once with its latest reason, leaving out leads that are Won now.
   */
  private async lostLeads(
    scope: string[] | null,
    window: Window,
    onlyUserId: string | null,
  ): Promise<Map<string, Map<Reason, number>>> {
    const rows = (await this.dataSource.query(
      `SELECT x.user_id, x.reason, count(*)::int AS count
         FROM (SELECT DISTINCT ON (f.user_id, f.lead_id) f.user_id, coalesce(f.reason, $5) AS reason
                 FROM ${SQL_TABLE.FOLLOW_UPS} f
                 JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
                WHERE f.deleted_at IS NULL
                  AND f.status = ANY($6::text[])
                  AND l.status <> $7
                  AND f.created_at >= $1 AND f.created_at < $2
                  AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
                  AND ($4::uuid IS NULL OR f.user_id = $4::uuid)
                ORDER BY f.user_id, f.lead_id, f.created_at DESC) x
        GROUP BY 1, 2`,
      [
        window.start,
        window.end,
        scope,
        onlyUserId,
        UNSPECIFIED,
        REASON_STATUSES,
        LeadStatus.CONVERTED,
      ],
    )) as Array<{ user_id: string; reason: Reason; count: number }>;

    const byUser = new Map<string, Map<Reason, number>>();
    for (const row of rows) {
      const reasons = byUser.get(row.user_id) ?? new Map<Reason, number>();
      reasons.set(row.reason, row.count);
      byUser.set(row.user_id, reasons);
    }
    return byUser;
  }

  private emptyRow(person: User): ScorecardRowDto {
    return {
      user: { id: person.id, name: person.name },
      isActive: person.isActive && !person.deletedAt,
      campaigns: [],
      ...teamTotals([]),
      target: null,
      targetPercent: null,
      topLostReason: null,
    };
  }

  // ---------------------------------------------------------------- review

  /** Follow-ups, visits, leads added and deals won per India day. */
  private async activityByDay(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<Map<string, Partial<ReviewTrendCounts>>> {
    const params = [window.start, window.end, scope, userId];
    const [entries, added, won] = await Promise.all([
      this.dataSource.query(
        `SELECT ${istDateSql('f.created_at')} AS day, count(*)::int AS follow_ups,
                count(*) FILTER (WHERE f.photo_path IS NOT NULL)::int AS visits
           FROM ${SQL_TABLE.FOLLOW_UPS} f
           JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
          WHERE f.deleted_at IS NULL AND f.entry_type = $5
            AND f.created_at >= $1 AND f.created_at < $2
            AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
            AND f.user_id = $4::uuid
          GROUP BY 1`,
        [...params, EntryType.FOLLOW_UP],
      ) as Promise<Array<{ day: string; follow_ups: number; visits: number }>>,
      this.dataSource.query(
        `SELECT ${istDateSql('l.created_at')} AS day, count(*)::int AS count
           FROM ${SQL_TABLE.LEADS} l
          WHERE l.deleted_at IS NULL
            AND l.created_at >= $1 AND l.created_at < $2
            AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
            AND l.created_by = $4::uuid
          GROUP BY 1`,
        params,
      ) as Promise<Array<{ day: string; count: number }>>,
      this.dataSource.query(
        `SELECT ${istDateSql('l.converted_at')} AS day, count(*)::int AS count
           FROM ${SQL_TABLE.LEADS} l
          WHERE l.deleted_at IS NULL
            AND l.converted_at >= $1 AND l.converted_at < $2
            AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
            AND l.converted_by = $4::uuid
          GROUP BY 1`,
        params,
      ) as Promise<Array<{ day: string; count: number }>>,
    ]);

    const byDay = new Map<string, Partial<ReviewTrendCounts>>();
    const add = (day: string, counts: Partial<ReviewTrendCounts>): void => {
      byDay.set(day, { ...byDay.get(day), ...counts });
    };
    entries.forEach((row) => add(row.day, { followUps: row.follow_ups, visits: row.visits }));
    added.forEach((row) => add(row.day, { newLeads: row.count }));
    won.forEach((row) => add(row.day, { wins: row.count }));
    return byDay;
  }

  /** Leads added in the period that the rep owns or added, by the furthest stage reached. */
  private async funnel(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<FunnelStepDto[]> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS created,
              count(*) FILTER (WHERE l.status <> $5)::int AS contacted,
              count(*) FILTER (WHERE l.status = ANY($6::text[]))::int AS interested,
              count(*) FILTER (WHERE l.status = $7)::int AS converted
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND (l.owner_id = $4::uuid OR l.created_by = $4::uuid)`,
      [
        window.start,
        window.end,
        scope,
        userId,
        LeadStatus.NEW,
        FUNNEL_INTERESTED_STATUSES,
        LeadStatus.CONVERTED,
      ],
    )) as Array<Record<FunnelStage, number>>;
    return Object.values(FunnelStage).map((stage) => ({ stage, count: row?.[stage] ?? 0 }));
  }

  /** The funnel's leads by source, most common first. */
  private async sources(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<SourceCountDto[]> {
    return (await this.dataSource.query(
      `SELECT coalesce(l.source, $5) AS source, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND (l.owner_id = $4::uuid OR l.created_by = $4::uuid)
        GROUP BY 1
        ORDER BY 2 DESC, 1`,
      [window.start, window.end, scope, userId, UNSPECIFIED],
    )) as Array<{ source: LeadSource | typeof UNSPECIFIED; count: number }>;
  }

  private async lostReasons(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<ReasonCountDto[]> {
    const reasons = (await this.lostLeads(scope, window, userId)).get(userId) ?? new Map();
    return [...reasons.entries()]
      .map(([reason, count]: [Reason, number]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  }

  /** Deals won in the period by the plan recorded on the lead. */
  private async planMix(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<PlanMixDto[]> {
    return (await this.dataSource.query(
      `SELECT coalesce(${PLAN_NAME_SQL}, $5) AS plan, count(*)::int AS count,
              ${WON_REVENUE_SUM} AS revenue
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.converted_at >= $1 AND l.converted_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND l.converted_by = $4::uuid
        GROUP BY 1
        ORDER BY 2 DESC, 3 DESC, 1`,
      [window.start, window.end, scope, userId, UNSPECIFIED],
    )) as PlanMixDto[];
  }

  private async recentWins(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<ReviewWinDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT l.id, l.name, l.business_name, p.name AS project_name, ${PLAN_NAME_SQL} AS plan,
              CASE WHEN l.deal_value IS NULL THEN NULL ELSE round(${wonMonthlyRevenueSql('l')}, 2)::float8 END AS deal_value,
              l.converted_at
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id
        WHERE l.deleted_at IS NULL
          AND l.converted_at >= $1 AND l.converted_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND l.converted_by = $4::uuid
        ORDER BY l.converted_at DESC
        LIMIT ${RECENT_WINS}`,
      [window.start, window.end, scope, userId],
    )) as Array<{
      id: string;
      name: string;
      business_name: string | null;
      project_name: string;
      plan: string | null;
      deal_value: number | null;
      converted_at: Date;
    }>;
    return rows.map((row) => ({
      leadId: row.id,
      leadName: row.name,
      businessName: row.business_name,
      projectName: row.project_name,
      plan: row.plan,
      dealValue: row.deal_value,
      wonAt: row.converted_at,
    }));
  }

  /** Managers' feedback on the rep's own follow-ups, written in the period. */
  private async feedback(
    scope: string[] | null,
    window: Window,
    userId: string,
  ): Promise<{ count: number; recent: ReviewFeedbackDto[] }> {
    const rows = (await this.dataSource.query(
      `SELECT c.id, c.body, c.created_at, c.lead_id, c.entry_id, l.name AS lead_name,
              a.id AS author_id, a.name AS author_name, count(*) OVER ()::int AS total
         FROM ${SQL_TABLE.LEAD_COMMENTS} c
         JOIN ${SQL_TABLE.FOLLOW_UPS} f ON f.id = c.entry_id AND f.deleted_at IS NULL
         JOIN ${SQL_TABLE.LEADS} l ON l.id = c.lead_id AND l.deleted_at IS NULL
         JOIN ${SQL_TABLE.USERS} a ON a.id = c.user_id
        WHERE c.kind = $5 AND c.deleted_at IS NULL
          AND c.created_at >= $1 AND c.created_at < $2
          AND ($3::uuid[] IS NULL OR c.project_id = ANY($3::uuid[]))
          AND f.user_id = $4::uuid
        ORDER BY c.created_at DESC
        LIMIT ${RECENT_FEEDBACK}`,
      [window.start, window.end, scope, userId, CommentKind.FEEDBACK],
    )) as Array<{
      id: string;
      body: string;
      created_at: Date;
      lead_id: string;
      entry_id: string | null;
      lead_name: string;
      author_id: string;
      author_name: string;
      total: number;
    }>;
    return {
      count: rows[0]?.total ?? 0,
      recent: rows.map((row) => ({
        id: row.id,
        body: row.body,
        author: { id: row.author_id, name: row.author_name },
        leadId: row.lead_id,
        leadName: row.lead_name,
        entryId: row.entry_id,
        createdAt: row.created_at,
      })),
    };
  }
}

const toDaySets = (rows: Array<{ user_id: string; day: string }>): Map<string, Set<string>> => {
  const byUser = new Map<string, Set<string>>();
  for (const row of rows) {
    const days = byUser.get(row.user_id) ?? new Set<string>();
    days.add(row.day);
    byUser.set(row.user_id, days);
  }
  return byUser;
};

const groupBy = <T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k === null) continue;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return groups;
};

const zeroFunnel = (): FunnelStepDto[] =>
  Object.values(FunnelStage).map((stage) => ({ stage, count: 0 }));

const reasonLabel = (reason: Reason | null): string =>
  reason === null ? '' : reason === UNSPECIFIED ? 'No reason given' : REASON_LABEL[reason];
