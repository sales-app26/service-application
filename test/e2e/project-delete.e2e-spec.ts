import { ApiClient, cameraJpeg, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Deleting a campaign for good: Super Admin only, after typing its name. */
describe('Delete a campaign (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let meera: ApiClient;
  let ravi: ApiClient;
  const ids: Record<string, string> = {};
  let photo: Buffer;
  let doomed: string;
  let kept: string;
  let doomedLead: string;
  let keptLead: string;
  let courseId: string;

  const gps = { latitude: 18.4966, longitude: 73.8993, gpsAccuracyM: 12 };

  /** Rows anywhere in the schema that still point at a project. */
  const leftovers = async (projectId: string) => {
    const { rows } = await harness.db.query<{ table: string; n: number }>(
      `SELECT 'projects' AS table, count(*)::int AS n FROM sales.projects WHERE id = $1
       UNION ALL SELECT 'leads', count(*)::int FROM sales.leads WHERE project_id = $1
       UNION ALL SELECT 'follow_ups', count(*)::int FROM sales.follow_ups WHERE project_id = $1
       UNION ALL SELECT 'lead_comments', count(*)::int FROM sales.lead_comments WHERE project_id = $1
       UNION ALL SELECT 'locations', count(*)::int FROM sales.locations WHERE project_id = $1
       UNION ALL SELECT 'project_members', count(*)::int FROM sales.project_members WHERE project_id = $1
       UNION ALL SELECT 'message_templates', count(*)::int FROM sales.message_templates WHERE project_id = $1
       UNION ALL SELECT 'training_items', count(*)::int FROM sales.training_items WHERE project_id = $1
       UNION ALL SELECT 'project_courses', count(*)::int FROM sales.project_courses WHERE project_id = $1`,
      [projectId],
    );
    return Object.fromEntries(rows.map((r) => [r.table, r.n]));
  };

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    photo = await cameraJpeg();

    for (const [name, role] of [
      ['Meera Nair', 'moderator'],
      ['Ravi Kumar', 'sales_person'],
      ['Priya Desai', 'sales_person'],
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

    const course = await admin.post('/training/courses', { title: 'Core sales training' });
    courseId = course.body.data.id;
    await admin.patch(`/training/courses/${courseId}`, { published: true });

    for (const [key, name] of [
      ['doomed', 'Kondhwa Door-to-door'],
      ['kept', 'Baner Door-to-door'],
    ] as const) {
      const res = await admin.post('/projects', {
        name,
        type: 'door_to_door',
        startDate: '2026-09-01',
      });
      const id = res.body.data.id as string;
      if (key === 'doomed') doomed = id;
      else kept = id;
      for (const who of [ids.Meera, ids.Ravi, ids.Priya]) {
        await admin.post(`/projects/${id}/members`, { userId: who });
      }
      await admin.put(`/projects/${id}/training/courses`, { courseIds: [courseId] });
    }

    // The doomed campaign gets one of everything; the kept one a lead of its own.
    const addVisit = async (projectId: string, phone: string) => {
      const token = (await ravi.post('/visits/capture-token')).body.data.captureToken;
      const res = await ravi.postForm(
        `/projects/${projectId}/leads`,
        {
          businessName: 'Patil Sweets',
          phone,
          location: 'Kondhwa',
          status: 'contacted',
          note: 'Met the owner at the shop.',
          clientRequestId: requestId(),
          captureToken: token,
          ...gps,
        },
        photo,
      );
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    doomedLead = await addVisit(doomed, '9876500001');
    keptLead = await addVisit(kept, '9876500002');

    expect((await admin.postForm(`/projects/${doomed}/image`, {}, photo, 'image')).status).toBe(
      200,
    );
    expect(
      (await ravi.post(`/leads/${doomedLead}/comments`, { body: 'Owner back on Monday.' })).status,
    ).toBe(201);
    expect(
      (
        await ravi.post(`/leads/${doomedLead}/transfers`, {
          toUserId: ids.Priya,
          reason: 'She covers Kondhwa now.',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await meera.post(`/projects/${doomed}/templates`, {
          label: 'Hello',
          body: 'Hi {name}, this is Meera.',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await meera.post(`/projects/${doomed}/training/items`, {
          kind: 'card',
          title: 'Kondhwa briefing',
          payload: { markdown: 'Shops open at 10.' },
        })
      ).status,
    ).toBe(201);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('is for the Sales head only', async () => {
    const body = { confirmName: 'Kondhwa Door-to-door' };
    expect((await meera.post(`/projects/${doomed}/delete`, body)).status).toBe(403);
    expect((await ravi.post(`/projects/${doomed}/delete`, body)).status).toBe(403);
  });

  it('refuses a name that does not match, and changes nothing', async () => {
    const res = await admin.post(`/projects/${doomed}/delete`, { confirmName: 'Kondhwa' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Type the campaign’s name exactly as it is to delete it.');
    expect((await admin.post(`/projects/${doomed}/delete`, {})).status).toBe(400);
    expect((await admin.get(`/projects/${doomed}`)).status).toBe(200);
    expect((await leftovers(doomed)).leads).toBe(1);
  });

  it('erases the campaign, everything in it and its files; the other campaign is untouched', async () => {
    const files = [...harness.supabase.objects.keys()];
    const meerasInbox = async () =>
      (await meera.get('/notifications?limit=100')).body.data.items as Array<{ kind: string }>;
    expect((await meerasInbox()).some((n) => n.kind === 'transfer_requested')).toBe(true);

    // Case and extra spaces don't matter.
    const res = await admin.post(`/projects/${doomed}/delete`, {
      confirmName: '  kondhwa   door-to-door ',
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Campaign deleted, with all its leads, visits and photos.');
    expect(res.body.data).toEqual({ leads: 1, followUps: 1, files: 2 });

    expect(Object.values(await leftovers(doomed)).every((n) => n === 0)).toBe(true);
    expect((await admin.get(`/projects/${doomed}`)).status).toBe(404);
    expect((await admin.get(`/leads/${doomedLead}`)).status).toBe(404);
    expect((await meerasInbox()).some((n) => n.kind === 'transfer_requested')).toBe(false);
    // The picture and the visit photo are gone from storage; the other campaign's photo stays.
    const after = [...harness.supabase.objects.keys()];
    expect(files.length - after.length).toBe(2);
    expect(after).toHaveLength(1);

    // The other campaign, the people and the library course are all still there.
    expect(await leftovers(kept)).toMatchObject({ projects: 1, leads: 1, follow_ups: 1 });
    expect((await ravi.get(`/leads/${keptLead}`)).status).toBe(200);
    expect((await admin.get(`/users/${ids.Ravi}`)).status).toBe(200);
    expect((await admin.get(`/training/courses/${courseId}`)).status).toBe(200);

    expect((await admin.post(`/projects/${doomed}/delete`, { confirmName: 'x' })).status).toBe(404);
  });
});
