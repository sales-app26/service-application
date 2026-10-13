import { TargetPeriod, TrendBucket } from '../../common/enums';
import { addDays, daysBetween, istMondayOf } from '../../common/utils';

/**
 * Scorecard and rep-review arithmetic as pure functions — no database, no
 * clock of their own — so the definitions a sales head reads on screen are
 * unit-tested in one place (`scorecard-rules.spec.ts`).
 */

/** A rep review's trend is daily up to this many days, weekly beyond. */
export const REVIEW_DAILY_MAX_DAYS = 31;

/** The numbers every scorecard row, team total and team average carries. */
export interface ScorecardNumbers {
  leadsAdded: number;
  followUps: number;
  visits: number;
  activeDays: number;
  workingDays: number;
  leaveDays: number;
  dealsWon: number;
  wonRevenue: number;
  lostLeads: number;
  conversionPercent: number | null;
  avgDaysToWin: number | null;
  target: number | null;
  achieved: number;
  targetPercent: number | null;
  overdueNow: number;
  openNow: number;
  handoversAsked: number;
  handoversReceived: number;
}

/** What a count over a set of rows adds up — every plain count. */
const SUMMED: ReadonlyArray<keyof ScorecardNumbers> = [
  'leadsAdded',
  'followUps',
  'visits',
  'activeDays',
  'workingDays',
  'leaveDays',
  'dealsWon',
  'wonRevenue',
  'lostLeads',
  'achieved',
  'overdueNow',
  'openNow',
  'handoversAsked',
  'handoversReceived',
];

/** Rounded to one decimal place. */
export const oneDecimal = (n: number): number => Math.round(n * 10) / 10;

/** `part / whole` as a whole percentage, or null when there is nothing to divide by. */
export const percentOf = (part: number, whole: number | null): number | null =>
  whole ? Math.round((part / whole) * 100) : null;

/**
 * Conversion %: of the leads a rep closed in the period, the share won —
 * deals won ÷ (deals won + leads marked Not interested or Lost). Null when
 * nothing was closed, so a quiet rep reads "—", not 0%.
 */
export const conversionPercent = (won: number, lost: number): number | null =>
  percentOf(won, won + lost);

/**
 * The part of `from`–`to` that has happened: up to today. Null when the whole
 * period is still ahead. Working and active days are counted only here, so a
 * month in progress is not marked down for days that have not come yet.
 */
export const elapsedRange = (
  from: string,
  to: string,
  today: string,
): { from: string; to: string; days: number } | null => {
  const end = to < today ? to : today;
  if (end < from) return null;
  return { from, to: end, days: daysBetween(from, end) + 1 };
};

/** Days in the calendar month of `date`. */
const daysInMonth = (date: string): number => {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

/**
 * A campaign target scaled to the chosen dates. A monthly target counts in
 * full for each whole calendar month and by share of days for part of one; a
 * weekly target counts once per 7 days. "This month" with a monthly target of
 * 10 is 10; "This quarter" is 30; a weekly target of 5 over a 31-day month is
 * 22. Rounded to whole deals, at least 1 when there is a target at all.
 */
export const periodTarget = (
  count: number | null,
  period: TargetPeriod | null,
  from: string,
  to: string,
): number | null => {
  if (!count || !period || to < from) return null;
  let exact: number;
  if (period === TargetPeriod.WEEKLY) {
    exact = (count * (daysBetween(from, to) + 1)) / 7;
  } else {
    exact = 0;
    let cursor = from;
    while (cursor <= to) {
      const length = daysInMonth(cursor);
      const monthEnd = `${cursor.slice(0, 8)}${String(length).padStart(2, '0')}`;
      const end = monthEnd < to ? monthEnd : to;
      exact += (count * (daysBetween(cursor, end) + 1)) / length;
      cursor = addDays(end, 1);
    }
  }
  return Math.max(1, Math.round(exact));
};

/** The most common key, ties broken alphabetically; null for an empty map. */
export const mostCommon = <K extends string>(counts: ReadonlyMap<K, number>): K | null => {
  let best: K | null = null;
  for (const [key, count] of counts) {
    const top = best === null ? -1 : (counts.get(best) ?? 0);
    if (count > top || (count === top && best !== null && key < best)) best = key;
  }
  return best;
};

/**
 * Team totals: counts added up; conversion and target percentages worked out
 * from those sums (the team's own rate, not an average of rates); average
 * days to win weighted by each rep's wins.
 */
export const teamTotals = (rows: ScorecardNumbers[]): ScorecardNumbers => {
  const total = Object.fromEntries(
    SUMMED.map((key) => [key, rows.reduce((sum, row) => sum + ((row[key] as number) ?? 0), 0)]),
  ) as unknown as ScorecardNumbers;

  const targeted = rows.filter((row) => row.target !== null);
  const target = targeted.reduce((sum, row) => sum + (row.target ?? 0), 0);
  const achievedOnTarget = targeted.reduce((sum, row) => sum + row.achieved, 0);
  const timed = rows.filter((row) => row.avgDaysToWin !== null);
  const wins = timed.reduce((sum, row) => sum + row.dealsWon, 0);

  return {
    ...total,
    conversionPercent: conversionPercent(total.dealsWon, total.lostLeads),
    avgDaysToWin: wins
      ? oneDecimal(timed.reduce((sum, row) => sum + row.avgDaysToWin! * row.dealsWon, 0) / wins)
      : null,
    target: targeted.length ? target : null,
    targetPercent: targeted.length ? percentOf(achievedOnTarget, target) : null,
  };
};

/**
 * The average sales rep on the list: each count divided by the number of
 * reps, to one decimal; each percentage and "days to win" averaged over the
 * reps that have one. Null for an empty team.
 */
export const teamAverages = (rows: ScorecardNumbers[]): ScorecardNumbers | null => {
  if (rows.length === 0) return null;
  const mean = (values: number[]): number | null =>
    values.length ? oneDecimal(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const present = (key: keyof ScorecardNumbers): number[] =>
    rows.map((row) => row[key]).filter((value): value is number => value !== null);

  const averaged = Object.fromEntries(
    SUMMED.map((key) => [key, mean(rows.map((row) => row[key] as number)) ?? 0]),
  ) as unknown as ScorecardNumbers;

  const percentMean = (key: keyof ScorecardNumbers): number | null => {
    const value = mean(present(key));
    return value === null ? null : Math.round(value);
  };

  return {
    ...averaged,
    conversionPercent: percentMean('conversionPercent'),
    avgDaysToWin: mean(present('avgDaysToWin')),
    target: mean(present('target')),
    targetPercent: percentMean('targetPercent'),
  };
};

export interface ReviewTrendCounts {
  followUps: number;
  visits: number;
  newLeads: number;
  wins: number;
}

export interface ReviewTrendPoint extends ReviewTrendCounts {
  date: string;
}

const ZERO: ReviewTrendCounts = { followUps: 0, newLeads: 0, visits: 0, wins: 0 };

/**
 * Every day from `from` to `to` with its counts, quiet days as zeros; past
 * `REVIEW_DAILY_MAX_DAYS` days, Monday–Sunday weeks, each labelled with its
 * first day inside the range (as the dashboard trend does).
 */
export const reviewTrend = (
  from: string,
  to: string,
  byDay: ReadonlyMap<string, Partial<ReviewTrendCounts>>,
): { bucket: TrendBucket; points: ReviewTrendPoint[] } => {
  const weekly = daysBetween(from, to) + 1 > REVIEW_DAILY_MAX_DAYS;
  const points = new Map<string, ReviewTrendPoint>();

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const monday = istMondayOf(date);
    const label = weekly ? (monday < from ? from : monday) : date;
    const point = points.get(label) ?? { date: label, ...ZERO };
    const day = byDay.get(date) ?? {};
    point.followUps += day.followUps ?? 0;
    point.visits += day.visits ?? 0;
    point.newLeads += day.newLeads ?? 0;
    point.wins += day.wins ?? 0;
    points.set(label, point);
  }

  return { bucket: weekly ? TrendBucket.WEEK : TrendBucket.DAY, points: [...points.values()] };
};

/** Monday = 0 … Sunday = 6, for an India calendar date. */
export const weekdayOf = (date: string): number =>
  (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
