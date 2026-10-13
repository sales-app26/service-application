import { BUSINESS_RULE } from '../../common/constants';
import { AttentionKind, TrendBucket } from '../../common/enums';
import { addDays, daysBetween, istDateOf, istMondayOf } from '../../common/utils';
import { AttentionItemDto, TrendPointDto } from './dto/report.dto';

/**
 * Dashboard arithmetic as pure functions — no database, no clock of their
 * own — so bucketing and "how bad is it" are unit-tested in isolation.
 */

export type TrendCounts = Omit<TrendPointDto, 'date'>;

const ZERO: TrendCounts = { followUps: 0, newLeads: 0, conversions: 0, revenue: 0 };

/**
 * Every day from `from` to `to` (India dates, inclusive) with its counts,
 * quiet days as zeros. Past `TREND_MAX_DAILY_POINTS` days the days are summed
 * into Monday–Sunday weeks, each labelled with its first day inside the range
 * — so the first point of a range starting on a Thursday is that Thursday.
 */
export const buildTrend = (
  from: string,
  to: string,
  byDay: ReadonlyMap<string, Partial<TrendCounts>>,
): { bucket: TrendBucket; points: TrendPointDto[] } => {
  const weekly = daysBetween(from, to) + 1 > BUSINESS_RULE.TREND_MAX_DAILY_POINTS;
  const points = new Map<string, TrendPointDto>();

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const monday = istMondayOf(date);
    const label = weekly ? (monday < from ? from : monday) : date;
    const point = points.get(label) ?? { date: label, ...ZERO };
    const day = byDay.get(date) ?? {};
    point.followUps += day.followUps ?? 0;
    point.newLeads += day.newLeads ?? 0;
    point.conversions += day.conversions ?? 0;
    point.revenue += day.revenue ?? 0;
    points.set(label, point);
  }

  return { bucket: weekly ? TrendBucket.WEEK : TrendBucket.DAY, points: [...points.values()] };
};

export interface TargetPace {
  /** Share of the period already gone, 0–100, rounded. */
  elapsedPercent: number;
  /** Elapsed share minus achieved share (capped at 100), in percentage points. */
  gapPoints: number;
}

/**
 * How far a target is behind the clock: by Wednesday noon 36% of the week is
 * gone, so 1 of 10 conversions (10%) is 26 points behind. Null without a
 * target. Nobody is behind before any of the period has passed.
 */
export const targetPace = (
  target: { targetCount: number | null; achieved: number; periodStart: Date; periodEnd: Date },
  now: Date,
): TargetPace | null => {
  if (!target.targetCount) return null;

  const length = target.periodEnd.getTime() - target.periodStart.getTime();
  const gone = Math.min(Math.max(now.getTime() - target.periodStart.getTime(), 0), length);
  const elapsed = (gone / length) * 100;
  const achieved = Math.min((target.achieved / target.targetCount) * 100, 100);

  return { elapsedPercent: Math.round(elapsed), gapPoints: Math.round(elapsed - achieved) };
};

/** TRUE when a target is more than `ATTENTION_BEHIND_TARGET_POINTS` behind the clock. */
export const isBehindTarget = (pace: TargetPace | null): pace is TargetPace =>
  pace !== null && pace.gapPoints > BUSINESS_RULE.ATTENTION_BEHIND_TARGET_POINTS;

/**
 * Whole India days since a person last logged anything, counting from the day
 * they joined if they never have. 0 = today, 1 = yesterday.
 */
export const idleDays = (lastEntryAt: Date | null, joinedAt: Date, now: Date): number =>
  daysBetween(istDateOf(lastEntryAt ?? joinedAt), istDateOf(now));

/** A flagged item with how many times over its threshold it is. */
export interface ScoredAttention {
  item: AttentionItemDto;
  severity: number;
}

const KIND_ORDER: readonly AttentionKind[] = [
  AttentionKind.HELP_REQUEST,
  AttentionKind.BEHIND_TARGET,
  AttentionKind.OVERDUE_PILE,
  AttentionKind.IDLE,
  AttentionKind.STALE_TRANSFER,
];

const HOURS_PER_DAY = 24;

/**
 * Severity is the measure divided by the threshold that flagged it — 10
 * overdue leads (threshold 5) and 4 idle days (threshold 2) are both "twice
 * as bad as the line" — so different kinds compare fairly.
 *
 * A help request has no threshold: someone is waiting on an answer. It starts
 * at `ATTENTION_HELP_BASE_SEVERITY` and climbs by one per day it has waited
 * (the measure is hours), so it ranks above everything short of an extreme.
 */
export const attentionSeverity = (kind: AttentionKind, measure: number): number => {
  if (kind === AttentionKind.HELP_REQUEST) {
    return BUSINESS_RULE.ATTENTION_HELP_BASE_SEVERITY + Math.max(measure, 0) / HOURS_PER_DAY;
  }
  const threshold = {
    [AttentionKind.BEHIND_TARGET]: BUSINESS_RULE.ATTENTION_BEHIND_TARGET_POINTS,
    [AttentionKind.OVERDUE_PILE]: BUSINESS_RULE.ATTENTION_OVERDUE_PILE,
    [AttentionKind.IDLE]: BUSINESS_RULE.ATTENTION_IDLE_DAYS,
    [AttentionKind.STALE_TRANSFER]: BUSINESS_RULE.ATTENTION_STALE_TRANSFER_HOURS,
  }[kind];
  return measure / threshold;
};

/** Most severe first, then by kind and name so the order is stable; capped. */
export const rankAttention = (
  scored: ScoredAttention[],
  limit: number = BUSINESS_RULE.ATTENTION_LIST_LIMIT,
): AttentionItemDto[] =>
  [...scored]
    .sort(
      (a, b) =>
        b.severity - a.severity ||
        KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
        (a.item.user?.name ?? '').localeCompare(b.item.user?.name ?? '') ||
        (a.item.projectName ?? '').localeCompare(b.item.projectName ?? ''),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
