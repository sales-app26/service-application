import { AttentionKind, TrendBucket } from '../../common/enums';
import { istDateSpan } from '../../common/utils';
import {
  attentionSeverity,
  buildTrend,
  idleDays,
  isBehindTarget,
  rankAttention,
  targetPace,
  TrendCounts,
} from './report-rules';

/** An instant given as India wall-clock time. */
const ist = (wallClock: string): Date => new Date(`${wallClock}+05:30`);

describe('buildTrend', () => {
  it('lists every day of a short range, quiet days as zeros', () => {
    const byDay = new Map<string, Partial<TrendCounts>>([
      ['2026-10-06', { followUps: 3, conversions: 1, revenue: 1499 }],
      ['2026-10-08', { newLeads: 2 }],
    ]);
    const { bucket, points } = buildTrend('2026-10-05', '2026-10-08', byDay);

    expect(bucket).toBe(TrendBucket.DAY);
    expect(points).toEqual([
      { date: '2026-10-05', followUps: 0, newLeads: 0, conversions: 0, revenue: 0 },
      { date: '2026-10-06', followUps: 3, newLeads: 0, conversions: 1, revenue: 1499 },
      { date: '2026-10-07', followUps: 0, newLeads: 0, conversions: 0, revenue: 0 },
      { date: '2026-10-08', followUps: 0, newLeads: 2, conversions: 0, revenue: 0 },
    ]);
  });

  it('keeps 92 days daily and sums anything longer into Monday weeks', () => {
    expect(buildTrend('2026-07-01', '2026-09-30', new Map()).points).toHaveLength(92);

    // Thursday 1 October 2026 to Sunday 31 January 2027: 123 days.
    const byDay = new Map<string, Partial<TrendCounts>>([
      ['2026-10-01', { followUps: 1 }],
      ['2026-10-04', { followUps: 2 }], // Sunday: same week as the 1st
      ['2026-10-05', { followUps: 4, revenue: 999 }], // Monday: the next one
    ]);
    const { bucket, points } = buildTrend('2026-10-01', '2027-01-31', byDay);

    expect(bucket).toBe(TrendBucket.WEEK);
    // The first week is labelled with the range's first day, the rest with their Monday.
    expect(points[0]).toEqual({
      date: '2026-10-01',
      followUps: 3,
      newLeads: 0,
      conversions: 0,
      revenue: 0,
    });
    expect(points[1]).toMatchObject({ date: '2026-10-05', followUps: 4, revenue: 999 });
    expect(points.at(-1)?.date).toBe('2027-01-25');
    expect(points).toHaveLength(18);
  });

  it('stays within the dashboard’s year at 53 points', () => {
    expect(buildTrend('2027-01-01', '2027-12-31', new Map()).points.length).toBeLessThanOrEqual(53);
  });
});

describe('targetPace', () => {
  const week = istDateSpan('2026-10-05', '2026-10-11');
  const target = (achieved: number, targetCount: number | null = 10) => ({
    targetCount,
    achieved,
    periodStart: week.start,
    periodEnd: week.end,
  });

  it('compares conversions with the share of the period gone', () => {
    // Thursday 00:00: three of seven days gone.
    const pace = targetPace(target(1), ist('2026-10-08T00:00:00'));
    expect(pace).toEqual({ elapsedPercent: 43, gapPoints: 33 });
    expect(isBehindTarget(pace)).toBe(true);
  });

  it('is not behind within 20 points, or once the target is met', () => {
    const thursday = ist('2026-10-08T00:00:00');
    expect(isBehindTarget(targetPace(target(3), thursday))).toBe(false); // 43 vs 30
    expect(isBehindTarget(targetPace(target(14), ist('2026-10-11T23:00:00')))).toBe(false);
  });

  it('nobody is behind at the start of the period, and no target means no pace', () => {
    expect(targetPace(target(0), week.start)).toEqual({ elapsedPercent: 0, gapPoints: 0 });
    expect(targetPace(target(0, null), week.end)).toBeNull();
    expect(isBehindTarget(null)).toBe(false);
  });
});

describe('idleDays', () => {
  const now = ist('2026-10-08T10:00:00');

  it('counts India days since the last entry', () => {
    expect(idleDays(ist('2026-10-08T00:10:00'), ist('2026-09-01T10:00:00'), now)).toBe(0);
    // 23:50 the day before yesterday is two India days ago, though not 48 hours.
    expect(idleDays(ist('2026-10-06T23:50:00'), ist('2026-09-01T10:00:00'), now)).toBe(2);
  });

  it('counts from joining when nothing was ever logged', () => {
    expect(idleDays(null, ist('2026-10-07T18:00:00'), now)).toBe(1);
    expect(idleDays(null, ist('2026-10-01T18:00:00'), now)).toBe(7);
  });
});

describe('rankAttention', () => {
  const item = (kind: AttentionKind, name: string) => ({
    kind,
    user: { id: name, name },
    projectName: null,
    detail: '',
  });

  it('scores each kind against its own threshold', () => {
    expect(attentionSeverity(AttentionKind.OVERDUE_PILE, 10)).toBe(2);
    expect(attentionSeverity(AttentionKind.IDLE, 4)).toBe(2);
    expect(attentionSeverity(AttentionKind.STALE_TRANSFER, 36)).toBe(1.5);
    expect(attentionSeverity(AttentionKind.BEHIND_TARGET, 30)).toBe(1.5);
  });

  it('puts the most severe first, breaks ties by kind then name, and caps the list', () => {
    const ranked = rankAttention(
      [
        { severity: 1.2, item: item(AttentionKind.STALE_TRANSFER, 'Asha') },
        { severity: 2, item: item(AttentionKind.IDLE, 'Ravi') },
        { severity: 2, item: item(AttentionKind.OVERDUE_PILE, 'Priya') },
        { severity: 2, item: item(AttentionKind.OVERDUE_PILE, 'Karan') },
        { severity: 3, item: item(AttentionKind.BEHIND_TARGET, 'Meera') },
      ],
      4,
    );
    expect(ranked.map((r) => r.user?.name)).toEqual(['Meera', 'Karan', 'Priya', 'Ravi']);
  });

  it('ranks a help request above anything short of an extreme, older ones first', () => {
    const fresh = attentionSeverity(AttentionKind.HELP_REQUEST, 0);
    const dayOld = attentionSeverity(AttentionKind.HELP_REQUEST, 24);
    expect(fresh).toBe(10);
    expect(dayOld).toBe(11);
    // 45 overdue leads — nine times the threshold — still rank below a fresh request.
    expect(fresh).toBeGreaterThan(attentionSeverity(AttentionKind.OVERDUE_PILE, 45));

    const ranked = rankAttention([
      { severity: 3, item: item(AttentionKind.BEHIND_TARGET, 'Meera') },
      { severity: fresh, item: item(AttentionKind.HELP_REQUEST, 'Ravi') },
      { severity: dayOld, item: item(AttentionKind.HELP_REQUEST, 'Asha') },
    ]);
    expect(ranked.map((r) => r.user?.name)).toEqual(['Asha', 'Ravi', 'Meera']);
  });
});
