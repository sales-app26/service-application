import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { EntityManager } from 'typeorm';

import {
  CONFIG_NAMESPACE,
  SQL_TABLE,
  STORAGE_FOLDER,
  TERMINAL_STATUSES,
} from '../../common/constants';
import { EntryType, LeadStatus, ProjectStatus, ProjectType, UserRole } from '../../common/enums';
import { addDays, formatIstStamp, istDateOf, istToday } from '../../common/utils';
import { supabaseConfig, visitConfig } from '../../config/configuration';
import { ImageService } from '../../modules/media/image.service';
import { SupabaseAuthClient } from '../../modules/supabase/supabase-auth.client';
import { SupabaseStorageClient } from '../../modules/supabase/supabase-storage.client';
import { dataSource } from '../data-source';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_MARKER,
  DEMO_PASSWORD,
  DemoEntry,
  DemoLead,
  LEADS,
  PEOPLE,
  PersonKey,
  PROJECTS,
  ProjectKey,
  TRANSFERS,
} from './demo-data';

const RESET = process.argv.includes('--reset');

const namespaces: Record<string, unknown> = {
  [CONFIG_NAMESPACE.SUPABASE]: supabaseConfig(),
  [CONFIG_NAMESPACE.VISIT]: visitConfig(),
};
const config = { getOrThrow: (key: string) => namespaces[key] } as unknown as ConfigService;
const authClient = new SupabaseAuthClient(config);
const storage = new SupabaseStorageClient(config);
const images = new ImageService();

const demoEmail = (local: string): string => `${local}@${DEMO_EMAIL_DOMAIN}`;

/** An IST wall-clock time `day` days ago, never in the future. */
const istInstant = (day: number, at: string, now: Date): Date => {
  const instant = new Date(`${addDays(istToday(now), -day)}T${at}:00+05:30`);
  return instant.getTime() < now.getTime() ? instant : new Date(now.getTime() - (5 + day) * 60_000);
};

/** Small, stable offsets so pins in one area do not stack exactly. */
const jitter = (seed: string, scale: number): number => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((hash % 1000) / 1000) * scale;
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

interface PlannedEntry {
  id: string;
  spec: DemoEntry;
  userId: string;
  createdAt: Date;
  nextDate: string | null;
  photoPath: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}

async function seed(): Promise<void> {
  const existing = (await dataSource.query(
    `SELECT count(*)::int AS count FROM ${SQL_TABLE.USERS} WHERE email LIKE $1`,
    [`%@${DEMO_EMAIL_DOMAIN}`],
  )) as Array<{ count: number }>;
  if (existing[0].count > 0) {
    throw new Error('Demo data already exists. Run `npm run db:seed:demo:reset` first.');
  }

  const [superAdmin] = (await dataSource.query(
    `SELECT id, name FROM ${SQL_TABLE.USERS} WHERE role = $1 AND is_active ORDER BY created_at LIMIT 1`,
    [UserRole.SUPER_ADMIN],
  )) as Array<{ id: string; name: string }>;
  if (!superAdmin) {
    throw new Error('No active Super Admin. Run `npm run db:seed` first.');
  }

  const now = new Date();
  const createdAuthIds: string[] = [];
  const uploaded: string[] = [];

  try {
    // 1. Logins — confirmed, with one shared password; no emails are sent.
    const userIds = {} as Record<PersonKey, string>;
    for (const [key, person] of Object.entries(PEOPLE) as Array<
      [PersonKey, (typeof PEOPLE)[PersonKey]]
    >) {
      const { id } = await authClient.createConfirmedUser(
        demoEmail(person.email),
        DEMO_PASSWORD,
        person.name,
      );
      userIds[key] = id;
      createdAuthIds.push(id);
    }
    const who = (key: PersonKey | 'superAdmin'): string =>
      key === 'superAdmin' ? superAdmin.id : userIds[key];
    const nameOf = (userId: string): string =>
      userId === superAdmin.id
        ? superAdmin.name
        : Object.values(PEOPLE)[Object.values(userIds).indexOf(userId)].name;

    // 2. Plan ids, times and visit proof; upload stamped photos before writing rows.
    const projectIds = {} as Record<ProjectKey, string>;
    (Object.keys(PROJECTS) as ProjectKey[]).forEach((key) => (projectIds[key] = randomUUID()));

    const plans = new Map<string, { leadId: string; entries: PlannedEntry[] }>();
    for (const lead of LEADS) {
      const project = PROJECTS[lead.project];
      const entries: PlannedEntry[] = [];

      for (const spec of lead.entries) {
        const createdAt = istInstant(spec.day, spec.at, now);
        const userId = who(spec.by ?? lead.owner);
        const isVisit = project.type === ProjectType.DOOR_TO_DOOR && !spec.manual;
        const id = randomUUID();
        const nextDate =
          spec.next !== undefined && !TERMINAL_STATUSES.includes(spec.status)
            ? addDays(istDateOf(createdAt), spec.next)
            : null;

        let photoPath: string | null = null;
        let latitude: number | null = null;
        let longitude: number | null = null;
        let accuracy: number | null = null;

        if (isVisit) {
          const [lat, lng] = project.locations[lead.location];
          latitude = Number((lat + jitter(lead.business, 0.004) - 0.002).toFixed(6));
          longitude = Number((lng + jitter(lead.name, 0.004) - 0.002).toFixed(6));
          accuracy = spec.accuracy ?? Math.round(6 + Math.abs(jitter(id, 30)));
          photoPath = `${STORAGE_FOLDER.VISITS}/${projectIds[lead.project]}/${istDateOf(createdAt).slice(0, 7)}/${id}.jpg`;

          const photo = await images.processVisitPhoto(await shopfront(lead), {
            latitude,
            longitude,
            accuracyM: accuracy,
            takenAt: formatIstStamp(createdAt),
            personName: nameOf(userId),
          });
          await storage.upload(photoPath, photo.buffer, photo.contentType);
          uploaded.push(photoPath);
        }

        entries.push({
          id,
          spec,
          userId,
          createdAt,
          nextDate,
          photoPath,
          latitude,
          longitude,
          accuracy,
        });
      }
      plans.set(lead.key, { leadId: randomUUID(), entries });
    }

    // 3. Everything else in one transaction.
    await dataSource.transaction(async (manager) => {
      const longAgo = new Date(now.getTime() - 90 * 86_400_000);

      for (const [key, person] of Object.entries(PEOPLE) as Array<
        [PersonKey, (typeof PEOPLE)[PersonKey]]
      >) {
        await manager.query(
          `INSERT INTO ${SQL_TABLE.USERS} (id, name, email, phone, role, is_active, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7, $7)`,
          [
            userIds[key],
            person.name,
            demoEmail(person.email),
            person.phone,
            person.role,
            superAdmin.id,
            longAgo,
          ],
        );
      }

      const locationIds = new Map<string, string>();
      for (const [key, project] of Object.entries(PROJECTS) as Array<
        [ProjectKey, (typeof PROJECTS)[ProjectKey]]
      >) {
        const createdAt = new Date(`${project.startDate}T09:00:00+05:30`);
        const closedAt =
          project.closedDaysAgo !== undefined
            ? istInstant(project.closedDaysAgo, '18:00', now)
            : null;

        await manager.query(
          `INSERT INTO ${SQL_TABLE.PROJECTS}
             (id, name, description, type, status, start_date, end_date, closed_at, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            projectIds[key],
            project.name,
            `${DEMO_MARKER} ${project.description}`,
            project.type,
            closedAt ? ProjectStatus.CLOSED : ProjectStatus.ACTIVE,
            project.startDate,
            project.endDate,
            closedAt,
            superAdmin.id,
            createdAt,
          ],
        );

        for (const member of project.members) {
          await manager.query(
            `INSERT INTO ${SQL_TABLE.PROJECT_MEMBERS}
               (project_id, user_id, target_count, target_period, is_active, assigned_by, joined_at)
             VALUES ($1, $2, $3, $4, true, $5, $6)`,
            [
              projectIds[key],
              userIds[member.person],
              member.target?.[0] ?? null,
              member.target?.[1] ?? null,
              PEOPLE[member.person].role === UserRole.MODERATOR
                ? userIds[member.person]
                : superAdmin.id,
              createdAt,
            ],
          );
        }

        for (const name of Object.keys(project.locations)) {
          const id = randomUUID();
          locationIds.set(`${key}:${name}`, id);
          await manager.query(
            `INSERT INTO ${SQL_TABLE.LOCATIONS} (id, project_id, name, created_by, created_at) VALUES ($1, $2, $3, $4, $5)`,
            [id, projectIds[key], name, superAdmin.id, createdAt],
          );
        }
      }

      for (const lead of LEADS) {
        const plan = plans.get(lead.key)!;
        await insertLead(manager, lead, plan, {
          projectId: projectIds[lead.project],
          ownerId: userIds[lead.owner],
          locationId: locationIds.get(`${lead.project}:${lead.location}`)!,
        });
      }

      for (const transfer of TRANSFERS) {
        const leadId = plans.get(transfer.lead)!.leadId;
        const decidedAt = transfer.decision
          ? istInstant(transfer.decision.day, transfer.decision.at, now)
          : null;

        await manager.query(
          `INSERT INTO ${SQL_TABLE.LEAD_TRANSFERS}
             (lead_id, from_user_id, to_user_id, reason, status, requested_by, created_at, decided_by, decided_at, decision_note)
           VALUES ($1, $2, $3, $4, $5, $2, $6, $7, $8, $9)`,
          [
            leadId,
            userIds[transfer.from],
            userIds[transfer.to],
            transfer.reason,
            transfer.decision?.status ?? 'pending',
            istInstant(transfer.day, transfer.at, now),
            transfer.decision ? who(transfer.decision.by) : null,
            decidedAt,
            transfer.decision?.note ?? null,
          ],
        );
      }

      // Last: deactivation does not erase history, it only stops new work.
      for (const [key, person] of Object.entries(PEOPLE) as Array<
        [PersonKey, (typeof PEOPLE)[PersonKey]]
      >) {
        if (person.deactivated) {
          await manager.query(`UPDATE ${SQL_TABLE.USERS} SET is_active = false WHERE id = $1`, [
            userIds[key],
          ]);
        }
      }
    });

    console.warn(
      [
        `Demo data created: ${Object.keys(PEOPLE).length} people, ${Object.keys(PROJECTS).length} projects, ` +
          `${LEADS.length} leads, ${[...plans.values()].reduce((n, p) => n + p.entries.length, 0)} entries, ` +
          `${uploaded.length} visit photos, ${TRANSFERS.length} transfers.`,
        '',
        `Every demo login uses the password ${DEMO_PASSWORD}:`,
        ...Object.values(PEOPLE).map(
          (person) =>
            `  ${demoEmail(person.email).padEnd(28)} ${person.role.padEnd(13)} ${person.name}${person.deactivated ? '  (deactivated)' : ''}`,
        ),
      ].join('\n'),
    );
  } catch (error) {
    await storage.removeObjects(uploaded);
    for (const id of createdAuthIds) await authClient.deleteUserAsAdmin(id);
    throw error;
  }
}

/**
 * The lead and its history, with the lead's current state derived from the
 * entries by the same rules the API applies on every save.
 */
async function insertLead(
  manager: EntityManager,
  lead: DemoLead,
  plan: { leadId: string; entries: PlannedEntry[] },
  ids: { projectId: string; ownerId: string; locationId: string },
): Promise<void> {
  const { entries } = plan;
  const last = entries[entries.length - 1];

  let convertedAt: Date | null = null;
  let convertedBy: string | null = null;
  if (last.spec.status === LeadStatus.CONVERTED) {
    let start = entries.length - 1;
    while (start > 0 && entries[start - 1].spec.status === LeadStatus.CONVERTED) start -= 1;
    convertedAt = entries[start].createdAt;
    // The owner at that moment is credited, never an admin who set it by hand.
    convertedBy = entries[start].spec.manual ? ids.ownerId : entries[start].userId;
  }

  await manager.query(
    `INSERT INTO ${SQL_TABLE.LEADS}
       (id, project_id, owner_id, name, business_name, phone, location_id, notes, status,
        next_follow_up_date, converted_at, converted_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      plan.leadId,
      ids.projectId,
      ids.ownerId,
      lead.name,
      lead.business,
      lead.phone,
      ids.locationId,
      lead.notes ?? null,
      last.spec.status,
      last.nextDate,
      convertedAt,
      convertedBy,
      entries[0].createdAt,
      last.createdAt,
    ],
  );

  for (const entry of entries) {
    await manager.query(
      `INSERT INTO ${SQL_TABLE.FOLLOW_UPS}
         (id, lead_id, project_id, user_id, entry_type, status, note, next_follow_up_date, location_id,
          photo_path, latitude, longitude, gps_accuracy_m, client_request_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
      [
        entry.id,
        plan.leadId,
        ids.projectId,
        entry.userId,
        entry.spec.manual ? EntryType.STATUS_CHANGE : EntryType.FOLLOW_UP,
        entry.spec.status,
        entry.spec.note,
        entry.nextDate,
        entry.spec.manual ? null : ids.locationId,
        entry.photoPath,
        entry.latitude,
        entry.longitude,
        entry.accuracy,
        randomUUID(),
        entry.createdAt,
      ],
    );
  }
}

/** A simple shop front with the business name on the signboard. */
async function shopfront(lead: DemoLead): Promise<Buffer> {
  const hue = Math.abs(Math.round(jitter(lead.business, 360)));
  const sign = lead.business.replace(/[<>&'"]/gu, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
  <rect width="1200" height="900" fill="hsl(${hue},25%,82%)"/>
  <rect x="120" y="140" width="960" height="150" rx="10" fill="hsl(${hue},55%,35%)"/>
  <text x="600" y="240" font-family="DejaVu Sans, Arial, sans-serif" font-size="64" font-weight="bold" fill="#fff" text-anchor="middle">${sign}</text>
  <rect x="160" y="330" width="880" height="470" fill="hsl(${hue},15%,30%)"/>
  <rect x="200" y="370" width="380" height="390" fill="hsl(${hue},30%,70%)"/>
  <rect x="620" y="370" width="380" height="390" fill="hsl(${hue},30%,65%)"/>
  <rect x="0" y="800" width="1200" height="100" fill="#8a8a8a"/>
</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function reset(): Promise<void> {
  const projects = (await dataSource.query(
    `SELECT id FROM ${SQL_TABLE.PROJECTS} WHERE description LIKE $1`,
    [`${DEMO_MARKER}%`],
  )) as Array<{ id: string }>;
  const users = (await dataSource.query(`SELECT id FROM ${SQL_TABLE.USERS} WHERE email LIKE $1`, [
    `%@${DEMO_EMAIL_DOMAIN}`,
  ])) as Array<{ id: string }>;

  const projectIds = projects.map((row) => row.id);
  const userIds = users.map((row) => row.id);

  const photos = (await dataSource.query(
    `SELECT photo_path FROM ${SQL_TABLE.FOLLOW_UPS} WHERE project_id = ANY($1::uuid[]) AND photo_path IS NOT NULL`,
    [projectIds],
  )) as Array<{ photo_path: string }>;

  await dataSource.transaction(async (manager) => {
    const inDemo = 'project_id = ANY($1::uuid[])';
    await manager.query(
      `DELETE FROM ${SQL_TABLE.LEAD_TRANSFERS} WHERE lead_id IN (SELECT id FROM ${SQL_TABLE.LEADS} WHERE ${inDemo})`,
      [projectIds],
    );
    await manager.query(`DELETE FROM ${SQL_TABLE.FOLLOW_UPS} WHERE ${inDemo}`, [projectIds]);
    await manager.query(`DELETE FROM ${SQL_TABLE.LEADS} WHERE ${inDemo}`, [projectIds]);
    await manager.query(`DELETE FROM ${SQL_TABLE.LOCATIONS} WHERE ${inDemo}`, [projectIds]);
    await manager.query(`DELETE FROM ${SQL_TABLE.PROJECT_MEMBERS} WHERE ${inDemo}`, [projectIds]);
    await manager.query(`DELETE FROM ${SQL_TABLE.PROJECTS} WHERE id = ANY($1::uuid[])`, [
      projectIds,
    ]);
    await manager.query(`DELETE FROM ${SQL_TABLE.USERS} WHERE id = ANY($1::uuid[])`, [userIds]);
  });

  await storage.removeObjects(photos.map((row) => row.photo_path));
  for (const id of userIds) await authClient.deleteUserAsAdmin(id);

  console.warn(
    `Demo data removed: ${projectIds.length} projects, ${userIds.length} people, ${photos.length} photos.`,
  );
}

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    await (RESET ? reset() : seed());
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: Error) => {
  console.error(`Demo seed failed: ${error.message}`);
  process.exit(1);
});
