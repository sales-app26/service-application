import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Deleting leads, one or a selection: Super Admin only, soft, all or nothing. */
describe('Delete leads (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  let moderator: ApiClient;
  let rep: ApiClient;
  let repId: string;
  let north: string;
  let south: string;
  let phone = 9876530000;

  const addLead = async (projectId: string, number = String((phone += 1))) => {
    const res = await rep.post(`/projects/${projectId}/leads`, {
      name: 'Asha Patil',
      businessName: 'Patil Sweets',
      phone: number,
      location: 'Baner',
      status: 'contacted',
      note: 'Met the owner at the shop.',
      clientRequestId: requestId(),
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; phone: string };
  };

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));

    const person = async (name: string, role: 'moderator' | 'sales_person') => {
      const res = await admin.post('/users', {
        name,
        email: `${name.split(' ')[0].toLowerCase()}@pronttera.in`,
        role,
      });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    const moderatorId = await person('Meera Nair', 'moderator');
    repId = await person('Ravi Kumar', 'sales_person');
    moderator = api.as(await harness.supabase.accessToken(moderatorId));
    rep = api.as(await harness.supabase.accessToken(repId));

    for (const key of ['North', 'South']) {
      const res = await admin.post('/projects', {
        name: key,
        type: 'online',
        startDate: '2026-01-01',
      });
      const id = res.body.data.id as string;
      if (key === 'North') north = id;
      else south = id;
      await admin.post(`/projects/${id}/members`, { userId: moderatorId });
      await admin.post(`/projects/${id}/members`, { userId: repId });
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('deletes a selection: gone from lists and detail, numbers free to add again', async () => {
    const a = await addLead(north);
    const b = await addLead(north);
    const keep = await addLead(north);

    const res = await admin.post(`/projects/${north}/leads/delete`, { leadIds: [a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: 2 });
    expect(res.body.message).toBe('Leads deleted.');

    const list = await admin.get(`/projects/${north}/leads?limit=100`);
    const listed = (list.body.data.items as Array<{ id: string }>).map((l) => l.id);
    expect(listed).toContain(keep.id);
    expect(listed).not.toContain(a.id);
    expect(listed).not.toContain(b.id);
    expect((await admin.get(`/leads/${a.id}`)).status).toBe(404);

    // The number can be added as a new lead again.
    await addLead(north, a.phone);
  });

  it('is all or nothing: one lead from another campaign stops the lot', async () => {
    const here = await addLead(north);
    const elsewhere = await addLead(south);
    const res = await admin.post(`/projects/${north}/leads/delete`, {
      leadIds: [here.id, elsewhere.id],
    });
    expect(res.status).toBe(404);
    expect((await admin.get(`/leads/${here.id}`)).status).toBe(200);
    expect((await admin.get(`/leads/${elsewhere.id}`)).status).toBe(200);
  });

  it('refuses a lead that is already deleted', async () => {
    const lead = await addLead(north);
    expect((await admin.delete(`/leads/${lead.id}`)).status).toBe(200);
    const again = await admin.post(`/projects/${north}/leads/delete`, { leadIds: [lead.id] });
    expect(again.status).toBe(404);
  });

  it('is for the Super Admin only', async () => {
    const lead = await addLead(north);
    for (const client of [moderator, rep]) {
      expect(
        (await client.post(`/projects/${north}/leads/delete`, { leadIds: [lead.id] })).status,
      ).toBe(403);
      expect((await client.delete(`/leads/${lead.id}`)).status).toBe(403);
    }
    expect((await admin.get(`/leads/${lead.id}`)).status).toBe(200);
  });

  it('validates the selection', async () => {
    expect((await admin.post(`/projects/${north}/leads/delete`, { leadIds: [] })).status).toBe(400);
    expect(
      (await admin.post(`/projects/${north}/leads/delete`, { leadIds: ['nope'] })).status,
    ).toBe(400);
  });

  it('rejects a pending handover of a deleted lead', async () => {
    const lead = await addLead(north);
    const other = await admin.post('/users', {
      name: 'Karan Mehta',
      email: 'karan@pronttera.in',
      role: 'sales_person',
    });
    await admin.post(`/projects/${north}/members`, { userId: other.body.data.id });
    const asked = await rep.post(`/leads/${lead.id}/transfers`, {
      toUserId: other.body.data.id,
      reason: 'Karan covers Baner.',
    });
    expect(asked.status).toBe(201);

    expect(
      (await admin.post(`/projects/${north}/leads/delete`, { leadIds: [lead.id] })).status,
    ).toBe(200);
    const transfers = await admin.get('/transfers?status=pending&limit=100');
    const pending = (transfers.body.data.items as Array<{ lead: { id: string } }>).filter(
      (t) => t.lead.id === lead.id,
    );
    expect(pending).toHaveLength(0);
  });
});
