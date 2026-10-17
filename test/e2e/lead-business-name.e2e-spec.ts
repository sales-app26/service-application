import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/**
 * A lead is a business first (`11_lead_business_name.sql`): the business name is required,
 * the owner's or manager's name is not. Older leads saved with only a person's name keep it.
 */
describe('Lead business name (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let rep: ApiClient;
  let projectId: string;
  let phone = 9876540000;

  const addLead = (fields: Record<string, unknown>) =>
    rep.post(`/projects/${projectId}/leads`, {
      phone: String((phone += 1)),
      location: 'Baner',
      status: 'contacted',
      note: 'Met someone at the shop.',
      clientRequestId: requestId(),
      ...fields,
    });
  const sql = (text: string, params: unknown[] = []) => harness.db.query(text, params);

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const user = await admin.post('/users', {
      name: 'Ravi Kumar',
      email: 'ravi@pronttera.in',
      role: 'sales_person',
    });
    rep = api.as(await harness.supabase.accessToken(user.body.data.id));
    const project = await admin.post('/projects', {
      name: 'North',
      type: 'online',
      startDate: '2026-01-01',
    });
    projectId = project.body.data.id;
    await admin.post(`/projects/${projectId}/members`, { userId: user.body.data.id });
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('adds a lead with only a business name', async () => {
    const res = await addLead({ businessName: '  Kapoor Cakes ', name: '' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ businessName: 'Kapoor Cakes', name: null });
  });

  it('refuses a lead without a business name, even with a person’s name', async () => {
    for (const businessName of [undefined, '', '   ', null]) {
      const res = await addLead({ name: 'Anil Sharma', businessName });
      expect(res.status).toBe(400);
      expect(res.body.errors?.map((e: any) => e.field)).toContain('businessName');
    }
  });

  it('edits: the person’s name can be added or cleared, the business name never cleared', async () => {
    const lead = (await addLead({ businessName: 'Sharma Stores' })).body.data;

    const named = await rep.patch(`/leads/${lead.id}`, { name: 'Anil Sharma' });
    expect(named.body.data).toMatchObject({ name: 'Anil Sharma', businessName: 'Sharma Stores' });
    const cleared = await rep.patch(`/leads/${lead.id}`, { name: '' });
    expect(cleared.body.data).toMatchObject({ name: null, businessName: 'Sharma Stores' });

    for (const businessName of ['', null]) {
      expect((await rep.patch(`/leads/${lead.id}`, { businessName })).status).toBe(400);
    }
    const renamed = await rep.patch(`/leads/${lead.id}`, { businessName: 'Sharma Sweets' });
    expect(renamed.body.data.businessName).toBe('Sharma Sweets');
  });

  it('an older lead with only a person’s name keeps it until it has a business name', async () => {
    const lead = (await addLead({ businessName: 'Placeholder' })).body.data;
    // As saved before business names were required.
    await sql(`UPDATE sales.leads SET name = 'Old Client', business_name = NULL WHERE id = $1`, [
      lead.id,
    ]);

    // It still opens and still takes other edits.
    const notes = await rep.patch(`/leads/${lead.id}`, { notes: 'Called back.' });
    expect(notes.status).toBe(200);
    expect(notes.body.data).toMatchObject({ name: 'Old Client', businessName: null });

    const refused = await rep.patch(`/leads/${lead.id}`, { name: null });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Add the business name before removing the person’s name.');

    const both = await rep.patch(`/leads/${lead.id}`, { name: null, businessName: 'Old Bakery' });
    expect(both.body.data).toMatchObject({ name: null, businessName: 'Old Bakery' });
  });

  it('sorts and searches by business name, older leads by the person’s name', async () => {
    const old = (await addLead({ businessName: 'Placeholder' })).body.data;
    await sql(`UPDATE sales.leads SET name = 'Aarav Old', business_name = NULL WHERE id = $1`, [
      old.id,
    ]);

    const res = await rep.get(`/projects/${projectId}/leads?limit=100&sort=name`);
    expect(res.body.data.items.map((l: any) => l.businessName ?? l.name)).toEqual([
      'Kapoor Cakes',
      'Old Bakery',
      'Sharma Sweets',
      'Aarav Old',
    ]);

    const found = await rep.get(`/projects/${projectId}/leads?search=kapoor`);
    expect(found.body.data.items.map((l: any) => l.businessName)).toEqual(['Kapoor Cakes']);
  });
});
