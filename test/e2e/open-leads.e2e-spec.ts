import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Open leads: reps see a campaign's unassigned leads and take them for themselves. */
describe('Open leads (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let meera: ApiClient;
  let ravi: ApiClient;
  let priya: ApiClient;
  let karan: ApiClient;
  const ids: Record<string, string> = {};
  let projectId: string;
  const lead: Record<string, string> = {};

  const open = async (client: ApiClient, search = '') =>
    client.get(`/projects/${projectId}/leads/open?limit=100${search ? `&search=${search}` : ''}`);

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));

    for (const [name, role] of [
      ['Meera Nair', 'moderator'],
      ['Ravi Kumar', 'sales_person'],
      ['Priya Desai', 'sales_person'],
      ['Karan Mehta', 'sales_person'],
    ] as const) {
      const res = await admin.post('/users', {
        name,
        email: `${name.split(' ')[0].toLowerCase()}@pronttera.in`,
        role,
      });
      ids[name.split(' ')[0]] = res.body.data.id;
    }
    meera = api.as(await harness.supabase.accessToken(ids.Meera));
    ravi = api.as(await harness.supabase.accessToken(ids.Ravi));
    priya = api.as(await harness.supabase.accessToken(ids.Priya));
    karan = api.as(await harness.supabase.accessToken(ids.Karan)); // not on the campaign

    projectId = (
      await admin.post('/projects', {
        name: 'Pune Retail',
        type: 'online',
        startDate: '2026-09-01',
      })
    ).body.data.id;
    for (const who of [ids.Meera, ids.Ravi, ids.Priya]) {
      await admin.post(`/projects/${projectId}/members`, { userId: who });
    }

    // No one picked: every row goes in unassigned.
    const csv =
      'business_name,phone,name,location,notes\n' +
      'Patil Store,9876500001,Asha Patil,Wanowrie,Wants a demo on Saturday\n' +
      'Joshi Medicals,,,Kondhwa,\n' +
      'Sweet Spot,9876500003,,Kondhwa,\n';
    const upload = await admin.postForm(
      `/projects/${projectId}/leads/import`,
      {},
      Buffer.from(csv, 'utf8'),
      'file',
    );
    expect(upload.body.data).toMatchObject({ imported: 3, unassigned: 3 });
    const first = await open(admin);
    for (const item of first.body.data.items) lead[item.businessName] = item.id;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('a rep sees what they need to decide, but not the phone', async () => {
    const res = await open(ravi);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(3);
    const patil = res.body.data.items.find((i: any) => i.businessName === 'Patil Store');
    expect(patil).toEqual({
      id: lead['Patil Store'],
      businessName: 'Patil Store',
      name: 'Asha Patil',
      location: { id: expect.any(String), name: 'Wanowrie' },
      notes: 'Wants a demo on Saturday',
      hasPhone: true,
      source: 'import',
      addedBy: { id: harness.superAdminId, name: expect.any(String) },
      createdAt: expect.any(String),
    });
    const joshi = res.body.data.items.find((i: any) => i.businessName === 'Joshi Medicals');
    expect(joshi).toMatchObject({ name: null, hasPhone: false });
    expect(JSON.stringify(res.body.data.items)).not.toContain('98765');

    // Search covers the location too.
    const kondhwa = await open(ravi, 'kondhwa');
    expect(kondhwa.body.data.items.map((i: any) => i.businessName).sort()).toEqual([
      'Joshi Medicals',
      'Sweet Spot',
    ]);

    // Not on the campaign: nothing to see. The lead itself stays hidden from reps.
    expect((await open(karan)).status).toBe(404);
    expect((await ravi.get(`/leads/${lead['Patil Store']}`)).status).toBe(404);
  });

  it('only a rep on the campaign can take one', async () => {
    expect((await meera.post(`/leads/${lead['Patil Store']}/claim`)).status).toBe(403);
    expect((await admin.post(`/leads/${lead['Patil Store']}/claim`)).status).toBe(403);
    expect((await karan.post(`/leads/${lead['Patil Store']}/claim`)).status).toBe(404);
  });

  it('taking a lead makes it yours, with its phone; it leaves the open list', async () => {
    const res = await ravi.post(`/leads/${lead['Patil Store']}/claim`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('The lead is yours now. It’s in My leads.');
    expect(res.body.data).toEqual({ leadId: lead['Patil Store'] });

    const detail = await ravi.get(`/leads/${lead['Patil Store']}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ phone: '9876500001', owner: { id: ids.Ravi } });
    const mine = (await ravi.get(`/projects/${projectId}/leads?limit=100`)).body.data.items;
    expect(mine.map((l: any) => l.id)).toEqual([lead['Patil Store']]);
    expect((await open(priya)).body.data.meta.total).toBe(2);

    // Recorded like an assignment: an approved handover from no one.
    const { rows } = await harness.db.query<any>(
      `SELECT from_user_id, to_user_id, status, reason FROM sales.lead_transfers WHERE lead_id = $1`,
      [lead['Patil Store']],
    );
    expect(rows).toEqual([
      {
        from_user_id: null,
        to_user_id: ids.Ravi,
        status: 'approved',
        reason: 'Taken from Open leads',
      },
    ]);

    // Again by the same rep: the same answer. By someone else: who has it.
    expect((await ravi.post(`/leads/${lead['Patil Store']}/claim`)).status).toBe(200);
    const late = await priya.post(`/leads/${lead['Patil Store']}/claim`);
    expect(late.status).toBe(409);
    expect(late.body.message).toBe('Ravi Kumar has just taken this lead.');
  });

  it('two reps tapping at once: one gets it', async () => {
    const results = await Promise.all([
      ravi.post(`/leads/${lead['Sweet Spot']}/claim`),
      priya.post(`/leads/${lead['Sweet Spot']}/claim`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sales.lead_transfers WHERE lead_id = $1`,
      [lead['Sweet Spot']],
    );
    expect(rows[0].n).toBe(1);
  });

  it('once taken, it moves only by handover, never back to the open list', async () => {
    const handover = await ravi.post(`/leads/${lead['Patil Store']}/transfers`, {
      toUserId: ids.Priya,
      reason: 'She covers Wanowrie.',
    });
    expect(handover.status).toBe(201);
    // No route takes a lead back to no one: reassign needs someone to give it to.
    expect(
      (await meera.post(`/leads/${lead['Patil Store']}/reassign`, { reason: 'Back' })).status,
    ).toBe(400);
    expect((await open(ravi)).body.data.items.some((i: any) => i.id === lead['Patil Store'])).toBe(
      false,
    );
  });

  it('a closed campaign can still be browsed, but nothing can be taken', async () => {
    expect((await admin.post(`/projects/${projectId}/close`)).status).toBe(200);
    expect((await open(ravi)).body.data.meta.total).toBe(1);
    const res = await ravi.post(`/leads/${lead['Joshi Medicals']}/claim`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.message).toBe('This campaign is closed.');
  });
});
