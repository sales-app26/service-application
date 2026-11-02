import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** The Super Admin adds one lead by hand: no visit proof, to a team member or unassigned. */
describe('Super Admin adds a lead (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let meera: ApiClient;
  let ravi: ApiClient;
  const ids: Record<string, string> = {};
  let doorToDoor: string;

  const add = (body: Record<string, unknown>, client = admin) =>
    client.post(`/projects/${doorToDoor}/leads/add`, { location: 'Kothrud', ...body });

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));

    for (const [name, role] of [
      ['Meera Nair', 'moderator'],
      ['Ravi Kumar', 'sales_person'],
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

    doorToDoor = (
      await admin.post('/projects', {
        name: 'Pune Bakeries',
        type: 'door_to_door',
        startDate: '2026-09-01',
      })
    ).body.data.id;
    for (const who of [ids.Meera, ids.Ravi]) {
      await admin.post(`/projects/${doorToDoor}/members`, { userId: who });
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('adds a lead to a door-to-door campaign with no photo, and tells the rep', async () => {
    const res = await add({
      businessName: '  Sweet   Crumbs ',
      name: 'Anil Sharma',
      phone: '+91 98765-43210',
      notes: 'Met at the expo',
      source: 'event',
      ownerId: ids.Ravi,
    });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Lead saved.');
    expect(res.body.data).toMatchObject({
      businessName: 'Sweet Crumbs',
      phone: '9876543210',
      status: 'new',
      source: 'event',
    });

    const mine = await ravi.get(`/projects/${doorToDoor}/leads?mine=true`);
    expect(mine.body.data.items.map((l: { id: string }) => l.id)).toContain(res.body.data.id);

    const entries = await ravi.get(`/leads/${res.body.data.id}/entries`);
    expect(entries.body.data.items).toHaveLength(0);

    const inbox = await ravi.get('/notifications');
    expect(JSON.stringify(inbox.body)).toContain('assigned Sweet Crumbs to you');
  });

  it('with no one picked, the lead waits unassigned and a rep can take it', async () => {
    const res = await add({ businessName: 'Cake Hub', phone: '9876500001' });
    expect(res.status).toBe(201);

    const waiting = await admin.get(`/projects/${doorToDoor}/leads?unassigned=true`);
    expect(waiting.body.data.items.map((l: { id: string }) => l.id)).toContain(res.body.data.id);

    const open = await ravi.get(`/projects/${doorToDoor}/leads/open?limit=100`);
    expect(open.body.data.items.map((l: { id: string }) => l.id)).toContain(res.body.data.id);
    expect((await ravi.post(`/leads/${res.body.data.id}/claim`)).status).toBeLessThan(300);
  });

  it('a number already in the campaign is refused, pointing at the lead', async () => {
    const first = await add({ businessName: 'First Bakes', phone: '9876500002' });
    const again = await add({ businessName: 'Other Name', phone: '98765 00002' });
    expect(again.status).toBe(409);
    expect(again.body.errorCode).toBe('DUPLICATE_LEAD_OTHER');
    expect(again.body.message).toMatch(/not assigned to anyone/u);
    expect(again.body.details?.leadId).toBe(first.body.data.id);

    await add({ businessName: 'Owned Bakes', phone: '9876500003', ownerId: ids.Ravi });
    const taken = await add({ businessName: 'Another', phone: '9876500003' });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toContain('Ravi Kumar');
  });

  it('with no number, the same business at the same place is refused', async () => {
    const first = await add({ businessName: 'Roadside  Bakers' });
    expect(first.status).toBe(201);
    expect(first.body.data.phone).toBeNull();

    const same = await add({ businessName: 'roadside bakers', location: 'kothrud' });
    expect(same.status).toBe(409);
    expect(same.body.message).toMatch(/already a lead at this location/u);

    expect((await add({ businessName: 'Roadside Bakers', location: 'Baner' })).status).toBe(201);
  });

  it('refuses a bad number, a missing business, and an owner not on the team', async () => {
    expect((await add({ businessName: 'Bad Number', phone: '12345' })).status).toBe(400);
    expect((await add({ phone: '9876500004' })).status).toBe(400);
    expect((await add({ businessName: 'No Place', location: '' })).status).toBe(400);
    expect((await add({ businessName: 'Import', source: 'import' })).status).toBe(400);

    const outsider = await add({ businessName: 'Outsider', ownerId: ids.Karan });
    expect(outsider.status).toBe(400);
    expect(outsider.body.message).toMatch(/on this campaign’s team/u);
    const boss = await add({ businessName: 'Boss', ownerId: harness.superAdminId });
    expect(boss.status).toBe(400);
  });

  it('is for the Super Admin only, and never in a closed campaign', async () => {
    expect((await add({ businessName: 'By Manager' }, meera)).status).toBe(403);
    expect((await add({ businessName: 'By Rep' }, ravi)).status).toBe(403);

    const closed = (
      await admin.post('/projects', { name: 'Old Drive', type: 'online', startDate: '2026-01-01' })
    ).body.data.id;
    expect((await admin.post(`/projects/${closed}/close`)).status).toBeLessThan(300);
    const res = await admin.post(`/projects/${closed}/leads/add`, {
      businessName: 'Too Late',
      location: 'Kothrud',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await add({ businessName: 'Still open' })).status).toBe(201);
  });
});
