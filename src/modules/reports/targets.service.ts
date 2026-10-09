import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SQL_TABLE } from '../../common/constants';
import { ProjectStatus, TargetPeriod, UserRole } from '../../common/enums';
import { istMonthRange, istWeekRange } from '../../common/utils';
import { TargetProgressDto } from './dto/report.dto';

interface TargetRow {
  project_id: string;
  project_name: string;
  user_id: string;
  user_name: string;
  role: UserRole;
  target_count: number | null;
  target_period: TargetPeriod | null;
  week_count: number;
  month_count: number;
}

/**
 * Target versus achieved (FR-4, FR-5, DB Design §5).
 *
 * Counted, never stored: leads in the project whose `converted_by` is the
 * person and whose `converted_at` falls in the current Monday–Sunday week or
 * calendar month, India time. Because the credit sits on `converted_by`, a
 * transferred lead still counts for whoever converted it; undoing a
 * conversion or deleting the lead drops it at once.
 *
 * There is no target history and no pro-rating (PRD §5.4): a target changed
 * mid-period, or a member who joined mid-month, is measured against the
 * current number for the whole period.
 */
@Injectable()
export class TargetsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async progress(
    scope: string[] | null,
    options: { userId?: string; now?: Date } = {},
  ): Promise<TargetProgressDto[]> {
    const now = options.now ?? new Date();
    const week = istWeekRange(now);
    const month = istMonthRange(now);
    const earliest = week.start < month.start ? week.start : month.start;

    const rows = (await this.dataSource.query(
      `SELECT pm.project_id, p.name AS project_name, pm.user_id, u.name AS user_name, u.role,
              pm.target_count, pm.target_period,
              count(l.id) FILTER (WHERE l.converted_at >= $1 AND l.converted_at < $2)::int AS week_count,
              count(l.id) FILTER (WHERE l.converted_at >= $3 AND l.converted_at < $4)::int AS month_count
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id AND u.is_active
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id AND p.status = $5
         LEFT JOIN ${SQL_TABLE.LEADS} l
                ON l.project_id = pm.project_id
               AND l.converted_by = pm.user_id
               AND l.deleted_at IS NULL
               AND l.converted_at >= $6
        WHERE pm.is_active
          AND ($7::uuid[] IS NULL OR pm.project_id = ANY($7::uuid[]))
          AND ($8::uuid IS NULL OR pm.user_id = $8::uuid)
        GROUP BY pm.id, p.name, u.name, u.role
        ORDER BY p.name, u.name`,
      [
        week.start,
        week.end,
        month.start,
        month.end,
        ProjectStatus.ACTIVE,
        earliest,
        scope,
        options.userId ?? null,
      ],
    )) as TargetRow[];

    return rows.map((row) => {
      const monthly = row.target_period === TargetPeriod.MONTHLY;
      const achieved = monthly ? row.month_count : row.week_count;
      const period = monthly ? month : week;

      return {
        projectId: row.project_id,
        projectName: row.project_name,
        user: { id: row.user_id, name: row.user_name },
        role: row.role,
        targetCount: row.target_count,
        targetPeriod: row.target_period,
        achieved,
        progressPercent: row.target_count ? Math.round((achieved / row.target_count) * 100) : null,
        periodStart: period.start,
        periodEnd: period.end,
        conversionsThisWeek: row.week_count,
        conversionsThisMonth: row.month_count,
      };
    });
  }
}
