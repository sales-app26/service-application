import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/**
 * Role boundaries a moderator must not cross: account-wide actions on people who work in
 * other projects, deleted users, people outside his projects, and edits after removal.
 */
describe('Access control (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  const ids: Record<string, string> = {};
  const as: Record<string, ApiClient> = {};
  const projects: Record<string, string> = {};

  const person = async (key: string, role: 'moderator' | 'sales_person', by: ApiClient = admin) => {
    const res = await by.post('/users', {
      name: key,
      email: `${key.toLowerCase()}@pronttera.in`,
      role,
    });
    expect(res.status).toBe(201);
    ids[key] = res.body.data.id;
    as[key] = api.as(await harness.supabase.accessToken(ids[key]));
  };
  const project = async (key: string, members: string[]) => {
    const res = await admin.post('/projects', {
      name: key,
      type: 'online',
      startDate: '2026-09-01',
    });
    projects[key] = res.body.data.id;
    for (const m of members)
      await admin.post(`/projects/${projects[key]}/members`, { userId: ids[m] });
  };

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    await person('Meera', 'moderator');
    await person('Farah', 'moderator');
    await person('Sana', 'sales_person');
    await person('Ravi', 'sales_person');
    await person('Gone', 'sales_person');
    // Sana works in Farah's project; Ravi only in Meera's.
    await project('North', ['Meera', 'Ravi']);
    await project('South', ['Farah', 'Sana']);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('a moderator cannot take over a sales person who also works in another project', async () => {
    // Meera may add Sana to her project, which makes Sana "hers" to edit…
    expect(
      (await as.Meera.post(`/projects/${projects.North}/members`, { userId: ids.Sana })).status,
    ).toBe(201);

    // …but not to get a sign-in link for her, or switch her off everywhere.
    const link = await as.Meera.post(`/users/${ids.Sana}/reset-link`);
    expect(link.status).toBe(403);
    expect(link.body.message).toContain('only the sales head');
    expect((await as.Meera.post(`/users/${ids.Sana}/deactivate`)).status).toBe(403);

    const listed = (await as.Meera.get('/users?limit=100')).body.data.items as Array<any>;
    const sana = listed.find((u) => u.id === ids.Sana);
    expect(sana).toMatchObject({ canManage: true, canManageAccount: false });
    expect(listed.find((u) => u.id === ids.Ravi)).toMatchObject({ canManageAccount: true });

    // Someone who works only in her projects is still fully hers; the Super Admin can do it all.
    expect((await as.Meera.post(`/users/${ids.Ravi}/reset-link`)).body.success).toBe(true);
    expect((await admin.post(`/users/${ids.Sana}/reset-link`)).body.success).toBe(true);
  });

  it('a deleted user cannot be reactivated, re-roled or re-emailed', async () => {
    expect((await admin.post(`/users/${ids.Gone}/delete`, { transferToId: ids.Ravi })).status).toBe(
      200,
    );
    expect((await admin.post(`/users/${ids.Gone}/reactivate`)).status).toBe(404);
    expect((await admin.patch(`/users/${ids.Gone}/role`, { role: 'moderator' })).status).toBe(404);
    expect(
      (await admin.patch(`/users/${ids.Gone}/email`, { email: 'back@pronttera.in' })).status,
    ).toBe(404);
  });

  it('a moderator cannot look up a summary or timeline of someone outside his projects', async () => {
    expect(
      (await as.Meera.get(`/timeline/summary?userId=${ids.Farah}&from=2026-10-01&to=2026-10-07`))
        .status,
    ).toBe(404);
    expect((await as.Meera.get(`/timeline?userId=${harness.superAdminId}`)).status).toBe(404);
    // His own people, past or present, are fine.
    expect((await as.Meera.get(`/timeline?userId=${ids.Ravi}`)).status).toBe(200);
  });

  it('an author removed from the project can no longer edit what he logged there today', async () => {
    const lead = await as.Ravi.post(`/projects/${projects.North}/leads`, {
      name: 'Asha Patil',
      businessName: 'Patil Sweets',
      phone: '9876500111',
      location: 'Baner',
      status: 'contacted',
      note: 'Met the owner today.',
      clientRequestId: requestId(),
    });
    expect(lead.status).toBe(201);
    const entryId = lead.body.data.recentEntries[0].id as string;
    expect(
      (await as.Ravi.patch(`/entries/${entryId}`, { note: 'Met the owner, wants a demo.' })).status,
    ).toBe(200);

    expect((await admin.delete(`/projects/${projects.North}/members/${ids.Ravi}`)).status).toBe(
      200,
    );
    expect(
      (await as.Ravi.patch(`/entries/${entryId}`, { note: 'Rewritten after leaving.' })).status,
    ).toBe(404);
  });
});
