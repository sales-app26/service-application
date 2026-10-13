import { ApiClient } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

/** An instant given as India wall-clock time on a March 2025 day. */
const at = (day: number, time = '10:00'): string =>
  `2025-03-${String(day).padStart(2, '0')}T${time}:00+05:30`;
const MARCH = 'from=2025-03-01&to=2025-03-31';

/**
 * The team scorecard, its CSV and one rep's review, on a seeded March 2025:
 * who may see whom, every number on a known month, leave days, and the CSV
 * headings.
 */
describe('Scorecard and rep review (e2e)', () => {
  let harness: Harness;
  let admin: ApiClient;
  const as: Record<string, ApiClient> = {};
  const ids: Record<string, string> = {};
  const project: Record<string, string> = {};
  const location: Record<string, string> = {};
  const lead: Record<string, string> = {};
  const entry: Record<string, string> = {};
  let phone = 9_700_000_000;

  const sql = async (text: string, params: unknown[] = []) =>
    (await harness.db.query(text, params)).rows as Array<Record<string, any>>;

  const addLead = async (
    key: string,
    fields: {
      project: 'north' | 'south';
      owner: string;
      createdBy: string;
      createdAt: string;
      status?: string;
      convertedAt?: string;
      dealValue?: number;
      plan?: string;
      source?: string;
      nextDate?: string;
    },
  ) => {
    const [row] = await sql(
      `INSERT INTO sales.leads (project_id, owner_id, created_by, name, phone, location_id, status,
                                converted_at, converted_by, deal_value, plan, source, next_follow_up_date,
                                created_at, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::timestamptz IS NULL THEN NULL ELSE $2::uuid END,
               $9, $10, $11, $12, $13, $13) RETURNING id`,
      [
        project[fields.project],
        ids[fields.owner],
        ids[fields.createdBy],
        `Lead ${key}`,
        String((phone += 1)),
        location[fields.project],
        fields.status ?? 'contacted',
        fields.convertedAt ?? null,
        fields.dealValue ?? null,
        fields.plan ?? null,
        fields.source ?? null,
        fields.nextDate ?? null,
        fields.createdAt,
      ],
    );
    lead[key] = row.id;
  };

  const addEntry = async (
    key: string,
    fields: {
      lead: string;
      user: string;
      at: string;
      status: string;
      type?: 'follow_up' | 'status_change';
      reason?: string;
      photo?: boolean;
    },
  ) => {
    const [row] = await sql(
      `INSERT INTO sales.follow_ups (lead_id, project_id, user_id, entry_type, status, reason,
                                     photo_path, latitude, longitude, gps_accuracy_m, created_at, updated_at)
       SELECT l.id, l.project_id, $2, $3, $4, $5,
              CASE WHEN $6 THEN 'visits/proof.jpg' END, CASE WHEN $6 THEN 18.5 END,
              CASE WHEN $6 THEN 73.9 END, CASE WHEN $6 THEN 10 END, $7, $7
         FROM sales.leads l WHERE l.id = $1
       RETURNING id`,
      [
        lead[fields.lead],
        ids[fields.user],
        fields.type ?? 'follow_up',
        fields.status,
        fields.reason ?? null,
        fields.photo ?? false,
        fields.at,
      ],
    );
    entry[key] = row.id;
  };

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    ids.admin = harness.superAdminId;

    const person = async (name: string, role: 'moderator' | 'sales_person') => {
      const first = name.split(' ')[0];
      const res = await admin.post('/users', {
        name,
        email: `${first.toLowerCase()}@pronttera.in`,
        role,
      });
      expect(res.status).toBe(201);
      ids[first.toLowerCase()] = res.body.data.id;
      as[first.toLowerCase()] = api.as(await harness.supabase.accessToken(res.body.data.id));
    };
    await person('Meera Nair', 'moderator');
    await person('Omar Khan', 'moderator');
    await person('Ravi Kumar', 'sales_person');
    await person('Priya Desai', 'sales_person');
    await person('Sana Iyer', 'sales_person');

    for (const [key, name] of [
      ['north', 'North'],
      ['south', 'South'],
    ]) {
      const res = await admin.post('/projects', { name, type: 'online', startDate: '2025-01-01' });
      project[key] = res.body.data.id;
      const [loc] = await sql(
        `INSERT INTO sales.locations (project_id, name) VALUES ($1, 'Kondhwa') RETURNING id`,
        [project[key]],
      );
      location[key] = loc.id;
    }
    const join = async (key: string, who: string, target?: object) =>
      expect(
        (await admin.post(`/projects/${project[key]}/members`, { userId: ids[who], ...target }))
          .status,
      ).toBe(201);
    await join('north', 'meera');
    await join('north', 'ravi', { targetCount: 4, targetPeriod: 'monthly' });
    await join('north', 'priya');
    await join('south', 'omar');
    await join('south', 'sana');

    // Ravi, March: five leads added, three won (one after being turned down), two lost.
    await addLead('L1', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: at(2),
      status: 'converted',
      convertedAt: at(12),
      dealValue: 1499,
      plan: 'growth',
      source: 'walk_in',
    });
    await addLead('L2', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: at(10),
      status: 'converted',
      convertedAt: at(20),
      dealValue: 2999,
      plan: 'pro',
      source: 'referral',
    });
    await addLead('L3', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: at(5),
      status: 'lost',
      source: 'walk_in',
    });
    await addLead('L4', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: at(6),
      status: 'lost',
      source: 'phone',
    });
    await addLead('L5', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: at(7),
      status: 'converted',
      convertedAt: at(25),
      dealValue: 999,
      plan: 'growth',
    });
    // Before March: one overdue and one open lead, now Ravi's.
    await addLead('L6', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'ravi',
      createdAt: '2025-02-20T10:00:00+05:30',
      nextDate: '2025-02-25',
    });
    await addLead('L7', {
      project: 'north',
      owner: 'ravi',
      createdBy: 'priya',
      createdAt: '2025-02-21T10:00:00+05:30',
    });
    await addLead('L8', {
      project: 'north',
      owner: 'priya',
      createdBy: 'priya',
      createdAt: at(11),
    });
    await addLead('L9', {
      project: 'south',
      owner: 'sana',
      createdBy: 'sana',
      createdAt: at(3),
      status: 'converted',
      convertedAt: at(4),
      dealValue: 5000,
      plan: 'pro',
    });

    await addEntry('L1a', {
      lead: 'L1',
      user: 'ravi',
      at: at(2),
      status: 'contacted',
      photo: true,
    });
    await addEntry('L1b', { lead: 'L1', user: 'ravi', at: at(12), status: 'converted' });
    await addEntry('L2a', { lead: 'L2', user: 'ravi', at: at(10), status: 'contacted' });
    await addEntry('L2b', {
      lead: 'L2',
      user: 'ravi',
      at: at(20),
      status: 'converted',
      type: 'status_change',
    });
    await addEntry('L3a', { lead: 'L3', user: 'ravi', at: at(5), status: 'contacted' });
    await addEntry('L3b', {
      lead: 'L3',
      user: 'ravi',
      at: at(14),
      status: 'not_interested',
      reason: 'competitor',
      photo: true,
    });
    await addEntry('L3c', {
      lead: 'L3',
      user: 'ravi',
      at: at(15),
      status: 'lost',
      reason: 'price',
      type: 'status_change',
    });
    await addEntry('L4a', { lead: 'L4', user: 'ravi', at: at(6), status: 'lost', reason: 'price' });
    await addEntry('L5a', {
      lead: 'L5',
      user: 'ravi',
      at: at(7),
      status: 'not_interested',
      reason: 'no_need',
    });
    // Logged on a leave day: counts as a follow-up, not as an active day.
    await addEntry('L5b', { lead: 'L5', user: 'ravi', at: at(25), status: 'converted' });
    await addEntry('L8a', { lead: 'L8', user: 'priya', at: at(11), status: 'contacted' });
    await addEntry('L9a', { lead: 'L9', user: 'sana', at: at(3), status: 'contacted' });
    await addEntry('L9b', { lead: 'L9', user: 'sana', at: at(4), status: 'converted' });

    // Leave: 24–26 and 26–27 March overlap (4 days); a cancelled one does not count.
    await sql(
      `INSERT INTO sales.user_leaves (user_id, starts_on, ends_on, created_by, cancelled_at) VALUES
         ($1, '2025-03-24', '2025-03-26', $1, NULL),
         ($1, '2025-03-26', '2025-03-27', $1, NULL),
         ($1, '2025-03-29', '2025-03-30', $1, now())`,
      [ids.ravi],
    );

    // Handovers: Ravi asked for one in March (rejected) and one in April; one was handed to him.
    await sql(
      `INSERT INTO sales.lead_transfers (lead_id, from_user_id, to_user_id, reason, status, requested_by,
                                         created_at, decided_by, decided_at) VALUES
         ($1, $2, $3, 'Lives nearby', 'rejected', $2, $5, $4, $5),
         ($1, $2, $3, 'Lives nearby', 'rejected', $2, '2025-04-02T10:00:00+05:30', $4, '2025-04-02T11:00:00+05:30'),
         ($6, $3, $2, 'Owner moved', 'approved', $4, $7, $4, $7)`,
      [lead.L6, ids.ravi, ids.priya, ids.meera, at(8), lead.L7, at(9)],
    );

    // Feedback from Meera on Ravi's follow-ups: two in March, one in April.
    await sql(
      `INSERT INTO sales.lead_comments (lead_id, project_id, user_id, entry_id, kind, body, created_at) VALUES
         ($1, $2, $3, $4, 'feedback', 'Good first visit.', $6),
         ($1, $2, $3, $5, 'feedback', 'Ask for the annual plan next time.', $7),
         ($1, $2, $3, $5, 'feedback', 'Late note.', '2025-04-02T10:00:00+05:30'),
         ($1, $2, $3, NULL, 'comment', 'Not feedback.', $7)`,
      [lead.L1, project.north, ids.meera, entry.L1a, entry.L1b, at(3), at(13)],
    );
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ------------------------------------------------------------------ access

  describe('who sees what', () => {
    it('refuses sales reps the scorecard, a review and the file', async () => {
      for (const path of [
        `/reports/scorecard?${MARCH}`,
        `/reports/people/${ids.ravi}/review?${MARCH}`,
        `/exports/scorecard?${MARCH}`,
      ]) {
        const res = await as.ravi.get(path);
        expect(res.status).toBe(403);
      }
    });

    it('shows the sales head every rep, and one campaign when asked', async () => {
      const all = (await admin.get(`/reports/scorecard?${MARCH}`)).body.data;
      expect(all.rows.map((r: any) => r.user.name)).toEqual([
        'Priya Desai',
        'Ravi Kumar',
        'Sana Iyer',
      ]);
      const south = (await admin.get(`/reports/scorecard?${MARCH}&projectId=${project.south}`)).body
        .data;
      expect(south.rows.map((r: any) => r.user.name)).toEqual(['Sana Iyer']);
    });

    it('shows a sales manager only the reps in his campaigns', async () => {
      const res = await as.meera.get(`/reports/scorecard?${MARCH}`);
      expect(res.status).toBe(200);
      expect(res.body.data.rows.map((r: any) => r.user.name)).toEqual([
        'Priya Desai',
        'Ravi Kumar',
      ]);

      const other = await as.meera.get(`/reports/scorecard?${MARCH}&projectId=${project.south}`);
      expect(other.status).toBe(404);
    });

    it("keeps another campaign's rep from a sales manager's review", async () => {
      expect((await as.meera.get(`/reports/people/${ids.sana}/review?${MARCH}`)).status).toBe(404);
      expect((await as.omar.get(`/reports/people/${ids.ravi}/review?${MARCH}`)).status).toBe(404);
      expect((await as.omar.get(`/reports/people/${ids.sana}/review?${MARCH}`)).status).toBe(200);
      expect((await admin.get(`/reports/people/${ids.admin}/review?${MARCH}`)).status).toBe(404);
    });

    it("leaves another campaign's reps out of a sales manager's file", async () => {
      const res = await as.meera.get(`/exports/scorecard?${MARCH}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Ravi Kumar');
      expect(res.text).not.toContain('Sana Iyer');
    });
  });

  // ----------------------------------------------------------------- numbers

  describe('numbers on a known month', () => {
    it("counts Ravi's month", async () => {
      const { data } = (await admin.get(`/reports/scorecard?${MARCH}`)).body;
      expect(data).toMatchObject({ from: '2025-03-01', to: '2025-03-31', daysSoFar: 31 });
      const ravi = data.rows.find((r: any) => r.user.id === ids.ravi);
      expect(ravi).toEqual({
        user: { id: ids.ravi, name: 'Ravi Kumar' },
        isActive: true,
        campaigns: ['North'],
        leadsAdded: 5,
        followUps: 8,
        visits: 2,
        activeDays: 9,
        workingDays: 27,
        leaveDays: 4,
        dealsWon: 3,
        wonRevenue: 5497,
        lostLeads: 2,
        conversionPercent: 60,
        avgDaysToWin: 12.7,
        target: 4,
        achieved: 3,
        targetPercent: 75,
        overdueNow: 1,
        openNow: 2,
        topLostReason: 'price',
        handoversAsked: 1,
        handoversReceived: 1,
      });
    });

    it('gives a rep with nothing closed no conversion rate, and adds up the team', async () => {
      const { data } = (await admin.get(`/reports/scorecard?${MARCH}`)).body;
      const priya = data.rows.find((r: any) => r.user.id === ids.priya);
      expect(priya).toMatchObject({
        leadsAdded: 1,
        followUps: 1,
        activeDays: 1,
        dealsWon: 0,
        conversionPercent: null,
        avgDaysToWin: null,
        target: null,
        targetPercent: null,
        leaveDays: 0,
        workingDays: 31,
      });
      expect(data.totals).toMatchObject({
        leadsAdded: 7,
        followUps: 11,
        dealsWon: 4,
        wonRevenue: 10497,
        lostLeads: 2,
        conversionPercent: 67,
        target: 4,
        targetPercent: 75,
      });
      expect(data.averages).toMatchObject({ followUps: 3.7, dealsWon: 1.3, conversionPercent: 80 });
    });

    it('counts leave only up to today and never against active days', async () => {
      // A period entirely in the future has no working or leave days yet.
      const ahead = (await admin.get('/reports/scorecard?from=2099-01-01&to=2099-01-31')).body.data;
      expect(ahead.daysSoFar).toBe(0);
      expect(ahead.rows.find((r: any) => r.user.id === ids.ravi)).toMatchObject({
        workingDays: 0,
        leaveDays: 0,
        activeDays: 0,
        target: 4,
      });
    });

    it('refuses an upside-down or over-long range', async () => {
      expect((await admin.get('/reports/scorecard?from=2025-03-31&to=2025-03-01')).status).toBe(
        400,
      );
      const long = await admin.get('/reports/scorecard?from=2024-01-01&to=2025-03-31');
      expect(long.status).toBe(400);
      expect(long.body.message).toBe('A scorecard or review can cover at most 366 days.');
    });
  });

  // ------------------------------------------------------------------ review

  describe('rep review', () => {
    it('gives the same numbers with the team average beside them', async () => {
      const res = await as.meera.get(`/reports/people/${ids.ravi}/review?${MARCH}`);
      expect(res.status).toBe(200);
      const review = res.body.data;
      expect(review.person).toEqual({
        id: ids.ravi,
        name: 'Ravi Kumar',
        role: 'sales_person',
        isActive: true,
        campaigns: ['North'],
      });
      expect(review.numbers).toMatchObject({ dealsWon: 3, conversionPercent: 60, leaveDays: 4 });
      expect(review.teamSize).toBe(2);
      expect(review.teamAverage).toMatchObject({ followUps: 4.5, dealsWon: 1.5, leadsAdded: 3 });
    });

    it('breaks the month down', async () => {
      const review = (await as.meera.get(`/reports/people/${ids.ravi}/review?${MARCH}`)).body.data;

      expect(review.trendBucket).toBe('day');
      expect(review.trend).toHaveLength(31);
      expect(review.trend[1]).toEqual({
        date: '2025-03-02',
        followUps: 1,
        visits: 1,
        newLeads: 1,
        wins: 0,
      });
      expect(review.trend.reduce((n: number, p: any) => n + p.wins, 0)).toBe(3);

      expect(review.funnel).toEqual([
        { stage: 'created', count: 5 },
        { stage: 'contacted', count: 5 },
        { stage: 'interested', count: 3 },
        { stage: 'converted', count: 3 },
      ]);
      expect(review.lostReasons).toEqual([{ reason: 'price', count: 2 }]);
      expect(review.sources).toEqual([
        { source: 'walk_in', count: 2 },
        { source: 'phone', count: 1 },
        { source: 'referral', count: 1 },
        { source: 'unspecified', count: 1 },
      ]);
      expect(review.planMix).toEqual([
        { plan: 'growth', count: 2, revenue: 2498 },
        { plan: 'pro', count: 1, revenue: 2999 },
      ]);
      expect(review.recentWins.map((w: any) => [w.leadName, w.plan, w.dealValue])).toEqual([
        ['Lead L5', 'growth', 999],
        ['Lead L2', 'pro', 2999],
        ['Lead L1', 'growth', 1499],
      ]);
      expect(review.recentWins[0]).toMatchObject({ projectName: 'North', leadId: lead.L5 });

      // 2 March 2025 was a Sunday.
      expect(review.weekdays).toHaveLength(7);
      expect(review.weekdays[6]).toEqual({ weekday: 6, followUps: 1, visits: 1 });
      expect(review.weekdays.reduce((n: number, w: any) => n + w.followUps, 0)).toBe(8);

      expect(review.feedback.count).toBe(2);
      expect(review.feedback.recent.map((f: any) => f.body)).toEqual([
        'Ask for the annual plan next time.',
        'Good first visit.',
      ]);
      expect(review.feedback.recent[0]).toMatchObject({
        author: { id: ids.meera, name: 'Meera Nair' },
        leadId: lead.L1,
        entryId: entry.L1b,
      });
    });

    it('goes week by week past 31 days', async () => {
      const review = (
        await admin.get(`/reports/people/${ids.ravi}/review?from=2025-02-01&to=2025-03-31`)
      ).body.data;
      expect(review.trendBucket).toBe('week');
      expect(review.trend[0].date).toBe('2025-02-01');
      expect(review.trend.reduce((n: number, p: any) => n + p.followUps, 0)).toBe(8);
    });
  });

  // --------------------------------------------------------------------- CSV

  describe('scorecard file', () => {
    const lines = (text: string) =>
      text
        .replace(/^\uFEFF/u, '')
        .trim()
        .split('\r\n');

    it('uses sales words, one line per rep, then the team total and average', async () => {
      const res = await admin.get(`/exports/scorecard?${MARCH}&projectId=${project.north}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="scorecard_2025-03-01_2025-03-31.csv"',
      );
      const [header, ...rows] = lines(res.text);
      expect(header).toBe(
        'Sales rep,Campaign(s),Leads added,Follow-ups,Visits,Active days,Days on leave,Deals won,Revenue won (₹/month),Conversion %,Avg days to win,Target,Achieved,Target %,Overdue now,Open leads now,Lost leads,Top lost reason,Handovers asked,Handovers received,Working days,Still on team',
      );
      expect(rows).toHaveLength(4);
      expect(rows[1]).toBe(
        'Ravi Kumar,North,5,8,2,9,4,3,5497,60,12.7,4,3,75,1,2,2,Price too high,1,1,27,Yes',
      );
      expect(rows[2].startsWith('Team total,,6,9,')).toBe(true);
      expect(rows[3].startsWith('Team average,,3,4.5,')).toBe(true);
    });

    it('keeps the export limit of 92 days', async () => {
      const res = await admin.get('/exports/scorecard?from=2025-01-01&to=2025-04-30');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('A report can cover at most 92 days.');
    });
  });
});
