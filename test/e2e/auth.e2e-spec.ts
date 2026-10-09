import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** PRD §5.1 — login and session, against the real API. */
describe('Auth (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('is up, with the database reachable', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('publishes a valid OpenAPI document', async () => {
    const res = await fetch(`${harness.baseUrl}/docs/json`);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/login',
        '/api/v1/leads/{id}/follow-ups',
        '/api/v1/dashboard',
      ]),
    );
  });

  it('protects every route by default', async () => {
    const res = await api.get('/projects');
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('gives one message for a wrong password and an unknown email', async () => {
    const wrongPassword = await api.post('/auth/login', {
      email: 'owner@pronttera.in',
      password: 'nope-nope',
    });
    const unknownEmail = await api.post('/auth/login', {
      email: 'ghost@pronttera.in',
      password: 'nope-nope',
    });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
      expect(res.body.message).toBe('Email or password is incorrect');
    }
  });

  it('matches the email without regard to capitals and returns a session', async () => {
    const res = await api.post('/auth/login', {
      email: '  Owner@Pronttera.IN ',
      password: 'super-secret-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ role: 'super_admin', projects: [], notice: null });

    const me = await api.as(res.body.data.accessToken).get('/auth/me');
    expect(me.body.data.email).toBe('owner@pronttera.in');

    const refreshed = await api.post('/auth/refresh', { refreshToken: res.body.data.refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it('answers a reset request the same way for unknown emails', async () => {
    const known = await api.post('/auth/forgot-password', { email: 'owner@pronttera.in' });
    const unknown = await api.post('/auth/forgot-password', { email: 'ghost@pronttera.in' });
    expect(known.status).toBe(200);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('refuses an expired token with a clear message', async () => {
    const expired = await harness.supabase.accessToken(harness.superAdminId, { expiresIn: '-1m' });
    const res = await api.as(expired).get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please sign in again.');
  });

  it('sets a password from an invite link token', async () => {
    const admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const created = await admin.post('/users', {
      name: 'Neha Patil',
      email: 'neha@pronttera.in',
      role: 'sales_person',
    });
    expect(created.status).toBe(201);
    expect(harness.supabase.invites).toContain('neha@pronttera.in');

    const linkToken = await harness.supabase.accessToken(created.body.data.id);
    const tooShort = await api.post('/auth/set-password', {
      accessToken: linkToken,
      password: 'short',
    });
    expect(tooShort.status).toBe(400);

    const set = await api.post('/auth/set-password', {
      accessToken: linkToken,
      password: 'long-enough-1',
    });
    expect(set.status).toBe(200);

    const login = await api.post('/auth/login', {
      email: 'neha@pronttera.in',
      password: 'long-enough-1',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user.notice).toBe('You are not assigned to any project yet.');
  });
});
