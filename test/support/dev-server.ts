/**
 * The real API on an in-memory PostgreSQL and a fake Supabase, with a few people and
 * projects already in it. For driving the front end against the real code (the portal's
 * `npm run test:e2e:real`) without touching the hosted Supabase project. Place names come
 * from the harness's local stand-in for OpenStreetMap, so nothing reaches the internet.
 *
 *   npx ts-node -r tsconfig-paths/register test/support/dev-server.ts
 *
 * Prints one `READY {json}` line with the base URL and the logins, then runs until stopped.
 */
import { FROSTIQUE_COURSE, FROSTIQUE_LESSONS } from '../../src/database/seeds/training-content';
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

  // Training: the starting Frostique course, published and used by both campaigns, plus
  // one video (any public YouTube id works for a demo) and a campaign-only briefing.
  const course = await call<{ id: string }>('POST', '/training/courses', token, {
    ...FROSTIQUE_COURSE,
    published: true,
  });
  await call('POST', `/training/courses/${course.id}/items`, token, {
    kind: 'video',
    title: 'Frostique in 90 seconds',
    minutes: 2,
    sort: 0,
    payload: {
      url: 'https://youtu.be/aqz-KE-bpKQ',
      checks: [
        {
          text: 'What does Frostique take as commission on a shop’s orders?',
          options: ['Nothing', '5%', '25%'],
          answer: 0,
          explanation: 'No commission. Online payments carry only the payment gateway’s fee.',
        },
      ],
    },
  });
  for (const [index, lesson] of FROSTIQUE_LESSONS.entries()) {
    await call('POST', `/training/courses/${course.id}/items`, token, {
      ...lesson,
      sort: (index + 1) * 10,
    });
  }
  for (const p of [online, d2d]) {
    await call('PUT', `/projects/${p.id}/training/courses`, token, { courseIds: [course.id] });
  }
  await call('POST', `/projects/${online.id}/training/items`, token, {
    kind: 'card',
    title: 'Pune: what to know',
    payload: { markdown: 'Most bakeries here close 2–4 PM. Visit before 1 PM or after 4 PM.' },
  });

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
    trainingCourse: course.id,
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
