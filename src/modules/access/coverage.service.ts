import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { SQL_TABLE } from '../../common/constants';
import { istToday } from '../../common/utils';
import { isCovering } from './coverage-rules';

interface CoverageRow {
  owner_backup_id: string | null;
  owner_is_member: boolean;
  owner_on_leave: boolean;
  actor_is_member: boolean;
}

/**
 * Leave cover: while a member is on leave, the backup set on their
 * membership works their leads in that project — sees them, logs follow-ups
 * and changes statuses on them — without becoming the owner.
 *
 * Asked fresh on every request, never stored: when the leave ends, is
 * cancelled, or the backup changes, the cover ends with it.
 */
@Injectable()
export class CoverageService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * TRUE when `actorId` covers `ownerId` in `projectId` today (IST). Inside a
   * transaction pass its manager, so the check runs on the same connection.
   * An unassigned lead (`ownerId` null) has no owner to cover for.
   */
  async covers(
    actorId: string,
    ownerId: string | null,
    projectId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    if (!ownerId || actorId === ownerId) return false;

    const runner = manager ?? this.dataSource;
    const [row] = (await runner.query(
      `SELECT o.backup_user_id AS owner_backup_id,
              coalesce(o.is_active, false) AS owner_is_member,
              EXISTS (SELECT 1 FROM ${SQL_TABLE.USER_LEAVES} lv
                       WHERE lv.user_id = $2 AND lv.cancelled_at IS NULL
                         AND lv.starts_on <= $4::date AND lv.ends_on >= $4::date) AS owner_on_leave,
              EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} a
                       WHERE a.project_id = $3 AND a.user_id = $1 AND a.is_active) AS actor_is_member
         FROM (SELECT 1) one
         LEFT JOIN ${SQL_TABLE.PROJECT_MEMBERS} o ON o.project_id = $3 AND o.user_id = $2`,
      [actorId, ownerId, projectId, istToday()],
    )) as CoverageRow[];

    return isCovering({
      actorId,
      ownerId,
      ownerBackupId: row?.owner_backup_id ?? null,
      ownerIsActiveMember: row?.owner_is_member ?? false,
      ownerOnLeaveToday: row?.owner_on_leave ?? false,
      actorIsActiveMember: row?.actor_is_member ?? false,
    });
  }
}
