import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

const DAY_MS = 24 * 60 * 60 * 1000;
const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);
const plusDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Sales insights (`05_sales_insights.sql`): deal value, plan and source on leads, lost
 * reasons on entries, last activity, the lead list's due/cold filters, the agenda, the
 * dashboard's revenue, funnel, trend and "needs attention", and the export columns.
 */
describe('Sales insights (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  let moderator: ApiClient;
  let ravi: ApiClient;
  let priya: ApiClient;
  let projectId: string;
  const ids: Record<string, string> = {};
  const today = istDate(new Date());
  let phone = 9876500000;

  const addLead = (client: ApiClient, fields: Record<string, unknown> = {}, project = projectId) =>
    client.post(`/projects/${project}/leads`, {
      name: 'Asha Patil',
      businessName: 'Patil Sweets',
      phone: String((phone += 1)),
      location: 'Kondhwa',
      status: 'contacted',
      note: 'Met the owner at the shop.',
      clientRequestId: requestId(),
      ...fields,
    });
  const followUp = (client: ApiClient, leadId: string, fields: Record<string, unknown>) =>
    client.post(`/leads/${leadId}/follow-ups`, {
      note: 'Called again today.',
      location: 'Kondhwa',
      clientRequestId: requestId(),
      ...fields,
    });
  const changeStatus = (client: ApiClient, leadId: string, fields: Record<string, unknown>) =>
    client.post(`/leads/${leadId}/status`, {
      note: 'Changed after a call.',
      clientRequestId: requestId(),
      ...fields,
    });
  const list = async (client: ApiClient, query: string, project = projectId) => {
    const res = await client.get(`/projects/${project}/leads?limit=100&${query}`);
    expect(res.status).toBe(200);
    return res.body.data.items as Array<any>;
  };
  const sql = (text: string, params: unknown[] = []) => harness.db.query(text, params);

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
      const res = await admin.post('/users', { name, email, role });
      expect(res.status).toBe(201);
      ids[name.split(' ')[0].toLowerCase()] = res.body.data.id;
      return api.as(await harness.supabase.accessToken(res.body.data.id));
    };
    moderator = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    ravi = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');
    priya = await person('Priya Desai', 'priya@pronttera.in', 'sales_person');

    const project = await admin.post('/projects', {
      name: 'Insights Drive',
      type: 'online',
      startDate: '2026-01-01',
    });
    projectId = project.body.data.id;
    for (const id of [ids.meera, ids.ravi, ids.priya]) {
      expect((await admin.post(`/projects/${projectId}/members`, { userId: id })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ------------------------------------------------------------- lead fields

  describe('deal value, plan and source', () => {
    it('adds a lead with them, credited to whoever added it', async () => {
      const before = Date.now();
      const res = await addLead(ravi, {
        status: 'interested',
        dealValue: 1499,
        planCode: 'growth',
        source: 'walk_in',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        dealValue: 1499,
        plan: null,
        planCode: 'growth',
        source: 'walk_in',
        createdBy: { id: ids.ravi, name: 'Ravi Kumar' },
      });
      expect(Date.parse(res.body.data.lastActivityAt)).toBeGreaterThanOrEqual(before - 1000);
      expect(res.body.data.recentEntries[0].reason).toBeNull();

      // The list carries the same fields.
      const [row] = (await list(ravi, 'source=walk_in')).filter((l) => l.id === res.body.data.id);
      expect(row).toMatchObject({ dealValue: 1499, planCode: 'growth', source: 'walk_in' });
    });

    it('reads them from a multipart form, where every field is a string', async () => {
      const res = await ravi.postForm(`/projects/${projectId}/leads`, {
        name: 'Form Lead',
        businessName: 'Form Bakery',
        phone: String((phone += 1)),
        location: 'Kondhwa',
        status: 'contacted',
        note: 'Sent from the phone form.',
        clientRequestId: requestId(),
        dealValue: '1200',
        planCode: '',
        reason: '',
        source: 'event',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ dealValue: 1200, planCode: null, source: 'event' });
    });

    it('leaves them empty when not sent', async () => {
      const res = await addLead(ravi);
      expect(res.body.data).toMatchObject({ dealValue: null, planCode: null, source: null });
    });

    it.each([
      ['an unknown source', { source: 'billboard' }],
      ['a negative deal value', { dealValue: -1 }],
      ['a fractional deal value', { dealValue: 99.5 }],
      ['a deal value over 10 crore', { dealValue: 100_000_001 }],
      ['an unknown plan', { planCode: 'gold' }],
      ['free text for the plan, no longer written', { plan: 'Annual Gold' }],
      ['an unknown reason', { status: 'lost', reason: 'weather' }],
    ])('refuses %s', async (_, fields) => {
      const res = await addLead(ravi, fields);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('takes a reason on a new lead only when it is Not interested or Lost', async () => {
      const wrong = await addLead(ravi, { status: 'interested', reason: 'price' });
      expect(wrong.status).toBe(400);
      expect(wrong.body.message).toBe('A reason can be given only for Not interested or Lost.');

      const right = await addLead(ravi, { status: 'not_interested', reason: 'price' });
      expect(right.status).toBe(201);
      expect(right.body.data.recentEntries[0].reason).toBe('price');
    });

    it('lets the owner edit and clear them; an admin cannot, as with any lead field', async () => {
      const lead = (await addLead(ravi, { dealValue: 500, planCode: 'growth', source: 'phone' }))
        .body.data;
      // Any deal field replaces the whole deal: the plan left out is cleared.
      const res = await ravi.patch(`/leads/${lead.id}`, {
        dealValue: 750,
        source: 'referral',
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ dealValue: 750, planCode: null, source: 'referral' });

      const cleared = await ravi.patch(`/leads/${lead.id}`, { dealValue: null, source: null });
      expect(cleared.body.data).toMatchObject({ dealValue: null, source: null });

      expect((await ravi.patch(`/leads/${lead.id}`, { source: 'tv' })).status).toBe(400);
      expect((await moderator.patch(`/leads/${lead.id}`, { dealValue: 1 })).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ entries

  describe('entries', () => {
    let leadId: string;

    beforeAll(async () => {
      leadId = (await addLead(ravi, { source: 'whatsapp' })).body.data.id;
    });

    it('refuses a reason with any status but Not interested or Lost, and a deal before Converted', async () => {
      const reason = await followUp(ravi, leadId, { status: 'interested', reason: 'price' });
      expect(reason.status).toBe(400);
      expect(reason.body.errorCode).toBe('VALIDATION_FAILED');

      const deal = await followUp(ravi, leadId, { status: 'interested', dealValue: 999 });
      expect(deal.status).toBe(400);
      expect(deal.body.message).toBe('Deal details can be added only when the lead is Won.');

      const manual = await changeStatus(ravi, leadId, { status: 'interested', reason: 'no_need' });
      expect(manual.status).toBe(400);
    });

    it('records the deal on conversion and moves last activity', async () => {
      const before = (await ravi.get(`/leads/${leadId}`)).body.data.lastActivityAt;
      const res = await followUp(ravi, leadId, {
        status: 'converted',
        dealValue: 2999,
        planCode: 'pro',
      });
      expect(res.status).toBe(201);
      expect(res.body.data.lead).toMatchObject({
        status: 'converted',
        dealValue: 2999,
        planCode: 'pro',
        dealTotal: 2999,
        effectiveMonthlyValue: 2999,
      });
      expect(Date.parse(res.body.data.lead.lastActivityAt)).toBeGreaterThan(Date.parse(before));
      expect(res.body.data.lead.lastActivityAt).toBe(res.body.data.entry.createdAt);

      // A later after-sale visit that sends no deal keeps it.
      const visit = await followUp(ravi, leadId, { status: 'converted' });
      expect(visit.body.data.lead).toMatchObject({ dealValue: 2999, planCode: 'pro' });
    });

    it('saves a lost reason on a status change', async () => {
      const lead = (await addLead(ravi)).body.data;
      const res = await changeStatus(ravi, lead.id, { status: 'lost', reason: 'competitor' });
      expect(res.status).toBe(200);
      expect(res.body.data.entry).toMatchObject({ status: 'lost', reason: 'competitor' });
      const history = await ravi.get(`/leads/${lead.id}/entries`);
      expect(history.body.data.items[0].reason).toBe('competitor');
    });

    it('falls back to the previous entry’s time when the latest is deleted', async () => {
      const lead = (await addLead(ravi)).body.data;
      const first = lead.recentEntries[0];
      const second = (await followUp(ravi, lead.id, { status: 'interested' })).body.data;
      expect(second.lead.lastActivityAt).toBe(second.entry.createdAt);

      expect((await admin.delete(`/entries/${second.entry.id}`)).status).toBe(200);
      const after = (await ravi.get(`/leads/${lead.id}`)).body.data;
      expect(after.lastActivityAt).toBe(first.createdAt);
      expect(after.status).toBe('contacted');
    });
  });

  // ------------------------------------------------------- filters and agenda

  describe('due and cold filters, and the agenda', () => {
    let filterProject: string;
    const leads: Record<string, string> = {};

    beforeAll(async () => {
      const project = await admin.post('/projects', {
        name: 'Agenda Drive',
        type: 'online',
        startDate: '2026-01-01',
      });
      filterProject = project.body.data.id;
      await admin.post(`/projects/${filterProject}/members`, { userId: ids.ravi });

      const dates: Record<string, string | null> = {
        overdue: plusDays(today, -2),
        today,
        tomorrow: plusDays(today, 1),
        later: plusDays(today, 5),
        nextMonth: plusDays(today, 30),
        none: null,
        cold: null,
      };
      for (const [key, date] of Object.entries(dates)) {
        const res = await addLead(
          ravi,
          { businessName: key, dealValue: key.length * 100 },
          filterProject,
        );
        expect(res.status).toBe(201);
        leads[key] = res.body.data.id;
        // A follow-up date can't be set in the past through the API: age it here.
        if (date) {
          await sql(`UPDATE sales.leads SET next_follow_up_date = $1 WHERE id = $2`, [
            date,
            leads[key],
          ]);
        }
      }
      await sql(
        `UPDATE sales.leads SET last_activity_at = now() - interval '20 days' WHERE id = $1`,
        [leads.cold],
      );
      // A closed lead with no date is neither "none" nor cold, however old.
      const closed = await addLead(ravi, { businessName: 'closed', status: 'lost' }, filterProject);
      await sql(
        `UPDATE sales.leads SET last_activity_at = now() - interval '60 days' WHERE id = $1`,
        [closed.body.data.id],
      );

      // Two imported leads nobody has contacted yet.
      const csv =
        'business_name,phone,location\nImported One,9123400001,Pune\nImported Two,9123400002,Pune\n';
      const imported = await admin.postForm(
        `/projects/${filterProject}/leads/import`,
        { ownerId: ids.ravi },
        Buffer.from(csv, 'utf8'),
        'file',
      );
      expect(imported.body.data.imported).toBe(2);
    });

    const names = async (query: string) =>
      (await list(ravi, query, filterProject)).map((l) => l.businessName).sort();

    it('filters by next follow-up date, India time', async () => {
      expect(await names('due=overdue')).toEqual(['overdue']);
      expect(await names('due=today')).toEqual(['today']);
      expect(await names('due=tomorrow')).toEqual(['tomorrow']);
      expect(await names('due=week')).toEqual(['later', 'tomorrow']);
      expect(await names('due=none')).toEqual(['Imported One', 'Imported Two', 'cold', 'none']);
    });

    it('finds cold leads: open, untouched for 14 days', async () => {
      expect(await names('cold=true')).toEqual(['cold']);
      expect(await names('cold=true&due=none')).toEqual(['cold']);
    });

    it('filters by source and sorts by value and by activity', async () => {
      expect(await names('source=import')).toEqual(['Imported One', 'Imported Two']);

      const byValue = (await list(ravi, 'sort=value', filterProject)).map((l) => l.businessName);
      // nextMonth (900), overdue/tomorrow (700/800) … and the deal-less ones last.
      expect(byValue[0]).toBe('nextMonth');
      expect(byValue.slice(-3).sort()).toEqual(['Imported One', 'Imported Two', 'closed']);

      const byActivity = (await list(ravi, 'sort=activity', filterProject)).map(
        (l) => l.businessName,
      );
      expect(byActivity.slice(0, 2)).toEqual(['closed', 'cold']);
    });

    it('refuses unknown filter values', async () => {
      for (const query of ['due=later', 'cold=maybe', 'source=tv', 'sort=price']) {
        expect((await ravi.get(`/projects/${filterProject}/leads?${query}`)).status).toBe(400);
      }
    });

    it('imported leads carry source import and the importing admin', async () => {
      const [lead] = await list(admin, 'source=import&search=Imported%20One', filterProject);
      expect(lead).toMatchObject({
        source: 'import',
        createdBy: { id: harness.superAdminId, name: 'Adeeb Shah' },
        status: 'new',
      });
    });

    it('counts the agenda the same way the filters do', async () => {
      const res = await ravi.get(`/me/agenda?projectId=${filterProject}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        overdue: 1,
        today: 1,
        tomorrow: 1,
        thisWeek: 2,
        cold: 1,
        untouched: 2,
      });
    });

    it('is for members doing sales work, and only within their projects', async () => {
      expect((await admin.get('/me/agenda')).status).toBe(403);
      expect((await priya.get(`/me/agenda?projectId=${filterProject}`)).status).toBe(404);
      const priyaAll = await priya.get('/me/agenda');
      expect(priyaAll.body.data).toMatchObject({ overdue: 0, cold: 0, untouched: 0 });
    });

    it('home shows this month’s conversions and revenue', async () => {
      const res = await ravi.get('/me/home');
      expect(res.body.data).toMatchObject({ conversionsThisMonth: 1, revenueThisMonth: 2999 });
      expect((await priya.get('/me/home')).body.data).toMatchObject({
        conversionsThisMonth: 0,
        revenueThisMonth: 0,
      });
    });
  });

  // ---------------------------------------------------------------- dashboard

  describe('dashboard', () => {
    const dashboard = async (query: string) => {
      const res = await admin.get(`/dashboard?${query}`);
      expect(res.status).toBe(200);
      return res.body.data;
    };

    it('sums revenue over the conversions in the range, overall and per person', async () => {
      const data = await dashboard(`from=${today}&to=${today}&projectId=${projectId}`);
      expect(data).toMatchObject({ conversions: 1, revenue: 2999 });
      const row = data.people.find((p: any) => p.user.id === ids.ravi);
      expect(row).toMatchObject({ conversions: 1, revenue: 2999 });
      expect(data.people.find((p: any) => p.user.id === ids.priya).revenue).toBe(0);
    });

    it('shows the funnel of leads added in the range', async () => {
      const data = await dashboard(`from=${today}&to=${today}&projectId=${projectId}`);
      // 8 leads added here, none still New: 1 interested, 1 converted, the rest contacted or closed.
      expect(data.funnel).toEqual([
        { stage: 'created', count: data.newLeads },
        { stage: 'contacted', count: data.newLeads },
        { stage: 'interested', count: 2 },
        { stage: 'converted', count: 1 },
      ]);
    });

    it('counts new leads by created_by, so imported ones count for the admin', async () => {
      const data = await dashboard(`from=${today}&to=${today}`);
      // The two leads the Super Admin imported are his, though Ravi owns them.
      const admins = data.people.find((p: any) => p.user.id === harness.superAdminId);
      expect(admins).toMatchObject({ newLeads: 2, followUps: 0 });
      const leadsToday = await sql(
        `SELECT count(*)::int AS count FROM sales.leads WHERE deleted_at IS NULL`,
      );
      expect(data.newLeads).toBe((leadsToday.rows[0] as any).count);
      expect(data.funnel[0].count).toBe(data.newLeads);
    });

    it('trends by day, and by week past 92 days', async () => {
      const day = await dashboard(`from=${plusDays(today, -6)}&to=${today}`);
      expect(day.trendBucket).toBe('day');
      expect(day.trend).toHaveLength(7);
      expect(day.trend.at(-1)).toMatchObject({ date: today, conversions: 1, revenue: 2999 });
      expect(day.trend.at(-1).newLeads).toBe(day.newLeads);
      expect(day.trend.at(-1).followUps).toBe(day.followUps);

      const long = await dashboard(`from=${plusDays(today, -119)}&to=${today}`);
      expect(long.trendBucket).toBe('week');
      expect(long.trend.length).toBeLessThanOrEqual(19);
      expect(long.trend.reduce((n: number, p: any) => n + p.revenue, 0)).toBe(2999);
    });

    it('counts lost reasons and sources', async () => {
      const data = await dashboard(`from=${today}&to=${today}&projectId=${projectId}`);
      expect(data.lostReasons).toEqual(
        expect.arrayContaining([
          { reason: 'price', count: 1 },
          { reason: 'competitor', count: 1 },
        ]),
      );
      expect(data.sources).toEqual(
        expect.arrayContaining([
          { source: 'walk_in', count: 1 },
          { source: 'whatsapp', count: 1 },
          { source: 'unspecified', count: expect.any(Number) },
        ]),
      );
    });

    it('covers at most 366 days', async () => {
      const res = await admin.get(`/dashboard?from=${plusDays(today, -366)}&to=${today}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('The sales overview can cover at most 366 days.');
      expect((await admin.get(`/dashboard?from=${plusDays(today, -365)}&to=${today}`)).status).toBe(
        200,
      );
    });

    it('flags overdue piles, idle members and stale transfers right now', async () => {
      const project = await admin.post('/projects', {
        name: 'Attention Drive',
        type: 'online',
        startDate: '2026-01-01',
      });
      const pid = project.body.data.id;
      for (const id of [ids.meera, ids.ravi, ids.priya]) {
        await admin.post(`/projects/${pid}/members`, { userId: id });
      }

      // Priya: six overdue leads, and nothing logged for three days.
      const priyaLeads: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        priyaLeads.push((await addLead(priya, { name: `Pile ${i}` }, pid)).body.data.id);
      }
      await sql(`UPDATE sales.leads SET next_follow_up_date = $1 WHERE id = ANY($2::uuid[])`, [
        plusDays(today, -3),
        priyaLeads,
      ]);
      await sql(
        `UPDATE sales.follow_ups SET created_at = now() - interval '3 days', updated_at = now() - interval '3 days' WHERE user_id = $1`,
        [ids.priya],
      );
      await sql(
        `UPDATE sales.project_members SET joined_at = now() - interval '10 days' WHERE user_id = $1`,
        [ids.priya],
      );

      // Ravi asked to hand a lead to Priya 30 hours ago; nobody has decided.
      const lead = (await addLead(ravi, { businessName: 'Shah Stores' }, pid)).body.data;
      const transfer = await ravi.post(`/leads/${lead.id}/transfers`, {
        toUserId: ids.priya,
        reason: 'She covers this area.',
      });
      expect(transfer.status).toBe(201);
      await sql(
        `UPDATE sales.lead_transfers SET created_at = now() - interval '30 hours' WHERE id = $1`,
        [transfer.body.data.id],
      );

      const data = await dashboard(`projectId=${pid}`);
      const byKind = (kind: string) => data.needsAttention.filter((a: any) => a.kind === kind);

      expect(byKind('overdue_pile')).toEqual([
        {
          kind: 'overdue_pile',
          user: { id: ids.priya, name: 'Priya Desai' },
          projectName: 'Attention Drive',
          detail: '6 leads overdue for a follow-up.',
          leadCount: 6,
        },
      ]);
      expect(byKind('idle')).toEqual([
        {
          kind: 'idle',
          user: { id: ids.priya, name: 'Priya Desai' },
          projectName: 'Attention Drive',
          detail: 'No activity for 3 days.',
          leadCount: 6,
        },
      ]);
      expect(byKind('stale_transfer')).toEqual([
        {
          kind: 'stale_transfer',
          user: { id: ids.ravi, name: 'Ravi Kumar' },
          projectName: 'Attention Drive',
          detail: 'Handover of Shah Stores to Priya Desai waiting 30 hours.',
        },
      ]);
      // Ravi logged today and the moderator owns no leads: neither is idle.
      expect(data.needsAttention.length).toBeLessThanOrEqual(20);

      // Most severe first: 30 h is 1.25× its line, 3 idle days 1.5×, 6 overdue 1.2×.
      const order = data.needsAttention
        .filter((a: any) => a.kind !== 'behind_target')
        .map((a: any) => a.kind);
      expect(order).toEqual(['idle', 'stale_transfer', 'overdue_pile']);

      // A person filter narrows it to them.
      const ravis = await dashboard(`projectId=${pid}&userId=${ids.ravi}`);
      expect(ravis.needsAttention.map((a: any) => a.kind)).not.toContain('overdue_pile');
    });
  });

  // ------------------------------------------------------------------ exports

  describe('exports', () => {
    const lines = (text: string) =>
      text
        .replace(/^\uFEFF/u, '')
        .trim()
        .split('\r\n');

    it('adds the deal, source and last activity to the leads file', async () => {
      const res = await admin.get(
        `/exports/leads?from=${today}&to=${today}&projectId=${projectId}`,
      );
      expect(res.status).toBe(200);
      const [header, ...rows] = lines(res.text);
      expect(header).toBe(
        'Lead reference,Campaign,Contact person,Business name,Phone,Location,Stage,Next follow-up,Lead owner,Owner still on team,Won on (IST),Won by,Plan,Tenure (months),Monthly price (₹),Discount,Coupon,Deal total (₹),Monthly revenue after discount (₹),Lead source,Added on (IST),Last changed (IST),Last activity (IST),Notes',
      );
      expect(rows.some((row) => row.includes(',Pro,1,2999,,,2999,2999,WhatsApp,'))).toBe(true);
    });

    it('adds the reason to the follow-ups file', async () => {
      const res = await admin.get(
        `/exports/follow-ups?from=${today}&to=${today}&projectId=${projectId}`,
      );
      const [header, ...rows] = lines(res.text);
      expect(header.split(',').slice(7, 11)).toEqual(['Activity', 'Stage', 'Reason', 'Note']);
      expect(rows.some((row) => row.includes(',Stage change,Lost,Chose a competitor,'))).toBe(true);
    });

    it('refuses a file of more than 20,000 rows', async () => {
      const project = await admin.post('/projects', {
        name: 'Bulk Drive',
        type: 'online',
        startDate: '2026-01-01',
      });
      const pid = project.body.data.id;
      const location = await sql(
        `INSERT INTO sales.locations (project_id, name) VALUES ($1, 'Pune') RETURNING id`,
        [pid],
      );
      await sql(
        `INSERT INTO sales.leads (project_id, owner_id, name, phone, location_id)
         SELECT $1, $2, 'Bulk ' || i, '7' || lpad(i::text, 9, '0'), $3
           FROM generate_series(1, 20001) AS i`,
        [pid, ids.ravi, (location.rows[0] as any).id],
      );

      const res = await admin.get(`/exports/leads?from=${today}&to=${today}&projectId=${pid}`);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      expect(res.body.message).toBe(
        'This report is too big (over 20,000 lines). Choose fewer days, one campaign or one person.',
      );

      await sql(`DELETE FROM sales.leads WHERE project_id = $1 AND name = 'Bulk 20001'`, [pid]);
      expect(
        (await admin.get(`/exports/leads?from=${today}&to=${today}&projectId=${pid}`)).status,
      ).toBe(200);
    });
  });
});
