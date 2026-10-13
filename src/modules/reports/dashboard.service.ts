import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  ATTENTION_DETAIL,
  BUSINESS_RULE,
  ERROR_CODE,
  FUNNEL_INTERESTED_STATUSES,
  REASON_STATUSES,
  REPORT_ERROR,
  SUCCESS_MESSAGE,
  SQL_TABLE,
  TERMINAL_STATUSES,
  UNSPECIFIED,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import {
  AttentionKind,
  CommentKind,
  EntryType,
  FunnelStage,
  LeadSource,
  LeadStatus,
  LostReason,
  ProjectStatus,
  TargetPeriod,
  TransferStatus,
  UserRole,
} from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { daysBetween, istDateSql, istDayRange, istToday, istWeekRange } from '../../common/utils';
import {
  AttentionItemDto,
  ConversionDto,
  DashboardDto,
  FunnelStepDto,
  IdleMemberDto,
  PersonActivityDto,
  ReasonCountDto,
  ReportFilterDto,
  SourceCountDto,
  StatusCountDto,
  TargetProgressDto,
} from './dto/report.dto';
import {
  attentionSeverity,
  buildTrend,
  idleDays,
  isBehindTarget,
  rankAttention,
  ScoredAttention,
  targetPace,
  TrendCounts,
} from './report-rules';
import { ReportScopeService, ResolvedRange } from './report-scope.service';
import { TargetsService } from './targets.service';

/** A week of conversions is small; this only guards a pathological week. */
const CONVERSIONS_LIST_LIMIT = 500;

const HOUR_MS = 60 * 60 * 1000;

interface CountByUser {
  user_id: string;
  count: number;
}

/**
 * Deal values are summed as float8 so the driver hands back a number rather
 * than bigint's string; exact for any total below 2^53 rupees.
 */
interface ConversionsByUser extends CountByUser {
  revenue: number;
}

/**
 * The admin dashboard (FR-15, PRD §5.12). Nothing here is stored: every
 * number is a query over `leads` and `follow_ups`, so it is current whenever
 * the screen is opened or pulled to refresh.
 *
 * Every query takes the same two filters — `$scope::uuid[]` (null = every
 * project) and `$user::uuid` (null = everyone) — so a moderator can never see
 * a number from outside his projects.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scope: ReportScopeService,
    private readonly targets: TargetsService,
  ) {}

  async build(actor: AuthenticatedUser, filter: ReportFilterDto): Promise<DashboardDto> {
    const range = this.scope.range(filter.from, filter.to);
    if (daysBetween(range.from, range.to) + 1 > BUSINESS_RULE.DASHBOARD_MAX_DAYS) {
      throw new BusinessException(
        REPORT_ERROR.DASHBOARD_RANGE_TOO_LONG,
        ERROR_CODE.VALIDATION_FAILED,
      );
    }
    const projectIds = await this.scope.projectScope(actor, filter.projectId);
    const userId = filter.userId ?? null;
    const now = new Date();
    const today = istDayRange(istToday(now));
    const week = istWeekRange(now);

    const [
      targets,
      creators,
      followUps,
      conversions,
      idle,
      statuses,
      weekConversions,
      pending,
      funnel,
      trend,
      lostReasons,
      sources,
    ] = await Promise.all([
      this.targets.progress(projectIds, { userId: filter.userId, now }),
      this.newLeadsByCreator(projectIds, userId, range.start, range.end),
      this.followUpsByUser(projectIds, userId, range.start, range.end, today.start, today.end),
      this.conversionsByUser(projectIds, userId, range.start, range.end),
      this.loggedNothingToday(projectIds, userId, today.start, today.end),
      this.leadsByStatus(projectIds, userId),
      this.conversionsThisWeek(projectIds, userId, week.start, week.end),
      this.pendingTransfers(projectIds),
      this.funnel(projectIds, userId, range.start, range.end),
      this.trend(projectIds, userId, range),
      this.lostReasons(projectIds, userId, range.start, range.end),
      this.sources(projectIds, userId, range.start, range.end),
    ]);

    const newLeads = sum(creators);
    const followUpsInRange = followUps.reduce((total, row) => total + row.in_range, 0);
    const [people, needsAttention] = await Promise.all([
      this.people(projectIds, userId, creators, followUps, conversions),
      this.needsAttention(projectIds, userId, targets, now),
    ]);

    return {
      from: range.from,
      to: range.to,
      targets,
      newLeads,
      followUps: followUpsInRange,
      followUpsToday: followUps.reduce((total, row) => total + row.today, 0),
      conversions: sum(conversions),
      revenue: conversions.reduce((total, row) => total + row.revenue, 0),
      funnel,
      trendBucket: trend.bucket,
      trend: trend.points,
      lostReasons,
      sources,
      people,
      needsAttention,
      loggedNothingToday: idle,
      leadsByStatus: statuses,
      conversionsThisWeek: weekConversions,
      pendingTransfers: pending,
      message: newLeads === 0 && followUpsInRange === 0 ? SUCCESS_MESSAGE.NO_DATA : null,
    };
  }

  /**
   * Leads added in the range, credited to `created_by` — whoever added it in
   * the app, or the admin who imported it — even if it has since been
   * transferred. Leads imported before that was recorded count in the total
   * under a null person.
   */
  private newLeadsByCreator(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
  ): Promise<CountByUser[]> {
    return this.dataSource.query(
      `SELECT l.created_by AS user_id, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.created_by = $4::uuid)
        GROUP BY l.created_by`,
      [start, end, scope, userId],
    );
  }

  private followUpsByUser(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
    todayStart: Date,
    todayEnd: Date,
  ): Promise<Array<{ user_id: string; in_range: number; today: number }>> {
    return this.dataSource.query(
      `SELECT f.user_id,
              count(*) FILTER (WHERE f.created_at >= $1 AND f.created_at < $2)::int AS in_range,
              count(*) FILTER (WHERE f.created_at >= $3 AND f.created_at < $4)::int AS today
         FROM ${SQL_TABLE.FOLLOW_UPS} f
         JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
          AND f.entry_type = $5
          AND f.created_at >= LEAST($1::timestamptz, $3::timestamptz)
          AND f.created_at < GREATEST($2::timestamptz, $4::timestamptz)
          AND ($6::uuid[] IS NULL OR f.project_id = ANY($6::uuid[]))
          AND ($7::uuid IS NULL OR f.user_id = $7::uuid)
        GROUP BY f.user_id`,
      [start, end, todayStart, todayEnd, EntryType.FOLLOW_UP, scope, userId],
    );
  }

  private conversionsByUser(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
  ): Promise<ConversionsByUser[]> {
    return this.dataSource.query(
      `SELECT l.converted_by AS user_id, count(*)::int AS count,
              coalesce(sum(l.deal_value), 0)::float8 AS revenue
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.converted_at >= $1 AND l.converted_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.converted_by = $4::uuid)
        GROUP BY l.converted_by`,
      [start, end, scope, userId],
    );
  }

  /**
   * Active members of active projects with no entry of any kind today
   * (DB Design §5). Deactivated and removed members are left out; so is a
   * moderator who only supervises — one who owns no leads in the project
   * (Assumption 11) — and anyone on leave today. Someone who joined today is
   * included until they log.
   */
  private async loggedNothingToday(
    scope: string[] | null,
    userId: string | null,
    todayStart: Date,
    todayEnd: Date,
  ): Promise<IdleMemberDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT pm.user_id, u.name, u.role, array_agg(p.name ORDER BY p.name) AS projects
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id AND u.is_active
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id AND p.status = $1
        WHERE pm.is_active
          AND ($2::uuid[] IS NULL OR pm.project_id = ANY($2::uuid[]))
          AND ($3::uuid IS NULL OR pm.user_id = $3::uuid)
          AND (u.role <> $4 OR EXISTS (
                SELECT 1 FROM ${SQL_TABLE.LEADS} l
                 WHERE l.project_id = pm.project_id AND l.owner_id = pm.user_id AND l.deleted_at IS NULL))
          AND NOT EXISTS (
                SELECT 1 FROM ${SQL_TABLE.FOLLOW_UPS} f
                 WHERE f.user_id = pm.user_id
                   AND f.deleted_at IS NULL
                   AND f.created_at >= $5 AND f.created_at < $6
                   AND ($2::uuid[] IS NULL OR f.project_id = ANY($2::uuid[])))
          AND NOT ${onLeaveSql('pm.user_id', '$7')}
        GROUP BY pm.user_id, u.name, u.role
        ORDER BY u.name`,
      [
        ProjectStatus.ACTIVE,
        scope,
        userId,
        UserRole.MODERATOR,
        todayStart,
        todayEnd,
        istToday(todayStart),
      ],
    )) as Array<{ user_id: string; name: string; role: UserRole; projects: string[] }>;

    return rows.map((row) => ({
      user: { id: row.user_id, name: row.name },
      role: row.role,
      projects: row.projects,
    }));
  }

  /** Current status of every lead in scope; all seven statuses, zeros included. */
  private async leadsByStatus(
    scope: string[] | null,
    userId: string | null,
  ): Promise<StatusCountDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT l.status, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND ($1::uuid[] IS NULL OR l.project_id = ANY($1::uuid[]))
          AND ($2::uuid IS NULL OR l.owner_id = $2::uuid)
        GROUP BY l.status`,
      [scope, userId],
    )) as Array<{ status: LeadStatus; count: number }>;

    const counts = new Map(rows.map((row) => [row.status, row.count]));
    return Object.values(LeadStatus).map((status) => ({ status, count: counts.get(status) ?? 0 }));
  }

  /**
   * The spot-check list (PRD §7.5): this week's conversions with the client's
   * phone, tagged when the status was set by hand rather than by a visit.
   */
  private async conversionsThisWeek(
    scope: string[] | null,
    userId: string | null,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<ConversionDto[]> {
    const rows = (await this.dataSource.query(
      `SELECT l.id, l.name, l.business_name, l.phone, l.converted_at,
              p.name AS project_name,
              cb.id AS converted_by_id, cb.name AS converted_by_name,
              o.id AS owner_id, o.name AS owner_name,
              (SELECT f.entry_type FROM ${SQL_TABLE.FOLLOW_UPS} f
                WHERE f.lead_id = l.id AND f.created_at = l.converted_at
                ORDER BY f.id LIMIT 1) AS via
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id
         JOIN ${SQL_TABLE.USERS} cb ON cb.id = l.converted_by
         JOIN ${SQL_TABLE.USERS} o ON o.id = l.owner_id
        WHERE l.deleted_at IS NULL
          AND l.converted_at >= $1 AND l.converted_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.converted_by = $4::uuid)
        ORDER BY l.converted_at DESC
        LIMIT ${CONVERSIONS_LIST_LIMIT}`,
      [weekStart, weekEnd, scope, userId],
    )) as Array<{
      id: string;
      name: string;
      business_name: string | null;
      phone: string;
      converted_at: Date;
      project_name: string;
      converted_by_id: string;
      converted_by_name: string;
      owner_id: string;
      owner_name: string;
      via: EntryType | null;
    }>;

    return rows.map((row) => ({
      leadId: row.id,
      leadName: row.name,
      businessName: row.business_name,
      phone: row.phone,
      projectName: row.project_name,
      convertedBy: { id: row.converted_by_id, name: row.converted_by_name },
      currentOwner: { id: row.owner_id, name: row.owner_name },
      convertedAt: row.converted_at,
      via: row.via ?? EntryType.FOLLOW_UP,
    }));
  }

  private async pendingTransfers(scope: string[] | null): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count
         FROM ${SQL_TABLE.LEAD_TRANSFERS} t
         JOIN ${SQL_TABLE.LEADS} l ON l.id = t.lead_id AND l.deleted_at IS NULL
        WHERE t.status = $1
          AND ($2::uuid[] IS NULL OR l.project_id = ANY($2::uuid[]))`,
      [TransferStatus.PENDING, scope],
    )) as Array<{ count: number }>;
    return row?.count ?? 0;
  }

  /**
   * One row per person: every active member in scope (so a quiet day shows as
   * zeros) plus anyone with activity in the range — including people since
   * removed or deactivated, whose past numbers stay in date-range reports.
   */
  private async people(
    scope: string[] | null,
    userId: string | null,
    creators: CountByUser[],
    followUps: Array<{ user_id: string; in_range: number; today: number }>,
    conversions: ConversionsByUser[],
  ): Promise<PersonActivityDto[]> {
    const activeIds = (await this.dataSource.query(
      `SELECT DISTINCT pm.user_id
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id AND u.is_active
        WHERE pm.is_active
          AND ($1::uuid[] IS NULL OR pm.project_id = ANY($1::uuid[]))
          AND ($2::uuid IS NULL OR pm.user_id = $2::uuid)`,
      [scope, userId],
    )) as Array<{ user_id: string }>;

    const ids = new Set<string>(
      [
        ...activeIds.map((row) => row.user_id),
        ...creators.map((row) => row.user_id),
        ...followUps.map((row) => row.user_id),
        ...conversions.map((row) => row.user_id),
      ].filter((id) => id !== null),
    );
    if (ids.size === 0) return [];

    const users = (await this.dataSource.query(
      `SELECT id, name, role FROM ${SQL_TABLE.USERS} WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [[...ids]],
    )) as Array<{ id: string; name: string; role: UserRole }>;

    const created = new Map(creators.map((row) => [row.user_id, row.count]));
    const logged = new Map(followUps.map((row) => [row.user_id, row]));
    const converted = new Map(conversions.map((row) => [row.user_id, row]));

    return users.map((user) => ({
      user: { id: user.id, name: user.name },
      role: user.role,
      newLeads: created.get(user.id) ?? 0,
      followUps: logged.get(user.id)?.in_range ?? 0,
      conversions: converted.get(user.id)?.count ?? 0,
      revenue: converted.get(user.id)?.revenue ?? 0,
      followUpsToday: logged.get(user.id)?.today ?? 0,
    }));
  }

  // ---------------------------------------------------------------- insights

  /**
   * Leads added in the range, by the furthest stage their current status has
   * reached. With a person filter it follows the owner — whose pipeline it is —
   * so leads imported for him count, unlike `newLeads`, which credits the adder.
   */
  private async funnel(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
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
          AND ($4::uuid IS NULL OR l.owner_id = $4::uuid)`,
      [start, end, scope, userId, LeadStatus.NEW, FUNNEL_INTERESTED_STATUSES, LeadStatus.CONVERTED],
    )) as Array<Record<FunnelStage, number>>;

    return Object.values(FunnelStage).map((stage) => ({ stage, count: row?.[stage] ?? 0 }));
  }

  /** Follow-ups, new leads, conversions and revenue per India day, then bucketed. */
  private async trend(scope: string[] | null, userId: string | null, range: ResolvedRange) {
    const params = [range.start, range.end, scope, userId];
    const [followUps, added, converted] = await Promise.all([
      this.dataSource.query(
        `SELECT ${istDateSql('f.created_at')} AS day, count(*)::int AS count
           FROM ${SQL_TABLE.FOLLOW_UPS} f
           JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
          WHERE f.deleted_at IS NULL
            AND f.entry_type = $5
            AND f.created_at >= $1 AND f.created_at < $2
            AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
            AND ($4::uuid IS NULL OR f.user_id = $4::uuid)
          GROUP BY 1`,
        [...params, EntryType.FOLLOW_UP],
      ) as Promise<Array<{ day: string; count: number }>>,
      this.dataSource.query(
        `SELECT ${istDateSql('l.created_at')} AS day, count(*)::int AS count
           FROM ${SQL_TABLE.LEADS} l
          WHERE l.deleted_at IS NULL
            AND l.created_at >= $1 AND l.created_at < $2
            AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
            AND ($4::uuid IS NULL OR l.created_by = $4::uuid)
          GROUP BY 1`,
        params,
      ) as Promise<Array<{ day: string; count: number }>>,
      this.dataSource.query(
        `SELECT ${istDateSql('l.converted_at')} AS day, count(*)::int AS count,
                coalesce(sum(l.deal_value), 0)::float8 AS revenue
           FROM ${SQL_TABLE.LEADS} l
          WHERE l.deleted_at IS NULL
            AND l.converted_at >= $1 AND l.converted_at < $2
            AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
            AND ($4::uuid IS NULL OR l.converted_by = $4::uuid)
          GROUP BY 1`,
        params,
      ) as Promise<Array<{ day: string; count: number; revenue: number }>>,
    ]);

    const byDay = new Map<string, Partial<TrendCounts>>();
    const add = (day: string, counts: Partial<TrendCounts>): void => {
      byDay.set(day, { ...byDay.get(day), ...counts });
    };
    followUps.forEach((row) => add(row.day, { followUps: row.count }));
    added.forEach((row) => add(row.day, { newLeads: row.count }));
    converted.forEach((row) => add(row.day, { conversions: row.count, revenue: row.revenue }));

    return buildTrend(range.from, range.to, byDay);
  }

  /** Why leads were turned down in the range, from the reasons on those entries. */
  private async lostReasons(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
  ): Promise<ReasonCountDto[]> {
    return (await this.dataSource.query(
      `SELECT coalesce(f.reason, $5) AS reason, count(*)::int AS count
         FROM ${SQL_TABLE.FOLLOW_UPS} f
         JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
        WHERE f.deleted_at IS NULL
          AND f.status = ANY($6::text[])
          AND f.created_at >= $1 AND f.created_at < $2
          AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR f.user_id = $4::uuid)
        GROUP BY 1
        ORDER BY 2 DESC, 1`,
      [start, end, scope, userId, UNSPECIFIED, REASON_STATUSES],
    )) as Array<{ reason: LostReason | typeof UNSPECIFIED; count: number }>;
  }

  /** Leads added in the range by source; like the funnel, a person filter follows the owner. */
  private async sources(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
  ): Promise<SourceCountDto[]> {
    return (await this.dataSource.query(
      `SELECT coalesce(l.source, $5) AS source, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.owner_id = $4::uuid)
        GROUP BY 1
        ORDER BY 2 DESC, 1`,
      [start, end, scope, userId, UNSPECIFIED],
    )) as Array<{ source: LeadSource | typeof UNSPECIFIED; count: number }>;
  }

  // ---------------------------------------------------------- needs attention

  /**
   * What an admin should look at right now, whatever the date range: open
   * help requests, people behind on their target, piles of overdue leads,
   * people who have logged nothing for two days (unless on leave), and
   * transfers nobody has decided. Ranked by how far past its threshold each
   * one is (`report-rules.ts`), help requests first.
   */
  private async needsAttention(
    scope: string[] | null,
    userId: string | null,
    targets: TargetProgressDto[],
    now: Date,
  ): Promise<AttentionItemDto[]> {
    const [piles, idle, transfers, help] = await Promise.all([
      this.overduePiles(scope, userId, istToday(now)),
      this.idleWorkers(scope, userId, now),
      this.staleTransfers(scope, userId, now),
      this.openHelpRequests(scope, userId, now),
    ]);

    const scored: ScoredAttention[] = [];
    for (const target of targets) {
      const pace = targetPace(target, now);
      if (!isBehindTarget(pace)) continue;
      scored.push({
        severity: attentionSeverity(AttentionKind.BEHIND_TARGET, pace.gapPoints),
        item: {
          kind: AttentionKind.BEHIND_TARGET,
          user: target.user,
          projectName: target.projectName,
          detail: ATTENTION_DETAIL.BEHIND_TARGET(
            target.achieved,
            target.targetCount!,
            target.targetPeriod === TargetPeriod.MONTHLY ? 'month' : 'week',
            pace.elapsedPercent,
          ),
        },
      });
    }
    for (const pile of piles) {
      scored.push({
        severity: attentionSeverity(AttentionKind.OVERDUE_PILE, pile.count),
        item: {
          kind: AttentionKind.OVERDUE_PILE,
          user: { id: pile.user_id, name: pile.name },
          projectName: pile.project_name,
          detail: ATTENTION_DETAIL.OVERDUE_PILE(pile.count),
          leadCount: pile.count,
        },
      });
    }
    scored.push(...idle, ...transfers, ...help);

    return rankAttention(scored);
  }

  /** Overdue leads per working owner and project, from `ATTENTION_OVERDUE_PILE` up. */
  private overduePiles(scope: string[] | null, userId: string | null, today: string) {
    return this.dataSource.query(
      `SELECT l.owner_id AS user_id, u.name, p.name AS project_name, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.USERS} u ON u.id = l.owner_id AND u.is_active
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id AND p.status = $1
         JOIN ${SQL_TABLE.PROJECT_MEMBERS} pm
           ON pm.project_id = l.project_id AND pm.user_id = l.owner_id AND pm.is_active
        WHERE l.deleted_at IS NULL
          AND l.next_follow_up_date < $2
          AND l.status <> ALL($3::text[])
          AND ($4::uuid[] IS NULL OR l.project_id = ANY($4::uuid[]))
          AND ($5::uuid IS NULL OR l.owner_id = $5::uuid)
        GROUP BY l.owner_id, u.name, l.project_id, p.name
       HAVING count(*) >= $6`,
      [
        ProjectStatus.ACTIVE,
        today,
        TERMINAL_STATUSES,
        scope,
        userId,
        BUSINESS_RULE.ATTENTION_OVERDUE_PILE,
      ],
    ) as Promise<Array<{ user_id: string; name: string; project_name: string; count: number }>>;
  }

  /**
   * Working members — sales persons and moderators who own leads in an active
   * project — with no entry in scope for `ATTENTION_IDLE_DAYS` India days.
   * Someone who never logged is counted from the day they joined, so a new
   * member is not flagged on day one; someone on leave today is not flagged.
   */
  private async idleWorkers(
    scope: string[] | null,
    userId: string | null,
    now: Date,
  ): Promise<ScoredAttention[]> {
    const rows = (await this.dataSource.query(
      `SELECT pm.user_id, u.name, array_agg(DISTINCT p.name) AS projects,
              min(pm.joined_at) AS joined_at,
              (SELECT max(f.created_at) FROM ${SQL_TABLE.FOLLOW_UPS} f
                WHERE f.user_id = pm.user_id AND f.deleted_at IS NULL
                  AND ($2::uuid[] IS NULL OR f.project_id = ANY($2::uuid[]))) AS last_entry_at,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = pm.user_id AND l.deleted_at IS NULL
                  AND l.status <> ALL($5::text[])
                  AND ($2::uuid[] IS NULL OR l.project_id = ANY($2::uuid[])))::int AS open_leads
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id AND u.is_active AND u.role = ANY($4::text[])
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id AND p.status = $1
        WHERE pm.is_active
          AND ($2::uuid[] IS NULL OR pm.project_id = ANY($2::uuid[]))
          AND ($3::uuid IS NULL OR pm.user_id = $3::uuid)
          AND EXISTS (
                SELECT 1 FROM ${SQL_TABLE.LEADS} l
                 WHERE l.project_id = pm.project_id AND l.owner_id = pm.user_id AND l.deleted_at IS NULL)
          AND NOT ${onLeaveSql('pm.user_id', '$6')}
        GROUP BY pm.user_id, u.name`,
      [
        ProjectStatus.ACTIVE,
        scope,
        userId,
        [UserRole.SALES_PERSON, UserRole.MODERATOR],
        TERMINAL_STATUSES,
        istToday(now),
      ],
    )) as Array<{
      user_id: string;
      name: string;
      projects: string[];
      joined_at: Date;
      last_entry_at: Date | null;
      open_leads: number;
    }>;

    return rows.flatMap((row) => {
      const days = idleDays(row.last_entry_at, row.joined_at, now);
      if (days < BUSINESS_RULE.ATTENTION_IDLE_DAYS) return [];
      return [
        {
          severity: attentionSeverity(AttentionKind.IDLE, days),
          item: {
            kind: AttentionKind.IDLE,
            user: { id: row.user_id, name: row.name },
            projectName: row.projects.length === 1 ? row.projects[0] : null,
            detail: row.last_entry_at
              ? ATTENTION_DETAIL.IDLE(days)
              : ATTENTION_DETAIL.IDLE_NEVER(days),
            leadCount: row.open_leads,
          },
        },
      ];
    });
  }

  /** Pending transfers older than `ATTENTION_STALE_TRANSFER_HOURS`, oldest first. */
  private async staleTransfers(
    scope: string[] | null,
    userId: string | null,
    now: Date,
  ): Promise<ScoredAttention[]> {
    const cutoff = new Date(now.getTime() - BUSINESS_RULE.ATTENTION_STALE_TRANSFER_HOURS * HOUR_MS);
    const rows = (await this.dataSource.query(
      `SELECT t.created_at, l.name AS lead_name, p.name AS project_name,
              fu.id AS from_id, fu.name AS from_name, tu.name AS to_name
         FROM ${SQL_TABLE.LEAD_TRANSFERS} t
         JOIN ${SQL_TABLE.LEADS} l ON l.id = t.lead_id AND l.deleted_at IS NULL
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id
         JOIN ${SQL_TABLE.USERS} fu ON fu.id = t.from_user_id
         JOIN ${SQL_TABLE.USERS} tu ON tu.id = t.to_user_id
        WHERE t.status = $1
          AND t.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR $4::uuid IN (t.from_user_id, t.to_user_id))
        ORDER BY t.created_at
        LIMIT ${BUSINESS_RULE.ATTENTION_LIST_LIMIT}`,
      [TransferStatus.PENDING, cutoff, scope, userId],
    )) as Array<{
      created_at: Date;
      lead_name: string;
      project_name: string;
      from_id: string;
      from_name: string;
      to_name: string;
    }>;

    return rows.map((row) => {
      const hours = Math.floor((now.getTime() - row.created_at.getTime()) / HOUR_MS);
      return {
        severity: attentionSeverity(AttentionKind.STALE_TRANSFER, hours),
        item: {
          kind: AttentionKind.STALE_TRANSFER,
          user: { id: row.from_id, name: row.from_name },
          projectName: row.project_name,
          detail: ATTENTION_DETAIL.STALE_TRANSFER(row.lead_name, row.to_name, hours),
        },
      };
    });
  }

  /**
   * Help requests nobody has resolved yet, on live leads in active projects in
   * scope. With a person filter, those that person asked or that are on his
   * leads.
   */
  private async openHelpRequests(
    scope: string[] | null,
    userId: string | null,
    now: Date,
  ): Promise<ScoredAttention[]> {
    const rows = (await this.dataSource.query(
      `SELECT c.created_at, c.lead_id, l.name AS lead_name, p.name AS project_name,
              u.id AS user_id, u.name AS user_name
         FROM ${SQL_TABLE.LEAD_COMMENTS} c
         JOIN ${SQL_TABLE.LEADS} l ON l.id = c.lead_id AND l.deleted_at IS NULL
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = c.project_id AND p.status = $1
         JOIN ${SQL_TABLE.USERS} u ON u.id = c.user_id
        WHERE c.kind = $2 AND c.resolved_at IS NULL AND c.deleted_at IS NULL
          AND ($3::uuid[] IS NULL OR c.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR $4::uuid IN (c.user_id, l.owner_id))
        ORDER BY c.created_at
        LIMIT ${BUSINESS_RULE.ATTENTION_LIST_LIMIT}`,
      [ProjectStatus.ACTIVE, CommentKind.HELP, scope, userId],
    )) as Array<{
      created_at: Date;
      lead_id: string;
      lead_name: string;
      project_name: string;
      user_id: string;
      user_name: string;
    }>;

    return rows.map((row) => ({
      severity: attentionSeverity(
        AttentionKind.HELP_REQUEST,
        (now.getTime() - row.created_at.getTime()) / HOUR_MS,
      ),
      item: {
        kind: AttentionKind.HELP_REQUEST,
        user: { id: row.user_id, name: row.user_name },
        projectName: row.project_name,
        detail: ATTENTION_DETAIL.HELP_REQUEST(row.lead_name),
        leadId: row.lead_id,
      },
    }));
  }
}

const sum = (rows: CountByUser[]): number => rows.reduce((total, row) => total + row.count, 0);

/** SQL: the person in `userColumn` has an active leave covering the India date in `dateParam`. */
const onLeaveSql = (userColumn: string, dateParam: string): string =>
  `EXISTS (SELECT 1 FROM ${SQL_TABLE.USER_LEAVES} lv
            WHERE lv.user_id = ${userColumn} AND lv.cancelled_at IS NULL
              AND lv.starts_on <= ${dateParam}::date AND lv.ends_on >= ${dateParam}::date)`;
