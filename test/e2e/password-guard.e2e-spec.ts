import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/**
 * The live Supabase project is shared with Pronttera Connect, whose trigger on
 * auth.users refuses a password change unless an approval row was written in
 * the last two minutes (private.password_change_approvals). The fake Supabase
 * plays that trigger against the test database, so these tests fail the same
 * way production did when the API didn't write the approval.
 */
describe('Password changes behind a password guard (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let guardOpen = true;

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    await harness.db.exec(`
      CREATE SCHEMA IF NOT EXISTS private;
      CREATE TABLE private.password_change_approvals (
        user_id uuid PRIMARY KEY,
        approved_by uuid NOT NULL,
        approved_at timestamptz NOT NULL DEFAULT now()
      );`);
    harness.supabase.passwordGuard = async (userId) => {
      // Like the trigger: an approval from the last two minutes is spent; otherwise refuse.
      const spent = await harness.db.query(
        `DELETE FROM private.password_change_approvals
          WHERE user_id = $1 AND approved_at > now() - interval '2 minutes'
         RETURNING user_id`,
        [userId],
      );
      return guardOpen && spent.rows.length > 0;
    };
  });

  afterAll(async () => {
    await harness?.close();
  });

  const invite = async (
    name: string,
    email: string,
  ): Promise<{ id: string; tokenHash: string }> => {
    const admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const created = await admin.post('/users', { name, email, role: 'sales_person' });
    expect(created.status).toBe(201);
    const mail = harness.supabase.emails.filter((m) => m.to === email).at(-1)!;
    const tokenHash = new URL(mail.text.match(/https?:\/\/\S+/u)![0]).searchParams.get(
      'token_hash',
    )!;
    return { id: (created.body as { data: { id: string } }).data.id, tokenHash };
  };

  it('an invite link sets the password: the API approves the change first', async () => {
    const { tokenHash } = await invite('Imran Shaikh', 'imran@pronttera.in');
    const set = await api.post('/auth/set-password', {
      tokenHash,
      type: 'invite',
      password: 'long-enough-1',
    });
    expect(set.status).toBe(200);

    const login = await api.post('/auth/login', {
      email: 'imran@pronttera.in',
      password: 'long-enough-1',
    });
    expect(login.status).toBe(200);
  });

  it('change password works for a signed-in person', async () => {
    const { tokenHash } = await invite('Sana Mirza', 'sana@pronttera.in');
    expect(
      (
        await api.post('/auth/set-password', {
          tokenHash,
          type: 'invite',
          password: 'first-pass-1',
        })
      ).status,
    ).toBe(200);

    const login = await api.post('/auth/login', {
      email: 'sana@pronttera.in',
      password: 'first-pass-1',
    });
    const token = (login.body as { data: { accessToken: string } }).data.accessToken;
    const changed = await api.as(token).post('/auth/change-password', {
      currentPassword: 'first-pass-1',
      newPassword: 'second-pass-2',
    });
    expect(changed.status).toBe(200);
    expect(
      (await api.post('/auth/login', { email: 'sana@pronttera.in', password: 'second-pass-2' }))
        .status,
    ).toBe(200);
  });

  it('when the password still cannot be saved, it says so instead of "link expired"', async () => {
    const { tokenHash } = await invite('Karan Joshi', 'karan.j@pronttera.in');
    guardOpen = false;
    try {
      const set = await api.post('/auth/set-password', {
        tokenHash,
        type: 'invite',
        password: 'long-enough-1',
      });
      expect(set.status).toBe(502);
      expect((set.body as { message: string }).message).toMatch(/couldn’t be saved/u);
    } finally {
      guardOpen = true;
    }
  });
});
