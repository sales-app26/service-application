/**
 * The real API on an in-memory PostgreSQL and a fake Supabase, with a few people and
 * projects already in it. For driving the front end against the real code (the portal's
 * `npm run test:e2e:real`) without touching the hosted Supabase project.
 *
 *   npx ts-node -r tsconfig-paths/register test/support/dev-server.ts
 *
 * Prints one `READY {json}` line with the base URL and the logins, then runs until stopped.
 */
import { startHarness } from './harness';

const PASSWORD = 'test-password-1';

async function main(): Promise<void> {
  const h = await startHarness();
  const api = `${h.baseUrl}/api/v1`;
  const call = async <T>(
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<T> => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as { data: T; message?: string };
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json.message}`);
    return json.data;
  };

  const sa = await call<{ accessToken: string }>('POST', '/auth/login', undefined, {
    email: 'owner@pronttera.in',
    password: 'super-secret-1',
  });
  const token = sa.accessToken;
  const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
    const u = await call<{ id: string }>('POST', '/users', token, { name, email, role });
    h.supabase.setPassword(u.id, PASSWORD); // as if the invite link had been used
    return { id: u.id, name, email, password: PASSWORD };
  };
  const moderator = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
  const ravi = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
  const priya = await person('Priya Desai', 'priya@pronttera.in', 'sales_person');
  const karan = await person('Karan Mehta', 'karan@pronttera.in', 'sales_person');

  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const online = await call<{ id: string }>('POST', '/projects', token, {
    name: 'Pune Retail Drive',
    type: 'online',
    startDate: start,
  });
  const d2d = await call<{ id: string }>('POST', '/projects', token, {
    name: 'Kondhwa Door-to-door',
    type: 'door_to_door',
    startDate: start,
  });
  for (const p of [online, d2d]) {
    await call('POST', `/projects/${p.id}/members`, token, { userId: moderator.id });
    for (const u of [ravi, priya, karan])
      await call('POST', `/projects/${p.id}/members`, token, {
        userId: u.id,
        targetCount: 10,
        targetPeriod: 'weekly',
      });
  }

  const info = {
    baseUrl: h.baseUrl,
    superAdmin: {
      id: h.superAdminId,
      name: 'Adeeb Shah',
      email: 'owner@pronttera.in',
      password: 'super-secret-1',
    },
    moderator,
    sales: ravi,
    others: { priya, karan },
    projects: { online: online.id, doorToDoor: d2d.id },
  };
  console.log(`READY ${JSON.stringify(info)}`);

  const stop = async (): Promise<void> => {
    await h.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
