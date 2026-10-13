/**
 * Won revenue in SQL — the ONE place every report, dashboard, leaderboard and
 * export reads deal money from. Same arithmetic as `leads/deal-rules.ts`
 * (`dealMoney`), and tested against it.
 *
 *  - `leads.deal_value` is the list price per month the rep entered.
 *  - Deal total = price × tenure − discount; a percent discount comes off the
 *    whole deal and the client's total is rounded down to a rupee.
 *  - Effective monthly value = deal total ÷ tenure. "Monthly revenue won" and
 *    every other revenue figure is the sum of this over the won leads.
 *  - No tenure reads as 1 month, no discount as none: deals saved before
 *    `08_deal_terms.sql` count exactly as they did.
 *
 * Each helper takes the alias the query gives `sales.leads` and returns an
 * expression that is NULL for a lead with no price (so `sum` skips it). Wrap
 * sums in `round(coalesce(sum(...), 0), 2)::float8`: rupees and paise, as a
 * number rather than numeric's string.
 *
 * @example
 *   `SELECT round(coalesce(sum(${wonMonthlyRevenueSql('l')}), 0), 2)::float8 AS revenue
 *      FROM sales.leads l WHERE l.converted_at >= $1 ...`
 */

/** Months the deal runs for: the stored tenure, else 1. */
export const dealTenureSql = (alias: string): string => `coalesce(${alias}.deal_tenure_months, 1)`;

/** What the client pays for the whole tenure, in rupees (numeric). */
export const dealTotalSql = (alias: string): string => {
  const list = `(${alias}.deal_value::numeric * ${dealTenureSql(alias)})`;
  return `(CASE ${alias}.discount_type
      WHEN 'percent' THEN floor(${list} * (100 - ${alias}.discount_value) / 100)
      WHEN 'amount' THEN greatest(${list} - ${alias}.discount_value, 0)
      ELSE ${list}
    END)`;
};

/**
 * The effective monthly value of one won deal: deal total ÷ tenure (numeric).
 * Sum this — never `deal_value` — for "Monthly revenue won", insights,
 * leaderboards, scorecards and exports.
 */
export const wonMonthlyRevenueSql = (alias: string): string =>
  `(${dealTotalSql(alias)} / ${dealTenureSql(alias)})`;
