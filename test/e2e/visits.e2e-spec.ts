import { ApiClient, cameraJpeg, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** Door-to-door visit proof: one capture token proves one visit (B-01). */
describe('Visit proof capture tokens (e2e)', () => {
  let harness: Harness;
  let ravi: ApiClient;
  let projectId: string;
  let photo: Buffer;

  const token = async (): Promise<string> => {
    const res = await ravi.post('/visits/capture-token');
    expect(res.status).toBe(200);
    return res.body.data.captureToken as string;
  };

  const gps = { latitude: 18.4966, longitude: 73.8993, gpsAccuracyM: 12 };

  const addLead = (captureToken: string, phone: string, clientRequestId = requestId()) =>
    ravi.postForm(
      `/projects/${projectId}/leads`,
      {
        name: 'Asha Patil',
        phone,
        location: 'Kondhwa',
        status: 'contacted',
        note: 'Met the owner at the shop.',
        clientRequestId,
        captureToken,
        ...gps,
      },
      photo,
    );

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    const admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const user = await admin.post('/users', {
      name: 'Ravi Kumar',
      email: 'ravi@pronttera.in',
      role: 'sales_person',
    });
    ravi = api.as(await harness.supabase.accessToken(user.body.data.id));
    const project = await admin.post('/projects', {
      name: 'Kondhwa Door-to-door',
      type: 'door_to_door',
      startDate: '2026-09-01',
    });
    projectId = project.body.data.id;
    await admin.post(`/projects/${projectId}/members`, { userId: user.body.data.id });
    photo = await cameraJpeg();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('accepts a visit, and a retry of the same save returns the same lead', async () => {
    const captureToken = await token();
    const id = requestId();
    const first = await addLead(captureToken, '9876500001', id);
    expect(first.status).toBe(201);
    const retry = await addLead(captureToken, '9876500001', id);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it('refuses a second visit proved with the same capture token', async () => {
    const captureToken = await token();
    expect((await addLead(captureToken, '9876500002')).status).toBe(201);

    const reused = await addLead(captureToken, '9876500003');
    expect(reused.status).toBe(422);
    expect(reused.body.errorCode).toBe('CAPTURE_EXPIRED');
    expect(reused.body.message).toBe(
      'This photo was already used for another visit. Take a new one.',
    );

    // The refused lead was not created, and the number is still free.
    expect((await addLead(await token(), '9876500003')).status).toBe(201);
  });

  it('applies to follow-ups too', async () => {
    const lead = await addLead(await token(), '9876500004');
    const captureToken = await token();
    const followUp = () =>
      ravi.postForm(
        `/leads/${lead.body.data.id}/follow-ups`,
        {
          status: 'interested',
          note: 'Second visit, wants a demo.',
          location: 'Kondhwa',
          clientRequestId: requestId(),
          captureToken,
          ...gps,
        },
        photo,
      );
    expect((await followUp()).status).toBe(201);
    const again = await followUp();
    expect(again.status).toBe(422);
    expect(again.body.errorCode).toBe('CAPTURE_EXPIRED');
  });
});
