import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Admin requests after the v1 PRD: bulk CSV import with assignment, and a person's week/month. */
describe('Bulk import and person summary (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  let moderator: ApiClient;
  let outsideModerator: ApiClient;
  let ravi: ApiClient;
  let projectId: string;
  const ids: Record<string, string> = {};

  const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
    const res = await admin.post('/users', { name, email, role });
    expect(res.status).toBe(201);
    return {
      id: res.body.data.id as string,
      client: api.as(await harness.supabase.accessToken(res.body.data.id)),
    };
  };
  const upload = (
    client: ApiClient,
    project: string,
    csv: string | Buffer,
    fields: Record<string, string | undefined> = {},
  ) =>
    client.postForm(
      `/projects/${project}/leads/import`,
      fields,
      Buffer.isBuffer(csv) ? csv : Buffer.from(csv, 'utf8'),
      'file',
    );
  const leadsOf = async (client: ApiClient, project = projectId) =>
    (await client.get(`/projects/${project}/leads?limit=100`)).body.data.items as Array<any>;

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));

    const meera = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    const outside = await person('Outside Mod', 'outside@pronttera.in', 'moderator');
    const r = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
    const p = await person('Priya Desai', 'priya@pronttera.in', 'sales_person');
    const k = await person('Karan Mehta', 'karan@pronttera.in', 'sales_person');
    Object.assign(ids, { meera: meera.id, ravi: r.id, priya: p.id, karan: k.id });
    moderator = meera.client;
    outsideModerator = outside.client;
    ravi = r.client;

    const project = await admin.post('/projects', {
      name: 'Pune Retail Drive',
      type: 'door_to_door',
      startDate: '2026-09-01',
    });
    projectId = project.body.data.id;
    for (const id of [meera.id, r.id, p.id, k.id]) {
      expect((await admin.post(`/projects/${projectId}/members`, { userId: id })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ------------------------------------------------------------------ import

  describe('import', () => {
    const header = 'name,phone,business_name,location,notes,owner_email\n';

    it('is for admins of the project only', async () => {
      expect(
        (
          await upload(ravi, projectId, header + 'A,9876543210,,Kondhwa,,\n', {
            ownerIds: ids.ravi,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await upload(outsideModerator, projectId, header + 'A,9876543210,,Kondhwa,,\n', {
            ownerIds: ids.ravi,
          })
        ).status,
      ).toBe(404);
    });

    it('refuses a missing file, a file with no name/phone columns, and an empty one', async () => {
      const none = await moderator.postForm(`/projects/${projectId}/leads/import`, {
        ownerIds: ids.ravi,
      });
      expect(none.status).toBe(400);
      expect(none.body.message).toBe('Choose a CSV file.');

      const noColumns = await upload(moderator, projectId, 'client,town\nA,Pune\n', {
        ownerIds: ids.ravi,
      });
      expect(noColumns.status).toBe(400);
      expect(noColumns.body.message).toMatch(/name and phone/);

      const empty = await upload(moderator, projectId, header, { ownerIds: ids.ravi });
      expect(empty.status).toBe(400);
      expect(empty.body.message).toBe('The file has no leads in it.');

      const xlsx = await upload(moderator, projectId, Buffer.from([0x50, 0x4b, 3, 4, 0]), {
        ownerIds: ids.ravi,
      });
      expect(xlsx.body.message).toMatch(/could not be read as a CSV/);
    });

    it('refuses owners who are not active members', async () => {
      const res = await upload(moderator, projectId, header + 'A,9876543210,,Kondhwa,,\n', {
        ownerIds: requestId(),
      });
      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/active members/);
    });

    it('a dry run reports exactly what would happen and changes nothing', async () => {
      const csv =
        header +
        'Asha Patil,+91 98765 43210,Patil Store,Wanowrie,Likes calls after 4,\n' +
        'Imran Shaikh,098765 43211,,,,\n' +
        '"Neha, Joshi",9876543212,Joshi Medicals,Kondhwa,"two\nlines",\n' +
        'Bad Phone,12345,,Kondhwa,,\n' +
        ',9876543213,,Kondhwa,,\n' +
        'Repeat,9876543210,,Kondhwa,,\n' +
        'Suresh Rao,9876543214,,,,\n';
      const res = await upload(moderator, projectId, csv, {
        ownerIds: `${ids.ravi},${ids.priya}`,
        defaultLocation: 'Pune',
        dryRun: 'true',
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        dryRun: true,
        total: 7,
        importable: 4,
        imported: 0,
        duplicates: 1,
        invalid: 2,
      });
      // Four importable rows share two people evenly, in file order, starting with the first person picked.
      expect(res.body.data.byOwner.map((o: any) => o.count)).toEqual([2, 2]);
      expect(
        res.body.data.sample.map((s: any) => [s.name, s.phone, s.location, s.owner.name]),
      ).toEqual([
        ['Asha Patil', '9876543210', 'Wanowrie', 'Ravi Kumar'],
        ['Imran Shaikh', '9876543211', 'Pune', 'Priya Desai'],
        ['Neha, Joshi', '9876543212', 'Kondhwa', 'Ravi Kumar'],
        ['Suresh Rao', '9876543214', 'Pune', 'Priya Desai'],
      ]);
      expect(res.body.data.problems.map((p: any) => [p.row, p.kind])).toEqual([
        [5, 'invalid'],
        [6, 'invalid'],
        [7, 'duplicate'],
      ]);
      expect(res.body.data.problems[0].reason).toMatch(/10-digit/);
      expect(res.body.data.problems[2].reason).toBe('Same number as row 2 in this file.');
      expect(await leadsOf(admin)).toHaveLength(0);
    });

    it('imports for real: leads are New, unassigned to no one, owned as reported, with their locations', async () => {
      const csv =
        header +
        'Asha Patil,9876543210,Patil Store,Wanowrie,Likes calls after 4,\n' +
        'Imran Shaikh,9876543211,,Kondhwa,,\n' +
        'Neha Joshi,9876543212,Joshi Medicals,Kondhwa,,karan@pronttera.in\n' +
        'Suresh Rao,9876543214,,Wanowrie,,\n';
      const res = await upload(moderator, projectId, csv, { ownerIds: `${ids.ravi},${ids.priya}` });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Leads imported.');
      expect(res.body.data).toMatchObject({
        dryRun: false,
        importable: 4,
        imported: 4,
        duplicates: 0,
        invalid: 0,
      });

      const all = await leadsOf(admin);
      expect(all).toHaveLength(4);
      const owners = Object.fromEntries(all.map((l) => [l.name, l.owner.name]));
      // owner_email wins; the other three are shared by file order: Ravi, Priya, Ravi.
      expect(owners).toEqual({
        'Asha Patil': 'Ravi Kumar',
        'Imran Shaikh': 'Priya Desai',
        'Neha Joshi': 'Karan Mehta',
        'Suresh Rao': 'Ravi Kumar',
      });
      expect(all.every((l) => l.status === 'new' && l.nextFollowUpDate === null)).toBe(true);

      // A sales person sees only his own, and can open one; there is no first entry, no photo needed.
      const mine = await leadsOf(ravi);
      expect(mine.map((l) => l.name).sort()).toEqual(['Asha Patil', 'Suresh Rao']);
      const detail = await ravi.get(`/leads/${mine[0].id}`);
      expect(detail.body.data).toMatchObject({
        entryCount: 0,
        recentEntries: [],
        permissions: { canLogFollowUp: true },
      });

      const places = await moderator.get(`/projects/${projectId}/locations`);
      expect(places.body.data.map((p: any) => p.name).sort()).toEqual(['Kondhwa', 'Wanowrie']);
    });

    it('running the same file again imports nothing and says why', async () => {
      const csv = header + 'Asha Patil,9876543210,,Wanowrie,,\nNew Person,9000000001,,Wanowrie,,\n';
      const res = await upload(moderator, projectId, csv, { ownerIds: ids.ravi });
      expect(res.body.data).toMatchObject({ total: 2, imported: 1, duplicates: 1, invalid: 0 });
      expect(res.body.data.problems[0].reason).toBe(
        'Already a lead in this project, owned by Ravi Kumar.',
      );
      expect(await leadsOf(admin)).toHaveLength(5);
    });

    it('rejects rows with an unknown owner, no owner, or no location, and still imports the good ones', async () => {
      const csv =
        header +
        'A One,9000000010,,Kondhwa,,ghost@pronttera.in\n' +
        'B Two,9000000011,,,,\n' +
        'C Three,9000000012,,Kondhwa,,priya@pronttera.in\n';
      // No ownerIds and no default location.
      const res = await upload(moderator, projectId, csv);
      expect(res.body.data).toMatchObject({ imported: 1, invalid: 2 });
      expect(res.body.data.problems.map((p: any) => p.reason)).toEqual([
        'No active member of this project has this owner_email.',
        'No location: add a location column, or a default location.',
      ]);
    });

    it('reads what Excel writes: a byte-order mark and Windows-1252 accents', async () => {
      const text = header + 'José Álvarez,9000000020,,Kondhwa,,priya@pronttera.in\r\n';
      const win1252 = Buffer.from(text, 'latin1'); // é and Á as single bytes, not valid UTF-8
      const res = await upload(moderator, projectId, win1252);
      expect(res.body.data.imported).toBe(1);
      const created = (await leadsOf(admin)).find((l) => l.phone === '9000000020');
      expect(created.name).toBe('José Álvarez');

      const bom = await upload(
        moderator,
        projectId,
        Buffer.from('﻿name,phone\nWith Bom,9000000021\n', 'utf8'),
        { ownerIds: ids.ravi, defaultLocation: 'Pune' },
      );
      expect(bom.body.data.imported).toBe(1);
    });

    it('caps a file at 1,000 rows', async () => {
      const rows = Array.from(
        { length: 1001 },
        (_, i) => `P${i},${String(9100000000 + i)},,Pune,,`,
      ).join('\n');
      const res = await upload(moderator, projectId, header + rows + '\n', { ownerIds: ids.ravi });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at most 1,000/);
    });

    it('refuses a closed project: it is read-only', async () => {
      const closed = await admin.post('/projects', {
        name: 'Old Drive',
        type: 'online',
        startDate: '2026-01-01',
      });
      await admin.post(`/projects/${closed.body.data.id}/members`, { userId: ids.ravi });
      await admin.post(`/projects/${closed.body.data.id}/close`);
      const res = await upload(admin, closed.body.data.id, header + 'A,9876543299,,Pune,,\n', {
        ownerIds: ids.ravi,
      });
      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('PROJECT_CLOSED');
    });

    it('works for the Super Admin and for an online project too', async () => {
      const online = await admin.post('/projects', {
        name: 'Online Drive',
        type: 'online',
        startDate: '2026-09-01',
      });
      await admin.post(`/projects/${online.body.data.id}/members`, { userId: ids.priya });
      const res = await upload(admin, online.body.data.id, header + 'Solo,9876500001,,Pune,,\n', {
        ownerIds: ids.priya,
      });
      expect(res.body.data).toMatchObject({
        imported: 1,
        byOwner: [{ user: { name: 'Priya Desai' }, count: 1 }],
      });
    });
  });

  // ----------------------------------------------------------------- summary

  describe('summary', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const photo = async () => (await import('../support/api-client')).cameraJpeg();
    let leadId: string;

    beforeAll(async () => {
      // Ravi works an imported lead: one visit with a photo, then marks it converted.
      const mine = await leadsOf(ravi);
      leadId = mine[0].id;
      const token = (await ravi.post('/visits/capture-token')).body.data.captureToken;
      const visit = await ravi.postForm(
        `/leads/${leadId}/follow-ups`,
        {
          clientRequestId: requestId(),
          status: 'interested',
          note: 'Visited the shop.',
          location: 'Kondhwa',
          latitude: 18.49,
          longitude: 73.89,
          gpsAccuracyM: 12,
          captureToken: token,
        },
        await photo(),
      );
      expect(visit.status).toBe(201);
      // A manual status change needs no photo, even in a door-to-door project.
      const converted = await ravi.post(`/leads/${leadId}/status`, {
        clientRequestId: requestId(),
        status: 'converted',
        note: 'Signed up, paperwork done.',
      });
      expect(converted.status).toBe(200);
    });

    it('counts a week day by day, with quiet days as zeros, matching the dashboard', async () => {
      const res = await admin.get(`/timeline/summary?userId=${ids.ravi}&from=${today}&to=${today}`);
      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe('Ravi Kumar');
      expect(res.body.data.totals).toMatchObject({
        followUps: 1,
        visits: 1,
        statusChanges: 1,
        conversions: 1,
        activeDays: 1,
      });
      expect(res.body.data.days).toHaveLength(1);

      const week = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000)
        .toISOString()
        .slice(0, 10);
      const range = await admin.get(
        `/timeline/summary?userId=${ids.ravi}&from=${week}&to=${today}`,
      );
      expect(range.body.data.days).toHaveLength(7);
      expect(
        range.body.data.days.filter((d: any) => d.followUps > 0).map((d: any) => d.date),
      ).toEqual([today]);
      expect(range.body.data.totals.activeDays).toBe(1);

      // The dashboard says the same about him for the same dates.
      const dash = await admin.get(`/dashboard?userId=${ids.ravi}&from=${week}&to=${today}`);
      const row = dash.body.data.people.find((p: any) => p.user.id === ids.ravi);
      expect(row).toMatchObject({ followUps: 1, conversions: 1 });
    });

    it('a person sees their own; not someone else’s', async () => {
      expect(
        (await ravi.get(`/timeline/summary?from=${today}&to=${today}`)).body.data.totals.followUps,
      ).toBe(1);
      const other = await ravi.get(
        `/timeline/summary?userId=${ids.priya}&from=${today}&to=${today}`,
      );
      expect(other.status).toBe(403);
    });

    it('a moderator sees only entries in his projects; an unrelated one sees zeros', async () => {
      expect(
        (await moderator.get(`/timeline/summary?userId=${ids.ravi}&from=${today}&to=${today}`)).body
          .data.totals.followUps,
      ).toBe(1);
      const outside = await outsideModerator.get(
        `/timeline/summary?userId=${ids.ravi}&from=${today}&to=${today}`,
      );
      expect(outside.status).toBe(200);
      expect(outside.body.data.totals).toMatchObject({
        followUps: 0,
        visits: 0,
        conversions: 0,
        activeDays: 0,
      });
    });

    it('checks the range', async () => {
      expect((await admin.get(`/timeline/summary?userId=${ids.ravi}&from=${today}`)).status).toBe(
        400,
      );
      expect(
        (await admin.get(`/timeline/summary?userId=${ids.ravi}&from=2026-10-09&to=2026-10-01`))
          .status,
      ).toBe(400);
      const long = await admin.get(
        `/timeline/summary?userId=${ids.ravi}&from=2026-01-01&to=2026-06-01`,
      );
      expect(long.status).toBe(400);
      expect(long.body.message).toMatch(/at most 92 days/);
    });
  });
});
