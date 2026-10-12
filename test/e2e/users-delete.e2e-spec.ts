import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Super Admin deletes a user: leads move on, history stays, login and details go. */
describe('Delete a user (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  const ids: Record<string, string> = {};
  let moderator: ApiClient;
  let projectId: string;

  const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
    const res = await admin.post('/users', { name, email, role });
    expect(res.status).toBe(201);
    return {
      id: res.body.data.id as string,
      client: api.as(await harness.supabase.accessToken(res.body.data.id)),
    };
  };

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const mod = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    const ravi = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
    const priya = await person('Priya Desai', 'priya@pronttera.in', 'sales_person');
    Object.assign(ids, { meera: mod.id, ravi: ravi.id, priya: priya.id });
    moderator = mod.client;

    const project = await admin.post('/projects', {
      name: 'Online Drive',
      type: 'online',
      startDate: '2026-09-01',
    });
    projectId = project.body.data.id;
    for (const id of [ids.meera, ids.ravi])
      await admin.post(`/projects/${projectId}/members`, { userId: id });
    const csv = 'name,phone,location\nA,9876500001,Pune\nB,9876500002,Pune\n';
    const res = await admin.postForm(
      `/projects/${projectId}/leads/import`,
      { ownerId: ids.ravi },
      Buffer.from(csv),
      'file',
    );
    expect(res.body.data.imported).toBe(2);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('is for the Super Admin only', async () => {
    expect(
      (await moderator.post(`/users/${ids.ravi}/delete`, { transferToId: ids.meera })).status,
    ).toBe(403);
  });

  it('refuses without someone to take the leads, and refuses an invalid recipient', async () => {
    expect((await admin.post(`/users/${ids.ravi}/delete`, {})).status).toBe(422);
    expect(
      (await admin.post(`/users/${ids.ravi}/delete`, { transferToId: harness.superAdminId }))
        .status,
    ).toBe(422);
    expect((await admin.post(`/users/${harness.superAdminId}/delete`, {})).status).toBe(403);
  });

  it('moves the leads, joins the recipient to the project, erases the person and their login', async () => {
    const res = await admin.post(`/users/${ids.ravi}/delete`, { transferToId: ids.priya });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ leadsMoved: 2 });

    const leads = (await admin.get(`/projects/${projectId}/leads?limit=100`)).body.data
      .items as Array<any>;
    expect(leads.map((l) => l.owner.id)).toEqual([ids.priya, ids.priya]);

    const members = (await admin.get(`/projects/${projectId}/members`)).body.data as Array<any>;
    expect(members.find((m) => m.userId === ids.priya)?.isActive).toBe(true);

    const people = (await admin.get('/users?limit=100')).body.data.items as Array<any>;
    expect(people.some((u) => u.id === ids.ravi)).toBe(false);

    // The email is free again for a new account.
    expect(
      (
        await admin.post('/users', {
          name: 'Ravi Again',
          email: 'ravi@pronttera.in',
          role: 'sales_person',
        })
      ).status,
    ).toBe(201);

    // Deleting twice: not found.
    expect(
      (await admin.post(`/users/${ids.ravi}/delete`, { transferToId: ids.priya })).status,
    ).toBe(404);
  });

  it('needs no recipient for someone with no leads', async () => {
    const res = await admin.post(`/users/${ids.meera}/delete`, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ leadsMoved: 0 });
  });
});
