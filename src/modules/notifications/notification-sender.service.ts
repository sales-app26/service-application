import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { BUSINESS_RULE, SQL_TABLE } from '../../common/constants';
import { NotificationKind, UserRole } from '../../common/enums';
import { UserNotification } from '../../database/entities';

/** One notification to write. The caller decides who may receive it. */
export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  leadId?: string | null;
}

/** The first `NOTIFICATION_PREVIEW_LENGTH` characters of a text, for a notification body. */
export const notificationPreview = (text: string | null | undefined): string | null => {
  if (!text) return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.slice(0, BUSINESS_RULE.NOTIFICATION_PREVIEW_LENGTH) : null;
};

/**
 * Writes in-app notifications for the feature that caused them, in that
 * feature's transaction when it has one — so a notification exists exactly
 * when the change it announces does.
 *
 * Never notifies the actor about his own action, and writes one row per
 * person even if a caller lists someone twice. What goes in a notification is
 * the caller's responsibility: only what the recipient could already see.
 *
 * On its own, with no module dependencies, because leads, comments,
 * transfers and leave all write notifications.
 */
@Injectable()
export class NotificationSenderService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async send(
    manager: EntityManager | null,
    actorId: string,
    items: NotificationInput[],
  ): Promise<number> {
    const seen = new Set<string>();
    const rows = items.filter((item) => {
      if (item.userId === actorId || seen.has(item.userId)) return false;
      seen.add(item.userId);
      return true;
    });
    if (rows.length === 0) return 0;

    await (manager ?? this.dataSource.manager).insert(
      UserNotification,
      rows.map((item) => ({
        userId: item.userId,
        kind: item.kind,
        title: item.title,
        body: notificationPreview(item.body),
        link: item.link ?? null,
        actorId,
        leadId: item.leadId ?? null,
      })),
    );
    return rows.length;
  }

  /**
   * Active, undeleted people who administer the project: every Super Admin,
   * and the moderators who are active members of it.
   */
  async projectAdminIds(projectId: string, manager?: EntityManager): Promise<string[]> {
    const rows = (await (manager ?? this.dataSource).query(
      `SELECT u.id
         FROM ${SQL_TABLE.USERS} u
        WHERE u.is_active AND u.deleted_at IS NULL
          AND (u.role = $2
               OR (u.role = $3 AND EXISTS (
                     SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                      WHERE pm.project_id = $1 AND pm.user_id = u.id AND pm.is_active)))
        ORDER BY u.name`,
      [projectId, UserRole.SUPER_ADMIN, UserRole.MODERATOR],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
}
