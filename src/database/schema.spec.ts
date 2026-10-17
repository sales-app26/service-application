import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';

import { readSqlFile, SQL_FILE } from './migrations/sql-file.helper';

/**
 * The rules the database enforces (DB Design §3), checked against real
 * PostgreSQL running in-process (PGlite) — no server needed.
 */
describe('01_sales_schema.sql', () => {
  let db: PGlite;
  const admin = randomUUID();
  const seller = randomUUID();
  const project = randomUUID();
  const location = randomUUID();

  const insertLead = (phone: string, extra: Record<string, unknown> = {}) => {
    const lead = {
      id: randomUUID(),
      status: 'new',
      converted_at: null,
      converted_by: null,
      ...extra,
    };
    return db
      .query(
        `INSERT INTO leads (id, project_id, owner_id, name, phone, location_id, status, converted_at, converted_by)
         VALUES ($1, $2, $3, 'Client', $4, $5, $6, $7, $8) RETURNING id`,
        [
          lead.id,
          project,
          seller,
          phone,
          location,
          lead.status,
          lead.converted_at,
          lead.converted_by,
        ],
      )
      .then(() => lead.id);
  };

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readSqlFile(SQL_FILE.SALES_SCHEMA));
    // The file qualifies every name with `sales`; the assertions below don't.
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Admin', 'admin@x.in', 'super_admin'), ($2, 'Seller', 'seller@x.in', 'sales_person')`,
      [admin, seller],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'door_to_door', '2026-10-01', $2)`,
      [project, admin],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`, [
      location,
      project,
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('keeps emails unique and lowercase', async () => {
    await rejects(
      db.query(
        `INSERT INTO users (id, name, email, role) VALUES ($1, 'X', 'admin@x.in', 'moderator')`,
        [randomUUID()],
      ),
      /users_email_key/,
    );
    await rejects(
      db.query(
        `INSERT INTO users (id, name, email, role) VALUES ($1, 'X', 'Upper@x.in', 'moderator')`,
        [randomUUID()],
      ),
      /users_email_lowercase/,
    );
  });

  it('allows only the three roles', async () => {
    await rejects(
      db.query(`INSERT INTO users (id, name, email, role) VALUES ($1, 'X', 'x@x.in', 'owner')`, [
        randomUUID(),
      ]),
      /users_role_valid/,
    );
  });

  it('refuses an end date before the start date', async () => {
    await rejects(
      db.query(
        `INSERT INTO projects (name, type, start_date, end_date, created_by) VALUES ('P', 'online', '2026-10-10', '2026-10-09', $1)`,
        [admin],
      ),
      /projects_end_after_start/,
    );
  });

  it('sets a target count and period together, count at least 1', async () => {
    await rejects(
      db.query(
        `INSERT INTO project_members (project_id, user_id, target_count) VALUES ($1, $2, 5)`,
        [project, seller],
      ),
      /project_members_target_pair/,
    );
    await rejects(
      db.query(
        `INSERT INTO project_members (project_id, user_id, target_count, target_period) VALUES ($1, $2, 0, 'weekly')`,
        [project, seller],
      ),
      /project_members_target_pair/,
    );
    await db.query(
      `INSERT INTO project_members (project_id, user_id, target_count, target_period) VALUES ($1, $2, 5, 'weekly')`,
      [project, seller],
    );
    await rejects(
      db.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)`, [
        project,
        seller,
      ]),
      /project_members_project_user_key/,
    );
  });

  it('treats location names case-insensitively per project', async () => {
    await rejects(
      db.query(`INSERT INTO locations (project_id, name) VALUES ($1, 'WANOWRIE')`, [project]),
      /locations_project_name_key/,
    );
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO locations (project_id, name) VALUES ($1, 'wanowrie') ON CONFLICT (project_id, lower(name)) DO NOTHING RETURNING id`,
      [project],
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses a duplicate phone in a project until the first lead is deleted', async () => {
    const first = await insertLead('9876543210');
    await rejects(insertLead('9876543210'), /leads_project_phone_key/);

    await db.query(`UPDATE leads SET deleted_at = now() WHERE id = $1`, [first]);
    await expect(insertLead('9876543210')).resolves.toBeDefined();
  });

  it('stores phones as 10-digit Indian mobiles only', async () => {
    await rejects(insertLead('+919876500000'), /leads_phone_format/);
  });

  it('keeps a conversion consistent: Converted has a time and a person, nothing else does', async () => {
    await rejects(insertLead('9000000001', { status: 'converted' }), /leads_conversion_consistent/);
    await rejects(
      insertLead('9000000002', { status: 'lost', converted_at: new Date(), converted_by: seller }),
      /leads_conversion_consistent/,
    );
    await expect(
      insertLead('9000000003', {
        status: 'converted',
        converted_at: new Date(),
        converted_by: seller,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a lead whose location belongs to another project', async () => {
    const other = randomUUID();
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Other', 'online', '2026-10-01', $2)`,
      [other, admin],
    );
    await rejects(
      db.query(
        `INSERT INTO leads (project_id, owner_id, name, phone, location_id) VALUES ($1, $2, 'C', '9111111111', $3)`,
        [other, seller, location],
      ),
      /leads_location_same_project/,
    );
  });

  describe('follow_ups', () => {
    let lead: string;
    const entry = (extra: Record<string, unknown> = {}) => {
      const row = {
        entry_type: 'follow_up',
        photo_path: null,
        latitude: null,
        longitude: null,
        gps_accuracy_m: null,
        client_request_id: randomUUID(),
        ...extra,
      };
      return db.query(
        `INSERT INTO follow_ups (lead_id, project_id, user_id, entry_type, status, note, photo_path, latitude, longitude, gps_accuracy_m, client_request_id)
         VALUES ($1, $2, $3, $4, 'contacted', 'note', $5, $6, $7, $8, $9)`,
        [
          lead,
          project,
          seller,
          row.entry_type,
          row.photo_path,
          row.latitude,
          row.longitude,
          row.gps_accuracy_m,
          row.client_request_id,
        ],
      );
    };

    beforeAll(async () => {
      lead = await insertLead('9222222222');
    });

    it('saves a double tap once', async () => {
      const id = randomUUID();
      await entry({ client_request_id: id });
      await rejects(entry({ client_request_id: id }), /follow_ups_client_request_id_key/);
    });

    it('keeps visit proof all or nothing', async () => {
      await rejects(entry({ photo_path: 'visits/a.jpg' }), /follow_ups_visit_proof_complete/);
      await expect(
        entry({ photo_path: 'visits/b.jpg', latitude: 18.5, longitude: 73.8, gps_accuracy_m: 250 }),
      ).resolves.toBeDefined();
    });

    it('never puts a photo on a manual status change', async () => {
      await rejects(
        entry({
          entry_type: 'status_change',
          photo_path: 'visits/c.jpg',
          latitude: 1,
          longitude: 1,
          gps_accuracy_m: 1,
        }),
        /follow_ups_status_change_has_no_proof/,
      );
    });

    it('refuses impossible coordinates', async () => {
      await rejects(
        entry({ photo_path: 'visits/d.jpg', latitude: 91, longitude: 0, gps_accuracy_m: 1 }),
        /follow_ups_latitude_range/,
      );
    });

    it('bumps updated_at on an edit, which is how "Edited" is shown', async () => {
      const id = randomUUID();
      await entry({ client_request_id: id });
      const { rows } = await db.query<{ edited: boolean }>(
        `UPDATE follow_ups SET note = 'changed' WHERE client_request_id = $1 RETURNING updated_at >= created_at AS edited`,
        [id],
      );
      expect(rows[0].edited).toBe(true);
    });
  });

  describe('lead_transfers', () => {
    let lead: string;
    const other = randomUUID();

    beforeAll(async () => {
      lead = await insertLead('9333333333');
      await db.query(
        `INSERT INTO users (id, name, email, role) VALUES ($1, 'Other', 'other@x.in', 'sales_person')`,
        [other],
      );
    });

    it('allows one pending transfer per lead', async () => {
      const request = () =>
        db.query(
          `INSERT INTO lead_transfers (lead_id, from_user_id, to_user_id, reason, requested_by) VALUES ($1, $2, $3, 'r', $2)`,
          [lead, seller, other],
        );
      await request();
      await rejects(request(), /lead_transfers_one_pending_per_lead/);

      await db.query(
        `UPDATE lead_transfers SET status = 'rejected', decided_by = $2, decided_at = now() WHERE lead_id = $1`,
        [lead, admin],
      );
      await expect(request()).resolves.toBeDefined();
    });

    it('requires a decider and time exactly when decided', async () => {
      await rejects(
        db.query(
          `INSERT INTO lead_transfers (lead_id, from_user_id, to_user_id, reason, requested_by, status) VALUES ($1, $2, $3, 'r', $2, 'approved')`,
          [lead, seller, other],
        ),
        /lead_transfers_decision_consistent/,
      );
    });

    it('never transfers a lead to its own owner', async () => {
      await rejects(
        db.query(
          `INSERT INTO lead_transfers (lead_id, from_user_id, to_user_id, reason, requested_by, status, decided_by, decided_at)
           VALUES ($1, $2, $2, 'r', $3, 'approved', $3, now())`,
          [lead, seller, admin],
        ),
        /lead_transfers_distinct_users/,
      );
    });
  });

  it('creates nothing in public', async () => {
    const { rows } = await db.query<{ table_schema: string }>(
      `SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
    );
    expect(rows.map((row) => row.table_schema)).toEqual(['sales']);
  });

  it('reverts cleanly', async () => {
    const fresh = new PGlite();
    await fresh.exec(readSqlFile(SQL_FILE.SALES_SCHEMA));
    await fresh.exec(readSqlFile(SQL_FILE.SALES_SCHEMA_DOWN));
    const { rows } = await fresh.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('sales', 'public')`,
    );
    expect(rows[0].count).toBe(0);
    await fresh.close();
  }, 30_000);
});

describe('05_sales_insights.sql', () => {
  let db: PGlite;
  const adder = randomUUID();
  const other = randomUUID();
  const project = randomUUID();
  const location = randomUUID();
  const worked = randomUUID();
  const imported = randomUUID();

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(readSqlFile(SQL_FILE.SALES_SCHEMA));
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Adder', 'adder@x.in', 'sales_person'), ($2, 'Other', 'other@x.in', 'sales_person')`,
      [adder, other],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'online', '2026-10-01', $2)`,
      [project, adder],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`, [
      location,
      project,
    ]);
    // An existing lead worked by two people (the last entry deleted), and an imported one.
    await db.query(
      `INSERT INTO leads (id, project_id, owner_id, name, phone, location_id, created_at)
       VALUES ($1, $3, $4, 'Worked', '9000000001', $5, '2026-10-01T10:00:00Z'),
              ($2, $3, $4, 'Imported', '9000000002', $5, '2026-10-02T10:00:00Z')`,
      [worked, imported, project, other, location],
    );
    await db.query(
      `INSERT INTO follow_ups (lead_id, project_id, user_id, entry_type, status, note, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, 'follow_up', 'contacted', 'first', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z', NULL),
              ($1, $2, $4, 'follow_up', 'interested', 'second', '2026-10-03T10:00:00Z', '2026-10-03T10:00:00Z', NULL),
              ($1, $2, $4, 'follow_up', 'lost', 'deleted', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', now())`,
      [worked, project, adder, other],
    );
    await db.exec(readSqlFile(SQL_FILE.SALES_INSIGHTS));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('credits each lead to whoever logged its first entry, and dates its last live entry', async () => {
    const { rows } = await db.query<{
      id: string;
      created_by: string | null;
      last_activity_at: Date;
    }>(`SELECT id, created_by, last_activity_at FROM leads`);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(worked)?.created_by).toBe(adder);
    expect(byId.get(worked)?.last_activity_at.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    // No entry yet: nobody to credit, and last activity is when it was added.
    expect(byId.get(imported)?.created_by).toBeNull();
    expect(byId.get(imported)?.last_activity_at.toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });

  it('can run again without changing anything', async () => {
    await db.query(`UPDATE leads SET created_by = $1 WHERE id = $2`, [other, imported]);
    await db.exec(readSqlFile(SQL_FILE.SALES_INSIGHTS));
    const { rows } = await db.query<{ created_by: string }>(
      `SELECT created_by FROM leads WHERE id = $1`,
      [imported],
    );
    expect(rows[0].created_by).toBe(other);
  });

  it('always has a last activity, defaulting to now', async () => {
    const { rows } = await db.query<{ fresh: boolean }>(
      `INSERT INTO leads (project_id, owner_id, name, phone, location_id)
       VALUES ($1, $2, 'New', '9000000003', $3) RETURNING last_activity_at > now() - interval '1 minute' AS fresh`,
      [project, adder, location],
    );
    expect(rows[0].fresh).toBe(true);
    await rejects(
      db.query(`UPDATE leads SET last_activity_at = NULL WHERE id = $1`, [worked]),
      /last_activity_at/,
    );
  });

  it('keeps deal value, plan and source within their rules', async () => {
    const set = (column: string, value: unknown) =>
      db.query(`UPDATE leads SET ${column} = $1 WHERE id = $2`, [value, worked]);
    await expect(set('deal_value', 1499)).resolves.toBeDefined();
    await rejects(set('deal_value', -1), /leads_deal_value_range/);
    await rejects(set('deal_value', 100_000_001), /leads_deal_value_range/);
    await expect(set('plan', 'Annual Gold')).resolves.toBeDefined();
    await rejects(set('plan', ' Gold'), /leads_plan_present/);
    await rejects(set('plan', ''), /leads_plan_present/);
    await rejects(set('plan', 'x'.repeat(81)), /leads_plan_present/);
    await expect(set('source', 'walk_in')).resolves.toBeDefined();
    await rejects(set('source', 'billboard'), /leads_source_valid/);
  });

  it('takes a reason only on a Not interested or Lost entry', async () => {
    const entry = (status: string, reason: string) =>
      db.query(
        `INSERT INTO follow_ups (lead_id, project_id, user_id, entry_type, status, note, reason)
         VALUES ($1, $2, $3, 'status_change', $4, 'note', $5)`,
        [worked, project, adder, status, reason],
      );
    await expect(entry('lost', 'price')).resolves.toBeDefined();
    await expect(entry('not_interested', 'competitor')).resolves.toBeDefined();
    await rejects(entry('contacted', 'price'), /follow_ups_reason_only_when_closed/);
    await rejects(entry('lost', 'weather'), /follow_ups_reason_valid/);
  });

  it('reverts cleanly', async () => {
    await db.exec(readSqlFile(SQL_FILE.SALES_INSIGHTS_DOWN));
    const { rows } = await db.query<{ column: string }>(
      `SELECT table_name || '.' || column_name AS column FROM information_schema.columns
        WHERE table_schema = 'sales'
          AND (table_name, column_name) IN (('leads', 'deal_value'), ('leads', 'plan'),
               ('leads', 'source'), ('leads', 'created_by'), ('leads', 'last_activity_at'),
               ('follow_ups', 'reason'))`,
    );
    expect(rows).toEqual([]);
  });
});

describe('06_team_collaboration.sql', () => {
  let db: PGlite;
  const owner = randomUUID();
  const backup = randomUUID();
  const project = randomUUID();
  const location = randomUUID();
  const lead = randomUUID();
  const entry = randomUUID();

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [SQL_FILE.SALES_SCHEMA, SQL_FILE.USER_DELETION, SQL_FILE.SALES_INSIGHTS]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec(readSqlFile(SQL_FILE.TEAM_COLLABORATION));
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Owner', 'owner@x.in', 'sales_person'), ($2, 'Backup', 'backup@x.in', 'sales_person')`,
      [owner, backup],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'online', '2026-10-01', $2)`,
      [project, owner],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`, [
      location,
      project,
    ]);
    await db.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1, $2), ($1, $3)`, [
      project,
      owner,
      backup,
    ]);
    await db.query(
      `INSERT INTO leads (id, project_id, owner_id, name, phone, location_id) VALUES ($1, $2, $3, 'Client', '9000000001', $4)`,
      [lead, project, owner, location],
    );
    await db.query(
      `INSERT INTO follow_ups (id, lead_id, project_id, user_id, entry_type, status, note) VALUES ($1, $2, $3, $4, 'follow_up', 'contacted', 'note')`,
      [entry, lead, project, owner],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('can run again without changing anything', async () => {
    await expect(db.exec(readSqlFile(SQL_FILE.TEAM_COLLABORATION))).resolves.toBeDefined();
  });

  it('keeps a leave in order and at most 60 days long', async () => {
    const leave = (startsOn: string, endsOn: string, note: string | null = null) =>
      db.query(
        `INSERT INTO user_leaves (user_id, starts_on, ends_on, note, created_by) VALUES ($1, $2, $3, $4, $1)`,
        [owner, startsOn, endsOn, note],
      );
    await expect(leave('2026-10-13', '2026-12-12')).resolves.toBeDefined();
    await rejects(leave('2026-10-13', '2026-12-13'), /user_leaves_span_max/);
    await rejects(leave('2026-10-13', '2026-10-12'), /user_leaves_ends_after_start/);
    await rejects(leave('2026-10-13', '2026-10-13', 'x'.repeat(201)), /user_leaves_note_length/);
  });

  it('never makes a member his own backup, nor an entry cover for its author', async () => {
    await rejects(
      db.query(`UPDATE project_members SET backup_user_id = user_id WHERE user_id = $1`, [owner]),
      /project_members_backup_not_self/,
    );
    await expect(
      db.query(`UPDATE project_members SET backup_user_id = $1 WHERE user_id = $2`, [
        backup,
        owner,
      ]),
    ).resolves.toBeDefined();
    await rejects(
      db.query(`UPDATE follow_ups SET covering_for_id = user_id WHERE id = $1`, [entry]),
      /follow_ups_covering_not_self/,
    );
  });

  describe('lead_comments', () => {
    const comment = (fields: Record<string, unknown> = {}) => {
      const row = {
        project_id: project,
        kind: 'comment',
        body: 'Called twice.',
        entry_id: null,
        resolved_at: null,
        resolved_by: null,
        ...fields,
      };
      return db.query(
        `INSERT INTO lead_comments (lead_id, project_id, user_id, kind, body, entry_id, resolved_at, resolved_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          lead,
          row.project_id,
          owner,
          row.kind,
          row.body,
          row.entry_id,
          row.resolved_at,
          row.resolved_by,
        ],
      );
    };

    it('takes the four kinds and a body of 1 to 2000 characters', async () => {
      await rejects(comment({ kind: 'praise' }), /lead_comments_kind_valid/);
      await rejects(comment({ body: '   ' }), /lead_comments_body_length/);
      await rejects(comment({ body: 'x'.repeat(2001) }), /lead_comments_body_length/);
    });

    it('keeps a comment in its lead’s project', async () => {
      const other = randomUUID();
      await db.query(
        `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Other', 'online', '2026-10-01', $2)`,
        [other, owner],
      );
      await rejects(comment({ project_id: other }), /lead_comments_lead_same_project/);
    });

    it('ties feedback to an entry and resolution to a help request', async () => {
      await rejects(comment({ kind: 'feedback' }), /lead_comments_feedback_has_entry/);
      await expect(comment({ kind: 'feedback', entry_id: entry })).resolves.toBeDefined();
      await rejects(
        comment({ resolved_at: new Date(), resolved_by: backup }),
        /lead_comments_resolve_help_only/,
      );
      await rejects(
        comment({ kind: 'help', resolved_at: new Date() }),
        /lead_comments_resolution_consistent/,
      );
    });

    it('allows one open help request per lead', async () => {
      await expect(comment({ kind: 'help' })).resolves.toBeDefined();
      await rejects(comment({ kind: 'help' }), /lead_comments_one_open_help/);
      await db.query(
        `UPDATE lead_comments SET resolved_at = now(), resolved_by = $1 WHERE kind = 'help'`,
        [backup],
      );
      await expect(comment({ kind: 'help' })).resolves.toBeDefined();
    });
  });

  it('takes only the known notification kinds', async () => {
    const notify = (kind: string) =>
      db.query(`INSERT INTO notifications (user_id, kind, title) VALUES ($1, $2, 'Hello')`, [
        owner,
        kind,
      ]);
    await expect(notify('mention')).resolves.toBeDefined();
    await rejects(notify('birthday'), /notifications_kind_valid/);
  });

  it('keeps a template’s label and body within their lengths, and dates its edits', async () => {
    const template = (label: string, body: string) =>
      db.query(
        `INSERT INTO message_templates (project_id, label, body, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
        [project, label, body, owner],
      );
    await rejects(template('x'.repeat(41), 'Hi {client}'), /message_templates_label_length/);
    await rejects(template('Intro', ' '), /message_templates_body_length/);
    const { rows } = await template('Intro', 'Hi {client}, this is {rep}.');
    const id = (rows[0] as { id: string }).id;
    await db.query(`UPDATE message_templates SET updated_at = '2026-01-01' WHERE id = $1`, [id]);
    const { rows: updated } = await db.query<{ moved: boolean }>(
      `UPDATE message_templates SET body = 'Hello {client}' WHERE id = $1
       RETURNING updated_at > '2026-01-02' AS moved`,
      [id],
    );
    expect(updated[0].moved).toBe(true);
  });

  it('reverts cleanly', async () => {
    await db.exec(readSqlFile(SQL_FILE.TEAM_COLLABORATION_DOWN));
    const { rows } = await db.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'sales'
          AND table_name IN ('user_leaves', 'lead_comments', 'notifications', 'message_templates')
       UNION ALL
       SELECT table_name || '.' || column_name FROM information_schema.columns
        WHERE table_schema = 'sales'
          AND (table_name, column_name) IN (('project_members', 'backup_user_id'),
               ('follow_ups', 'covering_for_id'))`,
    );
    expect(rows).toEqual([]);
  });
});

describe('07_visit_place.sql', () => {
  let db: PGlite;
  const seller = randomUUID();
  const project = randomUUID();
  const location = randomUUID();
  const lead = randomUUID();

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  const insertEntry = (placeName: string | null, withPhoto: boolean) =>
    db.query(
      `INSERT INTO follow_ups (id, lead_id, project_id, user_id, entry_type, status, note,
                               photo_path, latitude, longitude, gps_accuracy_m, place_name)
       VALUES ($1, $2, $3, $4, 'follow_up', 'contacted', 'Visited the shop',
               $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        lead,
        project,
        seller,
        withPhoto ? `visits/${project}/2026-10/${randomUUID()}.jpg` : null,
        withPhoto ? 18.4966 : null,
        withPhoto ? 73.8993 : null,
        withPhoto ? 12 : null,
        placeName,
      ],
    );

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Seller', 'seller@x.in', 'sales_person')`,
      [seller],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'door_to_door', '2026-10-01', $2)`,
      [project, seller],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`, [
      location,
      project,
    ]);
    await db.query(`INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)`, [
      project,
      seller,
    ]);
    await db.query(
      `INSERT INTO leads (id, project_id, owner_id, name, phone, location_id) VALUES ($1, $2, $3, 'Client', '9000000001', $4)`,
      [lead, project, seller, location],
    );
    // A visit saved before the column existed.
    await db.query(
      `INSERT INTO follow_ups (id, lead_id, project_id, user_id, entry_type, status, note,
                               photo_path, latitude, longitude, gps_accuracy_m)
       VALUES ($1, $2, $3, $4, 'follow_up', 'contacted', 'Old visit', 'visits/old.jpg', 18.5, 73.9, 20)`,
      [randomUUID(), lead, project, seller],
    );
    await db.exec(readSqlFile(SQL_FILE.VISIT_PLACE));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('leaves earlier visits without a place, and can run again', async () => {
    const { rows } = await db.query<{ place_name: string | null }>(
      `SELECT place_name FROM follow_ups WHERE note = 'Old visit'`,
    );
    expect(rows).toEqual([{ place_name: null }]);
    await expect(db.exec(readSqlFile(SQL_FILE.VISIT_PLACE))).resolves.toBeDefined();
  });

  it('stores a place next to a visit photo, and allows a visit without one', async () => {
    await expect(insertEntry('Wanowrie Road, Wanowrie, Pune 411040', true)).resolves.toBeDefined();
    await expect(insertEntry(null, true)).resolves.toBeDefined();
    await expect(insertEntry(null, false)).resolves.toBeDefined();
  });

  it('never stores a place without a photo, a blank one, or an essay', async () => {
    await rejects(insertEntry('Wanowrie', false), /follow_ups_place_needs_photo/);
    await rejects(insertEntry('   ', true), /follow_ups_place_name_length/);
    await rejects(insertEntry('x'.repeat(201), true), /follow_ups_place_name_length/);
  });

  it('reverts cleanly', async () => {
    await db.exec(readSqlFile(SQL_FILE.VISIT_PLACE_DOWN));
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sales' AND table_name = 'follow_ups' AND column_name = 'place_name'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('08_deal_terms.sql', () => {
  let db: PGlite;
  const seller = randomUUID();
  const project = randomUUID();
  const location = randomUUID();
  const oldLead = randomUUID();
  let phone = 9100000000;

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  const lead = (fields: Record<string, unknown>) => {
    const columns = Object.keys(fields);
    return db.query(
      `INSERT INTO leads (project_id, owner_id, name, phone, location_id${columns.map((c) => `, ${c}`).join('')})
       VALUES ($1, $2, 'Client', $3, $4${columns.map((_, i) => `, $${i + 5}`).join('')})`,
      [project, seller, String((phone += 1)), location, ...Object.values(fields)],
    );
  };
  const offer = (fields: Record<string, unknown> = {}) => {
    const row = {
      name: 'Diwali offer',
      coupon_code: 'DIWALI10',
      discount_type: 'percent',
      discount_value: 10,
      starts_on: null,
      ends_on: null,
      ...fields,
    };
    return db.query<{ id: string }>(
      `INSERT INTO offers (name, coupon_code, discount_type, discount_value, starts_on, ends_on, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        row.name,
        row.coupon_code,
        row.discount_type,
        row.discount_value,
        row.starts_on,
        row.ends_on,
        seller,
      ],
    );
  };

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Seller', 'seller@x.in', 'sales_person')`,
      [seller],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'online', '2026-10-01', $2)`,
      [project, seller],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`, [
      location,
      project,
    ]);
    // A deal won before plans, tenure and discounts existed.
    await db.query(
      `INSERT INTO leads (id, project_id, owner_id, name, phone, location_id, deal_value, plan)
       VALUES ($1, $2, $3, 'Old', '9000000001', $4, 1499, 'Annual Gold')`,
      [oldLead, project, seller, location],
    );
    await db.exec(readSqlFile(SQL_FILE.DEAL_TERMS));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('keeps earlier deals as they were, and can run again', async () => {
    const { rows } = await db.query(
      `SELECT deal_value, plan, plan_code, deal_tenure_months, discount_type, offer_id FROM leads WHERE id = $1`,
      [oldLead],
    );
    expect(rows).toEqual([
      {
        deal_value: 1499,
        plan: 'Annual Gold',
        plan_code: null,
        deal_tenure_months: null,
        discount_type: null,
        offer_id: null,
      },
    ]);
    await expect(db.exec(readSqlFile(SQL_FILE.DEAL_TERMS))).resolves.toBeDefined();
  });

  it('starts with the four plans, Free at ₹0 and the rest unpriced', async () => {
    const { rows } = await db.query(
      `SELECT plan, monthly_price FROM plan_prices ORDER BY monthly_price NULLS LAST, plan`,
    );
    expect(rows).toEqual([
      { plan: 'free', monthly_price: 0 },
      { plan: 'growth', monthly_price: null },
      { plan: 'growth_plus', monthly_price: null },
      { plan: 'pro', monthly_price: null },
    ]);
    await rejects(
      db.query(`UPDATE plan_prices SET monthly_price = 99 WHERE plan = 'free'`),
      /plan_prices_free_is_free/,
    );
    await rejects(
      db.query(`INSERT INTO plan_prices (plan, monthly_price) VALUES ('gold', 1)`),
      /plan_prices_plan_valid/,
    );
    await rejects(
      db.query(`UPDATE plan_prices SET monthly_price = -1 WHERE plan = 'pro'`),
      /plan_prices_price_range/,
    );
  });

  it('keeps an offer’s name, coupon, discount and dates within their rules', async () => {
    await expect(offer()).resolves.toBeDefined();
    await rejects(offer({ name: ' ' }), /offers_name_length/);
    await rejects(offer({ coupon_code: 'diwali 10' }), /offers_coupon_code_format/);
    await rejects(offer({ discount_type: 'bogo' }), /offers_discount_type_valid/);
    await rejects(offer({ discount_value: 0 }), /offers_discount_range/);
    await rejects(offer({ discount_value: 100.5 }), /offers_discount_range/);
    await rejects(
      offer({ discount_type: 'amount', discount_value: 99.5 }),
      /offers_discount_range/,
    );
    await rejects(
      offer({ starts_on: '2026-10-13', ends_on: '2026-10-12' }),
      /offers_ends_after_start/,
    );
  });

  it('takes a plan, tenure and discount within their rules', async () => {
    await expect(
      lead({
        plan_code: 'growth',
        deal_value: 2499,
        deal_tenure_months: 6,
        discount_type: 'percent',
        discount_value: 10,
        coupon_code: 'DIWALI10',
      }),
    ).resolves.toBeDefined();
    await rejects(lead({ plan_code: 'gold' }), /leads_plan_code_valid/);
    await rejects(lead({ plan_code: 'pro', plan: 'Pro' }), /leads_plan_one_kind/);
    await rejects(lead({ deal_value: 100, deal_tenure_months: 2 }), /leads_deal_tenure_valid/);
    await rejects(
      lead({ deal_value: 100, discount_type: 'bogo', discount_value: 1 }),
      /leads_discount_type_valid/,
    );
    await rejects(lead({ deal_value: 100, discount_type: 'percent' }), /leads_discount_pair/);
    await rejects(lead({ discount_type: 'percent', discount_value: 10 }), /leads_discount_range/);
    await rejects(
      lead({ deal_value: 100, discount_type: 'percent', discount_value: 101 }),
      /leads_discount_range/,
    );
    await rejects(
      lead({
        deal_value: 1000,
        deal_tenure_months: 3,
        discount_type: 'amount',
        discount_value: 3001,
      }),
      /leads_discount_range/,
    );
    await expect(
      lead({
        deal_value: 1000,
        deal_tenure_months: 3,
        discount_type: 'amount',
        discount_value: 3000,
      }),
    ).resolves.toBeDefined();
    await rejects(lead({ deal_value: 100, coupon_code: 'SAVE' }), /leads_coupon_code_format/);
    await rejects(
      lead({ deal_value: 100, discount_type: 'amount', discount_value: 5, coupon_code: 'a b' }),
      /leads_coupon_code_format/,
    );
  });

  it('makes Free cost nothing, and ties an offer to the discount copied from it', async () => {
    await expect(lead({ plan_code: 'free', deal_value: 0 })).resolves.toBeDefined();
    await rejects(lead({ plan_code: 'free', deal_value: 499 }), /leads_free_plan_is_free/);
    await rejects(
      lead({ plan_code: 'free', deal_value: 0, deal_tenure_months: 3 }),
      /leads_free_plan_is_free/,
    );
    const { rows } = await offer({ name: 'Monsoon' });
    await rejects(lead({ deal_value: 100, offer_id: rows[0].id }), /leads_offer_has_discount/);
    await expect(
      lead({
        deal_value: 100,
        offer_id: rows[0].id,
        discount_type: 'percent',
        discount_value: 10,
        coupon_code: 'DIWALI10',
      }),
    ).resolves.toBeDefined();
  });

  it('reverts cleanly', async () => {
    await db.exec(readSqlFile(SQL_FILE.DEAL_TERMS_DOWN));
    const { rows } = await db.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = 'sales' AND table_name IN ('plan_prices', 'offers')
       UNION ALL
       SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'sales' AND table_name = 'leads'
          AND column_name IN ('plan_code', 'deal_tenure_months', 'discount_type',
                              'discount_value', 'coupon_code', 'offer_id')`,
    );
    expect(rows).toEqual([]);
    const { rows: kept } = await db.query(`SELECT deal_value, plan FROM leads WHERE id = $1`, [
      oldLead,
    ]);
    expect(kept).toEqual([{ deal_value: 1499, plan: 'Annual Gold' }]);
  });
});

describe('09_training.sql', () => {
  let db: PGlite;
  const admin = randomUUID();
  const project = randomUUID();
  const course = randomUUID();

  const rejects = (promise: Promise<unknown>, pattern: RegExp) =>
    expect(promise).rejects.toThrow(pattern);

  const insertLesson = (fields: Record<string, unknown>) => {
    const row = {
      course_id: course,
      project_id: null,
      step: 'watch',
      kind: 'video',
      title: 'The 25-minute visit',
      file_path: null,
      minutes: null,
      ...fields,
    };
    return db.query(
      `INSERT INTO training_items (id, course_id, project_id, step, kind, title, file_path, minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        randomUUID(),
        row.course_id,
        row.project_id,
        row.step,
        row.kind,
        row.title,
        row.file_path,
        row.minutes,
        admin,
      ],
    );
  };

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
      SQL_FILE.DEAL_TERMS,
      SQL_FILE.TRAINING,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Head', 'head@x.in', 'super_admin')`,
      [admin],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'online', '2026-10-01', $2)`,
      [project, admin],
    );
    await db.query(
      `INSERT INTO training_courses (id, title, created_by) VALUES ($1, 'Frostique core', $2)`,
      [course, admin],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('can run again', async () => {
    await expect(db.exec(readSqlFile(SQL_FILE.TRAINING))).resolves.toBeDefined();
  });

  it('a lesson belongs to a course or to one campaign, never both or neither', async () => {
    await expect(insertLesson({})).resolves.toBeDefined();
    await expect(insertLesson({ course_id: null, project_id: project })).resolves.toBeDefined();
    await rejects(insertLesson({ project_id: project }), /training_items_one_owner/);
    await rejects(insertLesson({ course_id: null }), /training_items_one_owner/);
  });

  it('checks kind, step, title, minutes and that only documents carry a file', async () => {
    await rejects(insertLesson({ kind: 'podcast' }), /training_items_kind_valid/);
    await rejects(insertLesson({ step: 'homework' }), /training_items_step_valid/);
    await rejects(insertLesson({ title: '  ' }), /training_items_title_length/);
    await rejects(insertLesson({ minutes: 0 }), /training_items_minutes_range/);
    await rejects(
      insertLesson({ file_path: 'training/x.pdf' }),
      /training_items_file_only_documents/,
    );
    await expect(
      insertLesson({ kind: 'document', step: 'library', file_path: 'training/x.pdf' }),
    ).resolves.toBeDefined();
  });

  it('keeps scores and progress in range, and a score only on a finished pitch', async () => {
    const { rows } = await insertLesson({ kind: 'roleplay', step: 'practise' });
    const lesson = (rows[0] as { id: string }).id;
    await rejects(
      db.query(`INSERT INTO training_progress (user_id, item_id, percent) VALUES ($1, $2, 101)`, [
        admin,
        lesson,
      ]),
      /training_progress_percent_range/,
    );
    await rejects(
      db.query(
        `INSERT INTO roleplay_sessions (user_id, item_id, project_id, score) VALUES ($1, $2, $3, 80)`,
        [admin, lesson, project],
      ),
      /roleplay_sessions_scored_when_finished/,
    );
    await expect(
      db.query(
        `INSERT INTO roleplay_sessions (user_id, item_id, project_id, score, finished_at) VALUES ($1, $2, $3, 80, now())`,
        [admin, lesson, project],
      ),
    ).resolves.toBeDefined();
  });

  it('allows training notifications', async () => {
    await expect(
      db.query(
        `INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'training', 'Ravi finished training')`,
        [admin],
      ),
    ).resolves.toBeDefined();
  });

  it('reverts cleanly', async () => {
    await db.exec(readSqlFile(SQL_FILE.TRAINING_DOWN));
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sales' AND table_name LIKE 'training%'`,
    );
    expect(rows).toEqual([]);
    await rejects(
      db.query(`INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'training', 'x')`, [
        admin,
      ]),
      /notifications_kind_valid/,
    );
  });
});

describe('10_training_playlists.sql', () => {
  let db: PGlite;
  const admin = randomUUID();
  const course = randomUUID();

  const insertLesson = (kind: string, step: string) =>
    db.query(
      `INSERT INTO training_items (id, course_id, step, kind, title, created_by)
       VALUES ($1, $2, $3, $4, 'Frostique app tutorial', $5) RETURNING id`,
      [randomUUID(), course, step, kind, admin],
    );

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
      SQL_FILE.DEAL_TERMS,
      SQL_FILE.TRAINING,
      SQL_FILE.TRAINING_PLAYLISTS,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Head', 'head@x.in', 'super_admin')`,
      [admin],
    );
    await db.query(
      `INSERT INTO training_courses (id, title, created_by) VALUES ($1, 'Frostique core', $2)`,
      [course, admin],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('can run again', async () => {
    await expect(db.exec(readSqlFile(SQL_FILE.TRAINING_PLAYLISTS))).resolves.toBeDefined();
  });

  it('allows playlist lessons and the app tutorial step', async () => {
    await expect(insertLesson('playlist', 'tutorial')).resolves.toBeDefined();
    await expect(insertLesson('podcast', 'tutorial')).rejects.toThrow(/training_items_kind_valid/);
    await expect(insertLesson('video', 'homework')).rejects.toThrow(/training_items_step_valid/);
  });

  it('keeps per-module progress, empty by default', async () => {
    const { rows } = await insertLesson('playlist', 'tutorial');
    const lesson = (rows[0] as { id: string }).id;
    const saved = await db.query<{ details: unknown }>(
      `INSERT INTO training_progress (user_id, item_id, percent) VALUES ($1, $2, 0) RETURNING details`,
      [admin, lesson],
    );
    expect(saved.rows[0].details).toEqual({});
  });

  it('reverts cleanly, moving tutorial lessons back to watch', async () => {
    await insertLesson('video', 'tutorial');
    await db.exec(readSqlFile(SQL_FILE.TRAINING_PLAYLISTS_DOWN));
    const { rows } = await db.query<{ kind: string; step: string }>(
      `SELECT kind, step FROM training_items`,
    );
    expect(rows).toEqual([{ kind: 'video', step: 'watch' }]);
    await expect(insertLesson('playlist', 'watch')).rejects.toThrow(/training_items_kind_valid/);
    const cols = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'sales' AND table_name = 'training_progress' AND column_name = 'details'`,
    );
    expect(cols.rows).toEqual([]);
  });
});

describe('11_lead_business_name.sql', () => {
  let db: PGlite;
  const admin = randomUUID();
  const project = randomUUID();
  const location = randomUUID();

  const insertLead = (name: string | null, businessName: string | null, phone: string) =>
    db.query(
      `INSERT INTO leads (id, project_id, owner_id, name, business_name, phone, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [randomUUID(), project, admin, name, businessName, phone, location],
    );

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
      SQL_FILE.DEAL_TERMS,
      SQL_FILE.TRAINING,
      SQL_FILE.TRAINING_PLAYLISTS,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Head', 'head@x.in', 'super_admin')`,
      [admin],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'door_to_door', '2026-10-01', $2)`,
      [project, admin],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Camp')`, [
      location,
      project,
    ]);
    // A lead from before: a person's name, no business name.
    await insertLead('Anil Sharma', null, '9876543210');
    await db.exec(readSqlFile(SQL_FILE.LEAD_BUSINESS_NAME));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('can run again, and leaves older leads as they were', async () => {
    await expect(db.exec(readSqlFile(SQL_FILE.LEAD_BUSINESS_NAME))).resolves.toBeDefined();
    const { rows } = await db.query(`SELECT name, business_name FROM leads`);
    expect(rows).toEqual([{ name: 'Anil Sharma', business_name: null }]);
  });

  it('takes a lead with only a business name', async () => {
    await expect(insertLead(null, 'Sharma Sweets', '9876543211')).resolves.toBeDefined();
  });

  it('refuses a lead with neither name, and a blank person’s name', async () => {
    await expect(insertLead(null, null, '9876543212')).rejects.toThrow(/leads_named/);
    await expect(insertLead(null, '  ', '9876543213')).rejects.toThrow(/leads_named/);
    await expect(insertLead('  ', 'Sharma Sweets', '9876543214')).rejects.toThrow(
      /leads_name_present/,
    );
  });

  it('reverts cleanly, naming each lead after its business', async () => {
    await db.exec(readSqlFile(SQL_FILE.LEAD_BUSINESS_NAME_DOWN));
    const { rows } = await db.query(`SELECT name FROM leads ORDER BY phone`);
    expect(rows).toEqual([{ name: 'Anil Sharma' }, { name: 'Sharma Sweets' }]);
    await expect(insertLead(null, 'Kapoor Cakes', '9876543215')).rejects.toThrow(/null value/);
  });
});

describe('12_unassigned_leads.sql', () => {
  let db: PGlite;
  const admin = randomUUID();
  const rep = randomUUID();
  const project = randomUUID();
  const location = randomUUID();

  const insertLead = (ownerId: string | null, status: string, phone: string) =>
    db.query(
      `INSERT INTO leads (id, project_id, owner_id, business_name, phone, location_id, status, created_by)
       VALUES ($1, $2, $3, 'Kapoor Cakes', $4, $5, $6, $7) RETURNING id`,
      [randomUUID(), project, ownerId, phone, location, status, admin],
    );
  const insertTransfer = (leadId: string, from: string | null, status: string) =>
    db.query(
      `INSERT INTO lead_transfers (lead_id, from_user_id, to_user_id, reason, status, requested_by, decided_by, decided_at)
       VALUES ($1, $2, $3, 'From the upload.', $4, $5, $6, $7)`,
      [
        leadId,
        from,
        rep,
        status,
        admin,
        status === 'pending' ? null : admin,
        status === 'pending' ? null : new Date(),
      ],
    );

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
      SQL_FILE.DEAL_TERMS,
      SQL_FILE.TRAINING,
      SQL_FILE.TRAINING_PLAYLISTS,
      SQL_FILE.LEAD_BUSINESS_NAME,
      SQL_FILE.UNASSIGNED_LEADS,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.exec('SET search_path TO sales');
    await db.query(
      `INSERT INTO users (id, name, email, role) VALUES ($1, 'Head', 'head@x.in', 'super_admin'),
              ($2, 'Ravi', 'ravi@x.in', 'sales_person')`,
      [admin, rep],
    );
    await db.query(
      `INSERT INTO projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'door_to_door', '2026-10-01', $2)`,
      [project, admin],
    );
    await db.query(`INSERT INTO locations (id, project_id, name) VALUES ($1, $2, 'Camp')`, [
      location,
      project,
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it('can run again', async () => {
    await expect(db.exec(readSqlFile(SQL_FILE.UNASSIGNED_LEADS))).resolves.toBeDefined();
  });

  it('takes an unassigned lead only while it is New', async () => {
    await expect(insertLead(null, 'new', '9876543220')).resolves.toBeDefined();
    await expect(insertLead(null, 'contacted', '9876543221')).rejects.toThrow(
      /leads_unassigned_new/,
    );
  });

  it('records assigning it, approved and from no one; a request always has an owner', async () => {
    const { rows } = await insertLead(null, 'new', '9876543222');
    const leadId = (rows[0] as { id: string }).id;
    await expect(insertTransfer(leadId, null, 'approved')).resolves.toBeDefined();
    await expect(insertTransfer(leadId, null, 'pending')).rejects.toThrow(
      /lead_transfers_from_present/,
    );
  });

  it('reverts cleanly, giving waiting leads to whoever added them', async () => {
    await db.exec(readSqlFile(SQL_FILE.UNASSIGNED_LEADS_DOWN));
    const { rows } = await db.query(`SELECT DISTINCT owner_id FROM leads`);
    expect(rows).toEqual([{ owner_id: admin }]);
    const transfers = await db.query(`SELECT 1 FROM lead_transfers`);
    expect(transfers.rows).toEqual([]);
    await expect(insertLead(null, 'new', '9876543223')).rejects.toThrow(/null value/);
  });
});
