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
