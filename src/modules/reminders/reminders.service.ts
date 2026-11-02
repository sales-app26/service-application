import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  CONFIG_NAMESPACE,
  NOTIFICATION_LINK,
  NOTIFICATION_TEXT,
  SQL_TABLE as T,
  TERMINAL_STATUSES,
  TIME_ZONE,
} from '../../common/constants';
import { NextStepChannel, NotificationKind, UserRole } from '../../common/enums';
import { istToday, leadLabel } from '../../common/utils';
import { RemindersConfig } from '../../config/configuration';
import { LeaveLookupService } from '../leaves/leave-lookup.service';
import {
  NotificationInput,
  NotificationSenderService,
} from '../notifications/notification-sender.service';
import { PushService } from './push.service';

const TICK_MS = 60_000;
/** After downtime, a reminder older than this is stale: the morning summary covers it. */
const STALE_AFTER = '2 hours';
/** The morning summary goes out from 9, and not at all if the server was down until noon. */
const DIGEST_FROM_HOUR = 9;
const DIGEST_UNTIL_HOUR = 12;

interface DueLead {
  id: string;
  name: string | null;
  business_name: string | null;
  owner_id: string;
  project_id: string;
  next_follow_up_channel: NextStepChannel | null;
  last_note: string | null;
}

/**
 * Reminders: at a follow-up's time, and a summary each morning. Each lands in the app's
 * notifications and, where the person turned it on, on their phone.
 *
 * Claiming comes first, in a single UPDATE, so two copies of the API can't both send one. The
 * price is that a crash right after claiming loses that reminder; the summary still counts it.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private readonly enabled: boolean;
  private timer?: NodeJS.Timeout;

  constructor(
    configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationSenderService,
    private readonly push: PushService,
    private readonly leaves: LeaveLookupService,
  ) {
    this.enabled = configService.getOrThrow<RemindersConfig>(CONFIG_NAMESPACE.REMINDERS).enabled;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: Error) => this.logger.error(`Reminders: ${error.message}`));
    }, TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<void> {
    await this.sendTimedReminders(now);
    await this.sendMorningDigests(now);
  }

  private async sendTimedReminders(now: Date): Promise<void> {
    const rows = (await this.dataSource.query(
      `WITH due AS (
         SELECT l.id, (l.next_follow_up_date + l.next_follow_up_time::time)
                        AT TIME ZONE '${TIME_ZONE}' AS at
           FROM ${T.LEADS} l
           JOIN ${T.PROJECTS} p ON p.id = l.project_id
          WHERE l.deleted_at IS NULL
            AND l.owner_id IS NOT NULL
            AND l.next_follow_up_time IS NOT NULL
            AND p.status = 'active'
            AND l.status <> ALL($2::text[])
       )
       UPDATE ${T.LEADS} l
          SET reminded_for = due.at
         FROM due
        WHERE l.id = due.id
          AND due.at <= $1
          AND due.at > $1::timestamptz - interval '${STALE_AFTER}'
          AND l.reminded_for IS DISTINCT FROM due.at
       RETURNING l.id, l.name, l.business_name, l.owner_id, l.project_id,
                 l.next_follow_up_channel,
                 (SELECT f.note FROM ${T.FOLLOW_UPS} f
                   WHERE f.lead_id = l.id AND f.deleted_at IS NULL
                   ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS last_note`,
      [now, TERMINAL_STATUSES],
    )) as [DueLead[], number];
    const leads = rows[0] ?? [];
    if (leads.length === 0) return;

    const recipients = await this.recipients(leads, now);
    for (const lead of leads) {
      const userId = recipients.get(lead.id);
      if (!userId) continue;
      const label = leadLabel({ name: lead.name, businessName: lead.business_name });
      await this.deliver({
        userId,
        kind: NotificationKind.FOLLOW_UP_REMINDER,
        title:
          lead.next_follow_up_channel === NextStepChannel.CALL
            ? NOTIFICATION_TEXT.REMINDER_CALL(label)
            : lead.next_follow_up_channel === NextStepChannel.VISIT
              ? NOTIFICATION_TEXT.REMINDER_VISIT(label)
              : NOTIFICATION_TEXT.REMINDER_OTHER(label),
        body: lead.last_note,
        link: NOTIFICATION_LINK.LEAD(lead.id),
        leadId: lead.id,
      });
    }
  }

  /** The owner, or while they're on leave whoever covers for them. No one covering: no one told. */
  private async recipients(leads: DueLead[], now: Date): Promise<Map<string, string>> {
    const owners = [...new Set(leads.map((lead) => lead.owner_id))];
    const onLeave = await this.leaves.onLeave(owners, istToday(now));
    const backups = (await this.dataSource.query(
      `SELECT pm.project_id, pm.user_id, pm.backup_user_id
         FROM ${T.PROJECT_MEMBERS} pm
         JOIN ${T.USERS} b ON b.id = pm.backup_user_id AND b.is_active
        WHERE pm.is_active AND pm.user_id = ANY($1::uuid[])`,
      [owners],
    )) as Array<{ project_id: string; user_id: string; backup_user_id: string }>;
    const active = (await this.dataSource.query(
      `SELECT id FROM ${T.USERS} WHERE is_active AND id = ANY($1::uuid[])`,
      [owners],
    )) as Array<{ id: string }>;
    const activeIds = new Set(active.map((row) => row.id));
    const backupOf = new Map(
      backups.map((row) => [`${row.project_id}/${row.user_id}`, row.backup_user_id]),
    );

    const out = new Map<string, string>();
    for (const lead of leads) {
      if (!activeIds.has(lead.owner_id)) continue;
      const to = onLeave.has(lead.owner_id)
        ? backupOf.get(`${lead.project_id}/${lead.owner_id}`)
        : lead.owner_id;
      if (to) out.set(lead.id, to);
    }
    return out;
  }

  private async sendMorningDigests(now: Date): Promise<void> {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE,
        hour: 'numeric',
        hour12: false,
      }).format(now),
    );
    if (hour < DIGEST_FROM_HOUR || hour >= DIGEST_UNTIL_HOUR) return;

    const today = istToday(now);
    const result = (await this.dataSource.query(
      `WITH counts AS (
         SELECT l.owner_id,
                count(*) FILTER (WHERE l.next_follow_up_date = $1)::int AS today,
                count(*) FILTER (WHERE l.next_follow_up_date < $1)::int AS overdue
           FROM ${T.LEADS} l
           JOIN ${T.PROJECTS} p ON p.id = l.project_id
          WHERE l.deleted_at IS NULL
            AND l.owner_id IS NOT NULL
            AND p.status = 'active'
            AND l.status <> ALL($2::text[])
            AND l.next_follow_up_date <= $1
          GROUP BY l.owner_id
       )
       UPDATE ${T.USERS} u
          SET follow_up_digest_on = $1
         FROM counts c
        WHERE u.id = c.owner_id
          AND u.is_active
          AND u.role <> $3
          AND u.follow_up_digest_on IS DISTINCT FROM $1::date
       RETURNING u.id, c.today, c.overdue`,
      [today, TERMINAL_STATUSES, UserRole.SUPER_ADMIN],
    )) as [Array<{ id: string; today: number; overdue: number }>, number];
    const people = result[0] ?? [];
    if (people.length === 0) return;

    const onLeave = await this.leaves.onLeave(
      people.map((person) => person.id),
      today,
    );
    for (const person of people) {
      if (onLeave.has(person.id)) continue;
      await this.deliver({
        userId: person.id,
        kind: NotificationKind.FOLLOW_UP_REMINDER,
        title: NOTIFICATION_TEXT.REMINDER_DIGEST(person.today, person.overdue),
        link: NOTIFICATION_LINK.HOME,
      });
    }
  }

  private async deliver(item: NotificationInput): Promise<void> {
    await this.notifications.send(null, null, [item]);
    await this.push.send([item.userId], item);
  }
}
