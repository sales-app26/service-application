import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SQL_TABLE, TERMINAL_STATUSES } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import {
  EntryType,
  LeaderboardPeriod,
  ProjectStatus,
  TargetPeriod,
  UserRole,
} from '../../common/enums';
import {
  istDayRange,
  istMonthRange,
  istRangeDates,
  istToday,
  istWeekRange,
} from '../../common/utils';
import { ProjectAccessService } from '../access/project-access.service';
import { LeaveLookupService } from '../leaves/leave-lookup.service';
import { TargetsService } from '../reports/targets.service';
import { CoveringDto, LeaderboardDto, RosterRowDto, RosterTargetDto } from './dto/team.dto';
import { compareRoster, rankLeaderboard } from './team-rules';

/** The roles that work leads and show on the team screens. */
const WORKING_ROLES = [UserRole.SALES_PERSON, UserRole.MODERATOR];

interface MemberRow {
  user_id: string;
  name: string;
  phone: string | null;
  email: string;
  role: UserRole;
  project_id: string;
  project_name: string;
  backup_id: string | null;
  backup_name: string | null;
}

interface StatsRow {
  user_id: string;
  last_activity_at: Date | null;
  follow_ups_today: number;
  open_leads: number;
  due_today: number;
  overdue: number;
}

/**
 * The team screens: the project leaderboard any member sees, the roster an
 * admin works from, and the owners a backup is covering for today.
 *
 * Every query is limited to projects the caller may see — a moderator's
 * roster never counts work done in a project he is not in.
 */
@Injectable()
export class TeamService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly leaves: LeaveLookupService,
    private readonly targets: TargetsService,
  ) {}

  /**
   * Conversions and follow-ups this week or month for every active sales
   * person and moderator in the project. No revenue: members compare effort
   * and results, not deal sizes.
   */
  async leaderboard(
    actor: AuthenticatedUser,
    projectId: string,
    period: LeaderboardPeriod = LeaderboardPeriod.WEEK,
  ): Promise<LeaderboardDto> {
    await this.access.assertCanView(actor, projectId);
    const window = period === LeaderboardPeriod.MONTH ? istMonthRange() : istWeekRange();

    const rows = (await this.dataSource.query(
      `SELECT u.id AS user_id, u.name, u.role,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.project_id = $1 AND l.converted_by = u.id AND l.deleted_at IS NULL
                  AND l.converted_at >= $2 AND l.converted_at < $3)::int AS conversions,
              (SELECT count(*) FROM ${SQL_TABLE.FOLLOW_UPS} f
                 JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
                WHERE f.project_id = $1 AND f.user_id = u.id AND f.deleted_at IS NULL
                  AND f.entry_type = $4
                  AND f.created_at >= $2 AND f.created_at < $3)::int AS follow_ups
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u
           ON u.id = pm.user_id AND u.is_active AND u.deleted_at IS NULL AND u.role = ANY($5::text[])
        WHERE pm.project_id = $1 AND pm.is_active`,
      [projectId, window.start, window.end, EntryType.FOLLOW_UP, WORKING_ROLES],
    )) as Array<{
      user_id: string;
      name: string;
      role: UserRole;
      conversions: number;
      follow_ups: number;
    }>;

    const ranked = rankLeaderboard(
      rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        role: row.role,
        conversions: row.conversions,
        followUps: row.follow_ups,
      })),
    );

    return {
      period,
      ...istRangeDates(window),
      rows: ranked.map(({ row, rank }) => ({
        user: { id: row.userId, name: row.name },
        role: row.role,
        conversions: row.conversions,
        followUps: row.followUps,
        rank,
        isMe: row.userId === actor.id,
      })),
    };
  }

  /**
   * The owners the caller covers for today, per project: owners on leave whose
   * backup there is the caller, while he is still a member. Active projects.
   */
  async covering(actor: AuthenticatedUser, projectId?: string): Promise<CoveringDto[]> {
    if (projectId) {
      await this.access.assertCanView(actor, projectId);
    }
    const today = istToday();

    const rows = (await this.dataSource.query(
      `SELECT o.user_id, u.name, o.project_id, p.name AS project_name,
              lv.starts_on::text AS starts_on, lv.ends_on::text AS ends_on,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = o.user_id AND l.project_id = o.project_id AND l.deleted_at IS NULL
                  AND l.next_follow_up_date <= $2::date
                  AND l.status <> ALL($4::text[]))::int AS due_today,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = o.user_id AND l.project_id = o.project_id AND l.deleted_at IS NULL
                  AND l.next_follow_up_date < $2::date
                  AND l.status <> ALL($4::text[]))::int AS overdue
         FROM ${SQL_TABLE.PROJECT_MEMBERS} o
         JOIN ${SQL_TABLE.PROJECT_MEMBERS} a
           ON a.project_id = o.project_id AND a.user_id = $1 AND a.is_active
         JOIN ${SQL_TABLE.USERS} u ON u.id = o.user_id
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = o.project_id AND p.status = $5
         JOIN LATERAL (
              SELECT starts_on, ends_on FROM ${SQL_TABLE.USER_LEAVES} lv
               WHERE lv.user_id = o.user_id AND lv.cancelled_at IS NULL
                 AND lv.starts_on <= $2::date AND lv.ends_on >= $2::date
               ORDER BY lv.ends_on DESC
               LIMIT 1) lv ON true
        WHERE o.backup_user_id = $1 AND o.is_active AND o.user_id <> $1
          AND ($3::uuid IS NULL OR o.project_id = $3::uuid)
        ORDER BY u.name, p.name`,
      [actor.id, today, projectId ?? null, TERMINAL_STATUSES, ProjectStatus.ACTIVE],
    )) as Array<{
      user_id: string;
      name: string;
      project_id: string;
      project_name: string;
      starts_on: string;
      ends_on: string;
      due_today: number;
      overdue: number;
    }>;

    return rows.map((row) => ({
      user: { id: row.user_id, name: row.name },
      projectId: row.project_id,
      projectName: row.project_name,
      leave: { startsOn: row.starts_on, endsOn: row.ends_on },
      dueToday: row.due_today,
      overdue: row.overdue,
    }));
  }

  /**
   * Everyone who works leads in the caller's projects — or in one of them —
   * once each, with who is away, what is due and, for one project, their
   * target. People on leave sort last, then the most overdue first.
   */
  async roster(actor: AuthenticatedUser, projectId?: string): Promise<RosterRowDto[]> {
    if (projectId) {
      await this.access.assertAdmin(actor, projectId);
    }
    const projectIds = projectId ? [projectId] : await this.activeScope(actor);
    if (projectIds.length === 0) return [];

    const members = (await this.dataSource.query(
      `SELECT pm.user_id, u.name, u.phone, u.email, u.role,
              pm.project_id, p.name AS project_name,
              b.id AS backup_id, b.name AS backup_name
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u
           ON u.id = pm.user_id AND u.is_active AND u.deleted_at IS NULL AND u.role = ANY($2::text[])
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id
         LEFT JOIN ${SQL_TABLE.USERS} b ON b.id = pm.backup_user_id
        WHERE pm.is_active AND pm.project_id = ANY($1::uuid[])
        ORDER BY p.name`,
      [projectIds, WORKING_ROLES],
    )) as MemberRow[];
    if (members.length === 0) return [];

    const userIds = [...new Set(members.map((row) => row.user_id))];
    const today = istToday();
    const [stats, onLeave, nextLeave, targets] = await Promise.all([
      this.stats(userIds, projectIds, today),
      this.leaves.onLeave(userIds, today),
      this.leaves.nextLeave(userIds, today),
      projectId ? this.targetsIn(projectId) : Promise.resolve(new Map<string, RosterTargetDto>()),
    ]);

    const rows = new Map<string, RosterRowDto>();
    for (const member of members) {
      const existing = rows.get(member.user_id);
      if (existing) {
        existing.projects.push({ id: member.project_id, name: member.project_name });
        continue;
      }
      const stat = stats.get(member.user_id);
      rows.set(member.user_id, {
        user: { id: member.user_id, name: member.name, phone: member.phone, email: member.email },
        role: member.role,
        projects: [{ id: member.project_id, name: member.project_name }],
        onLeave: onLeave.get(member.user_id) ?? null,
        nextLeave: nextLeave.get(member.user_id) ?? null,
        backup:
          projectId && member.backup_id
            ? { id: member.backup_id, name: member.backup_name ?? '' }
            : null,
        lastActivityAt: stat?.last_activity_at ?? null,
        followUpsToday: stat?.follow_ups_today ?? 0,
        openLeads: stat?.open_leads ?? 0,
        dueToday: stat?.due_today ?? 0,
        overdue: stat?.overdue ?? 0,
        target: projectId ? (targets.get(member.user_id) ?? null) : null,
      });
    }

    return [...rows.values()].sort((a, b) =>
      compareRoster(
        { name: a.user.name, onLeave: a.onLeave, overdue: a.overdue },
        { name: b.user.name, onLeave: b.onLeave, overdue: b.overdue },
      ),
    );
  }

  // ------------------------------------------------------------------ helpers

  /** Active projects the caller administers: every one for the Super Admin. */
  private async activeScope(actor: AuthenticatedUser): Promise<string[]> {
    const scope = await this.access.scopeProjectIds(actor);
    const rows = (await this.dataSource.query(
      `SELECT id FROM ${SQL_TABLE.PROJECTS}
        WHERE status = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [ProjectStatus.ACTIVE, scope ?? null],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** Each person's activity and pipeline, counted only in `projectIds`. */
  private async stats(
    userIds: string[],
    projectIds: string[],
    today: string,
  ): Promise<Map<string, StatsRow>> {
    const { start, end } = istDayRange(today);
    const rows = (await this.dataSource.query(
      `SELECT u.id AS user_id,
              (SELECT max(f.created_at) FROM ${SQL_TABLE.FOLLOW_UPS} f
                WHERE f.user_id = u.id AND f.deleted_at IS NULL
                  AND f.project_id = ANY($2::uuid[])) AS last_activity_at,
              (SELECT count(*) FROM ${SQL_TABLE.FOLLOW_UPS} f
                 JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
                WHERE f.user_id = u.id AND f.deleted_at IS NULL AND f.entry_type = $3
                  AND f.created_at >= $4 AND f.created_at < $5
                  AND f.project_id = ANY($2::uuid[]))::int AS follow_ups_today,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = u.id AND l.deleted_at IS NULL AND l.status <> ALL($6::text[])
                  AND l.project_id = ANY($2::uuid[]))::int AS open_leads,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = u.id AND l.deleted_at IS NULL AND l.status <> ALL($6::text[])
                  AND l.next_follow_up_date <= $7::date
                  AND l.project_id = ANY($2::uuid[]))::int AS due_today,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l
                WHERE l.owner_id = u.id AND l.deleted_at IS NULL AND l.status <> ALL($6::text[])
                  AND l.next_follow_up_date < $7::date
                  AND l.project_id = ANY($2::uuid[]))::int AS overdue
         FROM ${SQL_TABLE.USERS} u
        WHERE u.id = ANY($1::uuid[])`,
      [userIds, projectIds, EntryType.FOLLOW_UP, start, end, TERMINAL_STATUSES, today],
    )) as StatsRow[];
    return new Map(rows.map((row) => [row.user_id, row]));
  }

  /** Target and progress per member of one project; only members with a target. */
  private async targetsIn(projectId: string): Promise<Map<string, RosterTargetDto>> {
    const progress = await this.targets.progress([projectId]);
    return new Map(
      progress
        .filter((row) => row.targetCount !== null && row.targetPeriod !== null)
        .map((row) => [
          row.user.id,
          {
            count: row.targetCount!,
            period: row.targetPeriod as TargetPeriod,
            achieved: row.achieved,
          },
        ]),
    );
  }
}
