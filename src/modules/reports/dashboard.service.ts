import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SUCCESS_MESSAGE, SQL_TABLE } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { EntryType, LeadStatus, ProjectStatus, TransferStatus, UserRole } from '../../common/enums';
import { istDayRange, istToday, istWeekRange } from '../../common/utils';
import {
  ConversionDto,
  DashboardDto,
  IdleMemberDto,
  PersonActivityDto,
  ReportFilterDto,
  StatusCountDto,
} from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';
import { TargetsService } from './targets.service';

/** A week of conversions is small; this only guards a pathological week. */
const CONVERSIONS_LIST_LIMIT = 500;

interface CountByUser {
  user_id: string;
  count: number;
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
    const projectIds = await this.scope.projectScope(actor, filter.projectId);
    const userId = filter.userId ?? null;
    const today = istDayRange(istToday());
    const week = istWeekRange();

    const [targets, creators, followUps, conversions, idle, statuses, weekConversions, pending] =
      await Promise.all([
        this.targets.progress(projectIds, { userId: filter.userId }),
        this.newLeadsByCreator(projectIds, userId, range.start, range.end),
        this.followUpsByUser(projectIds, userId, range.start, range.end, today.start, today.end),
        this.conversionsByUser(projectIds, userId, range.start, range.end),
        this.loggedNothingToday(projectIds, userId, today.start, today.end),
        this.leadsByStatus(projectIds, userId),
        this.conversionsThisWeek(projectIds, userId, week.start, week.end),
        this.pendingTransfers(projectIds),
      ]);

    const newLeads = sum(creators);
    const followUpsInRange = followUps.reduce((total, row) => total + row.in_range, 0);
    const people = await this.people(projectIds, userId, creators, followUps, conversions);

    return {
      from: range.from,
      to: range.to,
      targets,
      newLeads,
      followUps: followUpsInRange,
      followUpsToday: followUps.reduce((total, row) => total + row.today, 0),
      people,
      loggedNothingToday: idle,
      leadsByStatus: statuses,
      conversionsThisWeek: weekConversions,
      pendingTransfers: pending,
      message: newLeads === 0 && followUpsInRange === 0 ? SUCCESS_MESSAGE.NO_DATA : null,
    };
  }

  /**
   * Leads added in the range, credited to whoever logged the lead's first
   * entry — the person who added it, even if it has since been transferred.
   */
  private newLeadsByCreator(
    scope: string[] | null,
    userId: string | null,
    start: Date,
    end: Date,
  ): Promise<CountByUser[]> {
    return this.dataSource.query(
      `SELECT creator.user_id, count(*)::int AS count
         FROM ${SQL_TABLE.LEADS} l
         CROSS JOIN LATERAL (
           SELECT f.user_id FROM ${SQL_TABLE.FOLLOW_UPS} f
            WHERE f.lead_id = l.id
            ORDER BY f.created_at, f.id
            LIMIT 1
         ) creator
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR creator.user_id = $4::uuid)
        GROUP BY creator.user_id`,
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
  ): Promise<CountByUser[]> {
    return this.dataSource.query(
      `SELECT l.converted_by AS user_id, count(*)::int AS count
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
   * (Assumption 11). Someone who joined today is included until they log.
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
        GROUP BY pm.user_id, u.name, u.role
        ORDER BY u.name`,
      [ProjectStatus.ACTIVE, scope, userId, UserRole.MODERATOR, todayStart, todayEnd],
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
    conversions: CountByUser[],
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

    const ids = new Set<string>([
      ...activeIds.map((row) => row.user_id),
      ...creators.map((row) => row.user_id),
      ...followUps.map((row) => row.user_id),
      ...conversions.map((row) => row.user_id),
    ]);
    if (ids.size === 0) return [];

    const users = (await this.dataSource.query(
      `SELECT id, name, role FROM ${SQL_TABLE.USERS} WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [[...ids]],
    )) as Array<{ id: string; name: string; role: UserRole }>;

    const created = new Map(creators.map((row) => [row.user_id, row.count]));
    const logged = new Map(followUps.map((row) => [row.user_id, row]));
    const converted = new Map(conversions.map((row) => [row.user_id, row.count]));

    return users.map((user) => ({
      user: { id: user.id, name: user.name },
      role: user.role,
      newLeads: created.get(user.id) ?? 0,
      followUps: logged.get(user.id)?.in_range ?? 0,
      conversions: converted.get(user.id) ?? 0,
      followUpsToday: logged.get(user.id)?.today ?? 0,
    }));
  }
}

const sum = (rows: CountByUser[]): number => rows.reduce((total, row) => total + row.count, 0);
