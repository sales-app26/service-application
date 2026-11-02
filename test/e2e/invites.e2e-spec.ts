import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/**
 * Invite links that don't expire, and sending them again. A harness per test: set-password
 * takes 10 calls a minute from one client, and these tests need more than that together.
 */
describe('Invites (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;

  beforeEach(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
  });

  afterEach(async () => {
    await harness?.close();
  });

  const latestLinkToken = (email: string): string => {
    const mail = harness.supabase.emails.filter((m) => m.to === email).at(-1)!;
    return new URL(mail.text.match(/https?:\/\/\S+/u)![0]).searchParams.get('token_hash')!;
  };
  const invite = async (name: string, email: string) => {
    const admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const created = await admin.post('/users', { name, email, role: 'sales_person' });
    expect(created.status).toBe(201);
    expect(created.body.data.invitePending).toBe(true);
    return { id: created.body.data.id as string, admin };
  };
  const setPassword = (tokenHash: string, password = 'long-enough-1') =>
    api.post('/auth/set-password', { tokenHash, type: 'invite', password });

  it('the link is ours: when every Supabase token has run out, it still works', async () => {
    await invite('Tara Rao', 'tara@pronttera.in');
    const tokenHash = latestLinkToken('tara@pronttera.in');
    const mail = harness.supabase.emails.find((m) => m.to === 'tara@pronttera.in')!;
    expect(mail.text).toContain('doesn’t expire');

    harness.supabase.expireLinks();

    expect((await setPassword(tokenHash)).status).toBe(200);
    const login = await api.post('/auth/login', {
      email: 'tara@pronttera.in',
      password: 'long-enough-1',
    });
    expect(login.status).toBe(200);
  });

  it('works even when the link lost its type on the way', async () => {
    await invite('Arjun Das', 'arjun@pronttera.in');
    const set = await api.post('/auth/set-password', {
      tokenHash: latestLinkToken('arjun@pronttera.in'),
      type: 'recovery',
      password: 'long-enough-1',
    });
    expect(set.status).toBe(200);
  });

  it('sends the invite again: the newest link works, the earlier one does not', async () => {
    const { id, admin } = await invite('Omar Sheikh', 'omar@pronttera.in');
    const first = latestLinkToken('omar@pronttera.in');

    const resent = await admin.post(`/users/${id}/resend-invite`);
    expect(resent.status).toBe(200);
    expect(resent.body.data.email).toBe('omar@pronttera.in');
    const second = latestLinkToken('omar@pronttera.in');
    expect(second).not.toBe(first);

    expect((await setPassword(first)).status).toBe(401);
    expect((await setPassword(second)).status).toBe(200);
    expect((await setPassword(second, 'another-long-1')).status).toBe(401);

    const person = await admin.get(`/users/${id}`);
    expect(person.body.data.invitePending).toBe(false);

    const again = await admin.post(`/users/${id}/resend-invite`);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already set a password/u);
  });

  it('never hands out the token hash', async () => {
    const { id, admin } = await invite('Mira Iyer', 'mira@pronttera.in');
    const person = await admin.get(`/users/${id}`);
    const list = await admin.get('/users?limit=100');
    expect(JSON.stringify([person.body, list.body])).not.toMatch(/inviteTokenHash/u);
  });

  it('a reset link closes the invite', async () => {
    const { id, admin } = await invite('Isha Nair', 'isha@pronttera.in');
    const inviteToken = latestLinkToken('isha@pronttera.in');

    expect((await admin.post(`/users/${id}/reset-email`)).status).toBe(200);
    const reset = await api.post('/auth/set-password', {
      tokenHash: latestLinkToken('isha@pronttera.in'),
      type: 'recovery',
      password: 'long-enough-1',
    });
    expect(reset.status).toBe(200);

    expect((await setPassword(inviteToken, 'another-long-1')).status).toBe(401);
    expect((await admin.get(`/users/${id}`)).body.data.invitePending).toBe(false);
  });

  it('a new email kills the link sent to the old one', async () => {
    const { id, admin } = await invite('Dev Malik', 'dev.typo@pronttera.in');
    const oldLink = latestLinkToken('dev.typo@pronttera.in');

    const changed = await admin.patch(`/users/${id}/email`, { email: 'dev@pronttera.in' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.invitePending).toBe(true);
    expect((await setPassword(oldLink)).status).toBe(401);

    expect((await admin.post(`/users/${id}/resend-invite`)).status).toBe(200);
    expect((await setPassword(latestLinkToken('dev@pronttera.in'))).status).toBe(200);
  });

  it('someone who left the team cannot use their invite until they are back', async () => {
    const { id, admin } = await invite('Riya Sen', 'riya@pronttera.in');
    const tokenHash = latestLinkToken('riya@pronttera.in');

    expect((await admin.post(`/users/${id}/deactivate`)).status).toBe(200);
    expect((await setPassword(tokenHash)).status).toBe(401);
    const resend = await admin.post(`/users/${id}/resend-invite`);
    expect(resend.status).toBe(409);
    expect(resend.body.message).toMatch(/back to the team/u);

    expect((await admin.post(`/users/${id}/reactivate`)).status).toBe(200);
    expect((await setPassword(tokenHash)).status).toBe(200);
  });

  it('a deleted person’s link is dead', async () => {
    const { id, admin } = await invite('Gita Bose', 'gita@pronttera.in');
    const tokenHash = latestLinkToken('gita@pronttera.in');

    expect((await admin.post(`/users/${id}/delete`, {})).status).toBe(200);
    expect((await setPassword(tokenHash)).status).toBe(401);
  });
});
