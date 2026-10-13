import { ApiClient, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

const istDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

/**
 * Deal terms (`08_deal_terms.sql`): plan prices and offers (the sales head sets
 * them, everyone reads them), a Won deal with a plan, tenure and an offer or a
 * typed discount, and won revenue as the effective monthly value in the home
 * screen, the dashboard and the export.
 */
describe('Deal terms (e2e)', () => {
  let harness: Harness;
  let head: ApiClient;
  let manager: ApiClient;
  let ravi: ApiClient;
  let projectId: string;
  const ids: Record<string, string> = {};
  const today = istDate(new Date());
  let phone = 9876600000;

  const addLead = (client: ApiClient, fields: Record<string, unknown> = {}) =>
    client.post(`/projects/${projectId}/leads`, {
      name: 'Asha Patil',
      phone: String((phone += 1)),
      location: 'Kondhwa',
      status: 'interested',
      note: 'Met the owner at the shop.',
      clientRequestId: requestId(),
      ...fields,
    });
  const win = (leadId: string, fields: Record<string, unknown>) =>
    ravi.post(`/leads/${leadId}/follow-ups`, {
      status: 'converted',
      note: 'Signed up at the counter.',
      location: 'Kondhwa',
      clientRequestId: requestId(),
      ...fields,
    });

  beforeAll(async () => {
    harness = await startHarness();
    const api = new ApiClient(harness.baseUrl);
    head = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const person = async (name: string, email: string, role: 'moderator' | 'sales_person') => {
      const res = await head.post('/users', { name, email, role });
      expect(res.status).toBe(201);
      ids[name.split(' ')[0].toLowerCase()] = res.body.data.id;
      return api.as(await harness.supabase.accessToken(res.body.data.id));
    };
    manager = await person('Meera Nair', 'meera@pronttera.in', 'moderator');
    ravi = await person('Ravi Kumar', 'ravi@pronttera.in', 'sales_person');

    const project = await head.post('/projects', {
      name: 'Diwali Drive',
      type: 'online',
      startDate: '2026-01-01',
    });
    projectId = project.body.data.id;
    for (const id of [ids.meera, ids.ravi]) {
      expect((await head.post(`/projects/${projectId}/members`, { userId: id })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  // ------------------------------------------------------------ plan prices

  describe('plan prices', () => {
    it('lists the four plans for everyone, unpriced until the sales head sets them', async () => {
      for (const client of [ravi, manager, head]) {
        const res = await client.get('/settings/plan-prices');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([
          { plan: 'free', monthlyPrice: 0 },
          { plan: 'growth', monthlyPrice: null },
          { plan: 'growth_plus', monthlyPrice: null },
          { plan: 'pro', monthlyPrice: null },
        ]);
      }
    });

    it('lets only the sales head set them', async () => {
      const body = { prices: [{ plan: 'growth', monthlyPrice: 2499 }] };
      expect((await ravi.put('/settings/plan-prices', body)).status).toBe(403);
      expect((await manager.put('/settings/plan-prices', body)).status).toBe(403);

      const res = await head.put('/settings/plan-prices', {
        prices: [
          { plan: 'growth', monthlyPrice: 2499 },
          { plan: 'growth_plus', monthlyPrice: 3499 },
          { plan: 'pro', monthlyPrice: 4999 },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Plan prices saved.');
      expect(res.body.data.map((p: any) => p.monthlyPrice)).toEqual([0, 2499, 3499, 4999]);
      expect((await ravi.get('/settings/plan-prices')).body.data[1]).toEqual({
        plan: 'growth',
        monthlyPrice: 2499,
      });

      const cleared = await head.put('/settings/plan-prices', {
        prices: [{ plan: 'pro', monthlyPrice: null }],
      });
      expect(cleared.body.data[3]).toEqual({ plan: 'pro', monthlyPrice: null });
      await head.put('/settings/plan-prices', { prices: [{ plan: 'pro', monthlyPrice: 4999 }] });
    });

    it('keeps Free at ₹0 and refuses a plan priced twice or an unknown one', async () => {
      const free = await head.put('/settings/plan-prices', {
        prices: [{ plan: 'free', monthlyPrice: 99 }],
      });
      expect(free.status).toBe(400);
      expect(free.body.message).toBe('The Free plan is always ₹0.');
      const twice = await head.put('/settings/plan-prices', {
        prices: [
          { plan: 'pro', monthlyPrice: 1 },
          { plan: 'pro', monthlyPrice: 2 },
        ],
      });
      expect(twice.status).toBe(400);
      expect(
        (await head.put('/settings/plan-prices', { prices: [{ plan: 'gold', monthlyPrice: 1 }] }))
          .status,
      ).toBe(400);
    });
  });

  // ----------------------------------------------------------------- offers

  describe('offers', () => {
    it('lets only the sales head add, edit and remove offers', async () => {
      const offer = { name: 'Test', discountType: 'percent', discountValue: 5 };
      expect((await ravi.post('/offers', offer)).status).toBe(403);
      expect((await manager.post('/offers', offer)).status).toBe(403);

      const res = await head.post('/offers', {
        name: ' Diwali offer ',
        couponCode: ' diwali10 ',
        discountType: 'percent',
        discountValue: 10,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        name: 'Diwali offer',
        couponCode: 'DIWALI10',
        discountType: 'percent',
        discountValue: 10,
        startsOn: null,
        endsOn: null,
        active: true,
      });
      ids.diwali = res.body.data.id;

      expect((await ravi.patch(`/offers/${ids.diwali}`, { name: 'X' })).status).toBe(403);
      expect((await manager.delete(`/offers/${ids.diwali}`)).status).toBe(403);
    });

    it('refuses a bad discount or dates', async () => {
      for (const body of [
        { name: 'Zero', discountType: 'percent', discountValue: 0 },
        { name: 'Too much', discountType: 'percent', discountValue: 120 },
        { name: 'Paise', discountType: 'amount', discountValue: 10.5 },
        {
          name: 'Backwards',
          discountType: 'amount',
          discountValue: 100,
          startsOn: today,
          endsOn: '2020-01-01',
        },
        { name: 'Spaces', discountType: 'amount', discountValue: 100, couponCode: 'TWO WORDS' },
      ]) {
        const res = await head.post('/offers', body);
        expect(res.status).toBe(400);
      }
    });

    it('shows reps and managers only the offers live today; the sales head sees all', async () => {
      const ended = await head.post('/offers', {
        name: 'Monsoon',
        discountType: 'amount',
        discountValue: 500,
      });
      ids.monsoon = ended.body.data.id;
      expect((await head.patch(`/offers/${ids.monsoon}`, { active: false })).body.data.active).toBe(
        false,
      );
      const later = await head.post('/offers', {
        name: 'New year',
        discountType: 'percent',
        discountValue: 15,
        startsOn: '2099-01-01',
      });
      ids.later = later.body.data.id;
      const removed = await head.post('/offers', {
        name: 'Gone',
        discountType: 'percent',
        discountValue: 5,
      });
      expect((await head.delete(`/offers/${removed.body.data.id}`)).status).toBe(200);
      expect((await head.patch(`/offers/${removed.body.data.id}`, { name: 'Back' })).status).toBe(
        404,
      );

      const names = async (client: ApiClient, query = '') =>
        ((await client.get(`/offers${query}`)).body.data as any[]).map((o) => o.name);
      expect(await names(ravi)).toEqual(['Diwali offer']);
      expect(await names(manager, '?active=true')).toEqual(['Diwali offer']);
      expect(await names(head, '?active=true')).toEqual(['Diwali offer']);
      expect((await names(head)).sort()).toEqual(['Diwali offer', 'Monsoon', 'New year']);
    });
  });

  // ------------------------------------------------------------- won deals

  describe('a won deal', () => {
    it('takes a plan, tenure, price and an offer, and works out what the client pays', async () => {
      const lead = (await addLead(ravi)).body.data;
      const res = await win(lead.id, {
        planCode: 'growth',
        dealTenureMonths: 6,
        dealValue: 2499,
        offerId: ids.diwali,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.lead).toMatchObject({
        status: 'converted',
        planCode: 'growth',
        plan: null,
        dealTenureMonths: 6,
        dealValue: 2499,
        discountType: 'percent',
        discountValue: 10,
        couponCode: 'DIWALI10',
        offer: { id: ids.diwali, name: 'Diwali offer' },
        dealTotal: 13494,
        effectiveMonthlyValue: 2249,
      });
      ids.offerLead = lead.id;
    });

    it('takes a typed ₹ discount with a coupon on a stage change, from a multipart form', async () => {
      const lead = (await addLead(ravi)).body.data;
      const res = await ravi.post(`/leads/${lead.id}/status`, {
        status: 'converted',
        note: 'Won on the phone.',
        clientRequestId: requestId(),
        planCode: 'pro',
        dealTenureMonths: 3,
        dealValue: 1000,
        discountType: 'amount',
        discountValue: 500,
        couponCode: 'shop500',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.lead).toMatchObject({
        offer: null,
        discountType: 'amount',
        discountValue: 500,
        couponCode: 'SHOP500',
        dealTotal: 2500,
        effectiveMonthlyValue: 833.33,
      });

      const form = (await addLead(ravi)).body.data;
      const multipart = await ravi.postForm(`/leads/${form.id}/follow-ups`, {
        status: 'converted',
        note: 'Signed at the shop.',
        location: 'Kondhwa',
        clientRequestId: requestId(),
        planCode: 'growth_plus',
        dealTenureMonths: '12',
        dealValue: '3499',
        discountType: 'percent',
        discountValue: '12.5',
        couponCode: '',
        offerId: '',
      });
      expect(multipart.status).toBe(201);
      expect(multipart.body.data.lead).toMatchObject({
        dealTenureMonths: 12,
        discountValue: 12.5,
        couponCode: null,
        // ₹3,499 × 12 = ₹41,988, less 12.5% = ₹36,739.50, rounded down.
        dealTotal: 36739,
        effectiveMonthlyValue: 3061.58,
      });
    });

    it('makes Free cost nothing, with no tenure or discount', async () => {
      const lead = (await addLead(ravi)).body.data;
      const res = await win(lead.id, { planCode: 'free' });
      expect(res.body.data.lead).toMatchObject({
        planCode: 'free',
        dealValue: 0,
        dealTenureMonths: null,
        dealTotal: 0,
        effectiveMonthlyValue: 0,
      });
      const other = (await addLead(ravi)).body.data;
      const refused = await win(other.id, { planCode: 'free', dealTenureMonths: 3 });
      expect(refused.status).toBe(400);
      expect(refused.body.message).toBe('The Free plan has no price, tenure or discount.');
    });

    it.each([
      ['a percent over 100', { dealValue: 1000, discountType: 'percent', discountValue: 101 }, 400],
      [
        '₹ off more than the deal total',
        { dealValue: 1000, dealTenureMonths: 3, discountType: 'amount', discountValue: 3001 },
        400,
      ],
      ['a discount with no price', { discountType: 'percent', discountValue: 5 }, 400],
      ['half a discount', { dealValue: 1000, discountType: 'amount' }, 400],
      ['an offer and a typed discount', { dealValue: 1000, offerId: 'x', discountValue: 5 }, 400],
      ['a tenure of 2 months', { dealValue: 1000, dealTenureMonths: 2 }, 400],
      ['a coupon with no discount', { dealValue: 1000, couponCode: 'SAVE' }, 400],
    ])('refuses %s', async (_, fields, status) => {
      const lead = (await addLead(ravi)).body.data;
      const res = await win(lead.id, fields);
      expect(res.status).toBe(status);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    });

    it('refuses an offer that has ended or not started, but keeps it on a deal already won with it', async () => {
      const lead = (await addLead(ravi)).body.data;
      for (const offerId of [ids.monsoon, ids.later]) {
        const res = await win(lead.id, { dealValue: 2499, offerId });
        expect(res.status).toBe(422);
        expect(res.body.message).toBe(
          'This offer has ended. Pick another offer or type the discount.',
        );
      }

      // The sales head changes, then ends, the offer a deal was won on.
      await head.patch(`/offers/${ids.diwali}`, { discountValue: 50 });
      await head.patch(`/offers/${ids.diwali}`, { active: false });
      const kept = await ravi.get(`/leads/${ids.offerLead}`);
      expect(kept.body.data).toMatchObject({ discountValue: 10, dealTotal: 13494 });

      // Re-saving that deal as it is still works and keeps the 10% it was won on.
      const again = await ravi.patch(`/leads/${ids.offerLead}`, {
        planCode: 'growth',
        dealTenureMonths: 6,
        dealValue: 2499,
        offerId: ids.diwali,
      });
      expect(again.status).toBe(200);
      expect(again.body.data).toMatchObject({ discountValue: 10, dealTotal: 13494 });
      await head.patch(`/offers/${ids.diwali}`, { active: true, discountValue: 10 });
    });

    it('takes the expected deal on a new lead at any stage, and refuses one on a non-won entry', async () => {
      const res = await addLead(ravi, {
        status: 'interested',
        planCode: 'growth',
        dealTenureMonths: 3,
        dealValue: 2499,
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ planCode: 'growth', dealTotal: 7497 });
      const refused = await ravi.post(`/leads/${res.body.data.id}/follow-ups`, {
        status: 'interested',
        note: 'Still thinking.',
        location: 'Kondhwa',
        clientRequestId: requestId(),
        planCode: 'pro',
      });
      expect(refused.status).toBe(400);
      expect(refused.body.message).toBe('Deal details can be added only when the lead is Won.');
    });

    it('clears the whole deal on Edit lead when every field is null', async () => {
      const lead = (await addLead(ravi, { planCode: 'pro', dealValue: 4999 })).body.data;
      const res = await ravi.patch(`/leads/${lead.id}`, {
        planCode: null,
        dealValue: null,
        dealTenureMonths: null,
      });
      expect(res.body.data).toMatchObject({ planCode: null, dealValue: null, dealTotal: null });
    });
  });

  // ---------------------------------------------------------------- revenue

  describe('won revenue', () => {
    // An old deal: ₹1,499 a month, no tenure or discount — it must count as before.
    beforeAll(async () => {
      const lead = (await addLead(ravi)).body.data;
      await win(lead.id, { dealValue: 1499 });
      await harness.db.query(`UPDATE sales.leads SET plan = 'Annual Gold' WHERE id = $1`, [
        lead.id,
      ]);
    });

    // 2249 (Diwali, 6 months) + 2500/3 (₹500 off 3 months) + 36739/12 (12.5% off 12 months)
    // + 0 (Free) + 1499 (old deal) = 7642.9166…, summed exactly and then rounded to paise.
    const REVENUE = 7642.92;

    it('sums the effective monthly value on the home screen and the dashboard', async () => {
      const home = await ravi.get('/me/home');
      expect(home.body.data).toMatchObject({ conversionsThisMonth: 5, revenueThisMonth: REVENUE });

      const dash = await head.get(`/dashboard?from=${today}&to=${today}&projectId=${projectId}`);
      expect(dash.status).toBe(200);
      expect(dash.body.data).toMatchObject({ conversions: 5, revenue: REVENUE });
      const row = dash.body.data.people.find((p: any) => p.user.id === ids.ravi);
      expect(row).toMatchObject({ conversions: 5, revenue: REVENUE });
      expect(dash.body.data.trend.at(-1)).toMatchObject({ date: today, revenue: REVENUE });
    });

    it('counts the same revenue after discount in the scorecard and the rep review', async () => {
      const card = await head.get(
        `/reports/scorecard?from=${today}&to=${today}&projectId=${projectId}`,
      );
      expect(card.status).toBe(200);
      const row = card.body.data.rows.find((r: any) => r.user.id === ids.ravi);
      expect(row).toMatchObject({ dealsWon: 5, wonRevenue: REVENUE });

      const review = await head.get(`/reports/people/${ids.ravi}/review?from=${today}&to=${today}`);
      expect(review.status).toBe(200);
      const plans = Object.fromEntries(review.body.data.planMix.map((p: any) => [p.plan, p]));
      // The Frostique plan names, and the old free-text plan for the deal saved before plans.
      expect(Object.keys(plans)).toEqual(expect.arrayContaining(['Free', 'Annual Gold']));
      const total = review.body.data.planMix.reduce((sum: number, p: any) => sum + p.revenue, 0);
      expect(total).toBeCloseTo(REVENUE, 1);
    });

    it('exports plan, tenure, monthly price, discount, coupon and deal total', async () => {
      const res = await head.get(`/exports/leads?from=${today}&to=${today}&projectId=${projectId}`);
      expect(res.status).toBe(200);
      const [header, ...rows] = res.text
        .replace(/^\uFEFF/u, '')
        .trim()
        .split('\r\n');
      const columns = header.split(',');
      const at = (name: string) => columns.indexOf(name);
      expect(columns.slice(at('Plan'), at('Lead source'))).toEqual([
        'Plan',
        'Tenure (months)',
        'Monthly price (₹)',
        'Discount',
        'Coupon',
        'Deal total (₹)',
        'Monthly revenue after discount (₹)',
      ]);
      const deal = (row: string) => row.split(',').slice(at('Plan'), at('Lead source')).join(',');
      expect(rows.map(deal)).toEqual(
        expect.arrayContaining([
          'Growth,6,2499,10% off (Diwali offer),DIWALI10,13494,2249',
          'Pro,3,1000,₹500 off,SHOP500,2500,833.33',
          'Growth Plus,12,3499,12.5% off,,36739,3061.58',
          'Free,,0,,,0,0',
          'Annual Gold,1,1499,,,1499,1499',
        ]),
      );
    });
  });
});
