import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SQL_TABLE } from '../../common/constants';
import { istToday } from '../../common/utils';
import { LeaveSpanDto } from './dto/leave.dto';

interface SpanRow {
  user_id: string;
  starts_on: string;
  ends_on: string;
}

/**
 * "Who is on leave" for the screens that show it — Me, members, users, the
 * roster — answered for a whole page of people in one query.
 *
 * On its own, with no module dependencies, because auth, users, projects and
 * the team screens all need it.
 */
@Injectable()
export class LeaveLookupService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** The active leave covering `date` (default today, IST), per person who has one. */
  async onLeave(userIds: string[], date: string = istToday()): Promise<Map<string, LeaveSpanDto>> {
    if (userIds.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT ON (lv.user_id) lv.user_id,
              lv.starts_on::text AS starts_on, lv.ends_on::text AS ends_on
         FROM ${SQL_TABLE.USER_LEAVES} lv
        WHERE lv.user_id = ANY($1::uuid[])
          AND lv.cancelled_at IS NULL
          AND lv.starts_on <= $2::date AND lv.ends_on >= $2::date
        ORDER BY lv.user_id, lv.ends_on DESC`,
      [[...new Set(userIds)], date],
    )) as SpanRow[];
    return toMap(rows);
  }

  /** The soonest active leave starting after `today`, per person who has one. */
  async nextLeave(
    userIds: string[],
    today: string = istToday(),
  ): Promise<Map<string, LeaveSpanDto>> {
    if (userIds.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT ON (lv.user_id) lv.user_id,
              lv.starts_on::text AS starts_on, lv.ends_on::text AS ends_on
         FROM ${SQL_TABLE.USER_LEAVES} lv
        WHERE lv.user_id = ANY($1::uuid[])
          AND lv.cancelled_at IS NULL
          AND lv.starts_on > $2::date
        ORDER BY lv.user_id, lv.starts_on`,
      [[...new Set(userIds)], today],
    )) as SpanRow[];
    return toMap(rows);
  }
}

const toMap = (rows: SpanRow[]): Map<string, LeaveSpanDto> =>
  new Map(rows.map((row) => [row.user_id, { startsOn: row.starts_on, endsOn: row.ends_on }]));
