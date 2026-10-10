import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Release notes: the super admin writes them, everyone signed in reads them once. */
describe('Versions (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let ravi: ApiClient;
  let meera: ApiClient;
  let raviId: string;

  const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
    const res = await admin.post('/users', { name, email, role });
    expect(res.status).toBe(201);
    const id = res.body.data.id as string;
    return { id, client: admin.as(await harness.supabase.accessToken(id)) };
  };

  beforeAll(async () => {
    harness = await startHarness();
    admin = new ApiClient(harness.baseUrl).as(
      await harness.supabase.accessToken(harness.superAdminId),
    );
    const r = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
    const m = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    ravi = r.client;
    raviId = r.id;
    meera = m.client;
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('starts on a quiet 1.0.0 that nobody is interrupted by', async () => {
    const res = await ravi.get('/versions/latest');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ version: '1.0.0', notify: false, seen: false });
  });

  it('keeps writing to the Super Admin', async () => {
    for (const client of [ravi, meera]) {
      expect((await client.get('/versions/admin')).status).toBe(403);
      expect((await client.post('/versions', { version: '1.1.0', notes: 'x' })).status).toBe(403);
    }
  });

  it('adds a draft that no one else can see, then publishes it', async () => {
    const created = await admin.post('/versions', {
      version: '1.1.0',
      title: 'Faster lead import',
      tags: ['Leads', 'Leads', ' Transfers '],
      notes: '## Added\n- Import a CSV of leads',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      version: '1.1.0',
      tags: ['Leads', 'Transfers'],
      isPublished: false,
      notify: true,
      seenCount: 0,
    });
    const id = created.body.data.id as string;

    // A draft is not "latest", is not in the history, and cannot be marked read.
    expect((await ravi.get('/versions/latest')).body.data.version).toBe('1.0.0');
    const history = await ravi.get('/versions');
    expect(history.body.data.map((v: { version: string }) => v.version)).toEqual(['1.0.0']);
    expect((await ravi.post(`/versions/${id}/seen`)).status).toBe(404);

    const published = await admin.patch(`/versions/${id}`, { isPublished: true });
    expect(published.status).toBe(200);
    const latest = await ravi.get('/versions/latest');
    expect(latest.body.data).toMatchObject({ version: '1.1.0', notify: true, seen: false });
  });

  it('records a read once per person, and reports readers and who is still pending', async () => {
    const latest = (await ravi.get('/versions/latest')).body.data;
    expect((await ravi.post(`/versions/${latest.id}/seen`)).status).toBe(204);
    expect((await ravi.post(`/versions/${latest.id}/seen`)).status).toBe(204);

    expect((await ravi.get('/versions/latest')).body.data.seen).toBe(true);
    expect((await meera.get('/versions/latest')).body.data.seen).toBe(false);

    const views = await admin.get(`/versions/${latest.id}/views`);
    expect(views.status).toBe(200);
    expect(views.body.data.seen).toHaveLength(1);
    expect(views.body.data.seen[0]).toMatchObject({ userId: raviId, name: 'Ravi Kumar' });
    // Meera and the Super Admin have not read it.
    expect(views.body.data.pending).toBe(2);

    const list = await admin.get('/versions/admin');
    const row = list.body.data.find((v: { id: string }) => v.id === latest.id);
    expect(row.seenCount).toBe(1);
  });

  it('orders by release number, not text or date', async () => {
    expect(
      (await admin.post('/versions', { version: '1.10.0', notes: 'ten', isPublished: true }))
        .status,
    ).toBe(201);
    expect(
      (await admin.post('/versions', { version: '1.9.0', notes: 'nine', isPublished: true }))
        .status,
    ).toBe(201);
    const latest = await ravi.get('/versions/latest');
    expect(latest.body.data.version).toBe('1.10.0');
    const history = (await ravi.get('/versions')).body.data.map(
      (v: { version: string }) => v.version,
    );
    expect(history).toEqual(['1.10.0', '1.9.0', '1.1.0', '1.0.0']);
  });

  it('accepts the note as a .md upload, and refuses other files', async () => {
    const ok = await admin.postForm(
      '/versions',
      { version: '2.0.0', title: 'Big one', tags: 'Leads,Reports', notify: 'false' },
      Buffer.from('# 2.0.0\n\nEverything new.', 'utf8'),
      'file',
      'changelog-2.0.0.md',
      'text/markdown',
    );
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      version: '2.0.0',
      notify: false,
      tags: ['Leads', 'Reports'],
      notes: '# 2.0.0\n\nEverything new.',
    });

    const wrongType = await admin.postForm(
      '/versions',
      { version: '2.1.0' },
      Buffer.from('MZ', 'utf8'),
      'file',
      'tool.exe',
      'application/octet-stream',
    );
    expect(wrongType.status).toBe(400);
  });

  it('refuses bad numbers, duplicates and missing notes', async () => {
    const bad = await admin.post('/versions', { version: '1.2', notes: 'x' });
    expect(bad.status).toBe(400);
    const dup = await admin.post('/versions', { version: '1.1.0', notes: 'again' });
    expect(dup.status).toBe(409);
    const noNote = await admin.post('/versions', { version: '3.0.0' });
    expect(noNote.status).toBe(400);
    const huge = await admin.post('/versions', { version: '1.1000.0', notes: 'x' });
    expect(huge.status).toBe(400);
  });

  it('edits a release, and deleting the live one promotes the previous', async () => {
    const list = (await admin.get('/versions/admin')).body.data as Array<{
      id: string;
      version: string;
    }>;
    const v110 = list.find((v) => v.version === '1.10.0')!;

    const edited = await admin.patch(`/versions/${v110.id}`, {
      title: 'Ten',
      tags: [],
      notify: false,
    });
    expect(edited.body.data).toMatchObject({ title: 'Ten', tags: [], notify: false });
    const cleared = await admin.patch(`/versions/${v110.id}`, { title: '' });
    expect(cleared.body.data.title).toBeNull();

    // 2.0.0 was uploaded as a draft, so 1.10.0 is the live one.
    expect((await ravi.get('/versions/latest')).body.data.version).toBe('1.10.0');
    expect((await admin.delete(`/versions/${v110.id}`)).status).toBe(204);
    expect((await ravi.get('/versions/latest')).body.data.version).toBe('1.9.0');
    expect((await admin.delete(`/versions/${v110.id}`)).status).toBe(404);
  });
});
