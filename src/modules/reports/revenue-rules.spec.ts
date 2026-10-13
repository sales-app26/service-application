import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';

import { DiscountType } from '../../common/enums';
import { readSqlFile, SQL_FILE } from '../../database/migrations/sql-file.helper';
import { dealMoney } from '../leads/deal-rules';
import { dealTotalSql, wonMonthlyRevenueSql } from './revenue-rules';

/**
 * The won-revenue SQL every report sums, checked against the same arithmetic
 * in TypeScript (`dealMoney`) on real PostgreSQL, over every kind of deal.
 */
describe('revenue-rules (SQL) agrees with dealMoney', () => {
  let db: PGlite;
  const seller = randomUUID();
  const project = randomUUID();
  const location = randomUUID();
  let phone = 9000000000;

  type Deal = {
    dealValue: number | null;
    dealTenureMonths: number | null;
    discountType: DiscountType | null;
    discountValue: number | null;
  };

  const DEALS: Deal[] = [
    { dealValue: null, dealTenureMonths: null, discountType: null, discountValue: null },
    // Saved before tenure and discounts existed: counts its monthly price.
    { dealValue: 1499, dealTenureMonths: null, discountType: null, discountValue: null },
    { dealValue: 0, dealTenureMonths: null, discountType: null, discountValue: null },
    { dealValue: 2499, dealTenureMonths: 6, discountType: null, discountValue: null },
    { dealValue: 2499, dealTenureMonths: 6, discountType: DiscountType.PERCENT, discountValue: 10 },
    {
      dealValue: 999,
      dealTenureMonths: 12,
      discountType: DiscountType.PERCENT,
      discountValue: 12.5,
    },
    { dealValue: 3, dealTenureMonths: 1, discountType: DiscountType.PERCENT, discountValue: 33.33 },
    {
      dealValue: 1000,
      dealTenureMonths: 3,
      discountType: DiscountType.PERCENT,
      discountValue: 100,
    },
    { dealValue: 1000, dealTenureMonths: 3, discountType: DiscountType.AMOUNT, discountValue: 500 },
    {
      dealValue: 1000,
      dealTenureMonths: 3,
      discountType: DiscountType.AMOUNT,
      discountValue: 3000,
    },
    {
      dealValue: 2000,
      dealTenureMonths: null,
      discountType: DiscountType.AMOUNT,
      discountValue: 499,
    },
    { dealValue: 4999, dealTenureMonths: 12, discountType: DiscountType.AMOUNT, discountValue: 7 },
  ];

  beforeAll(async () => {
    db = new PGlite();
    for (const file of [
      SQL_FILE.SALES_SCHEMA,
      SQL_FILE.USER_DELETION,
      SQL_FILE.SINGLE_USE_CAPTURE,
      SQL_FILE.SALES_INSIGHTS,
      SQL_FILE.TEAM_COLLABORATION,
      SQL_FILE.VISIT_PLACE,
      SQL_FILE.DEAL_TERMS,
    ]) {
      await db.exec(readSqlFile(file));
    }
    await db.query(
      `INSERT INTO sales.users (id, name, email, role) VALUES ($1, 'Seller', 'seller@x.in', 'sales_person')`,
      [seller],
    );
    await db.query(
      `INSERT INTO sales.projects (id, name, type, start_date, created_by) VALUES ($1, 'Pune', 'online', '2026-10-01', $2)`,
      [project, seller],
    );
    await db.query(
      `INSERT INTO sales.locations (id, project_id, name) VALUES ($1, $2, 'Wanowrie')`,
      [location, project],
    );
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it.each(DEALS.map((deal) => [JSON.stringify(deal), deal] as const))('%s', async (_, deal) => {
    const { rows } = await db.query<{ deal_total: number | null; monthly: number | null }>(
      `INSERT INTO sales.leads (project_id, owner_id, name, phone, location_id,
                                deal_value, deal_tenure_months, discount_type, discount_value)
       VALUES ($1, $2, 'Client', $3, $4, $5, $6, $7, $8)
       RETURNING ${dealTotalSql('leads')}::float8 AS deal_total,
                 round(${wonMonthlyRevenueSql('leads')}, 2)::float8 AS monthly`,
      [
        project,
        seller,
        String((phone += 1)),
        location,
        deal.dealValue,
        deal.dealTenureMonths,
        deal.discountType,
        deal.discountValue,
      ],
    );
    const money = dealMoney(deal);
    expect(rows[0]).toEqual({
      deal_total: money?.dealTotal ?? null,
      monthly: money?.effectiveMonthlyValue ?? null,
    });
  });

  it('sums to exactly the old figure for deals with no tenure or discount', async () => {
    const { rows } = await db.query<{ old: number; now: number }>(
      `SELECT coalesce(sum(l.deal_value), 0)::float8 AS old,
              round(coalesce(sum(${wonMonthlyRevenueSql('l')}), 0), 2)::float8 AS now
         FROM sales.leads l
        WHERE l.deal_tenure_months IS NULL AND l.discount_type IS NULL`,
    );
    expect(rows[0].now).toBe(rows[0].old);
  });
});
