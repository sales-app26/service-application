import { TargetPeriod, TrendBucket } from '../../common/enums';
import {
  conversionPercent,
  elapsedRange,
  mostCommon,
  periodTarget,
  reviewTrend,
  ScorecardNumbers,
  teamAverages,
  teamTotals,
  weekdayOf,
} from './scorecard-rules';

const row = (over: Partial<ScorecardNumbers> = {}): ScorecardNumbers => ({
  leadsAdded: 0,
  followUps: 0,
  visits: 0,
  activeDays: 0,
  workingDays: 0,
  leaveDays: 0,
  dealsWon: 0,
  wonRevenue: 0,
  lostLeads: 0,
  conversionPercent: null,
  avgDaysToWin: null,
  target: null,
  achieved: 0,
  targetPercent: null,
  overdueNow: 0,
  openNow: 0,
  handoversAsked: 0,
  handoversReceived: 0,
  ...over,
});

describe('conversionPercent', () => {
  it('is won ÷ (won + lost), rounded', () => {
    expect(conversionPercent(2, 1)).toBe(67);
    expect(conversionPercent(3, 0)).toBe(100);
    expect(conversionPercent(0, 4)).toBe(0);
  });

  it('is null when nothing was closed', () => {
    expect(conversionPercent(0, 0)).toBeNull();
  });
});

describe('elapsedRange', () => {
  it('stops at today for a period in progress', () => {
    expect(elapsedRange('2026-10-01', '2026-10-31', '2026-10-13')).toEqual({
      from: '2026-10-01',
      to: '2026-10-13',
      days: 13,
    });
  });

  it('keeps a past period whole, and is null for one still ahead', () => {
    expect(elapsedRange('2026-09-01', '2026-09-30', '2026-10-13')?.days).toBe(30);
    expect(elapsedRange('2026-11-01', '2026-11-30', '2026-10-13')).toBeNull();
  });
});

describe('periodTarget', () => {
  it('counts a monthly target once per calendar month', () => {
    expect(periodTarget(10, TargetPeriod.MONTHLY, '2026-10-01', '2026-10-31')).toBe(10);
    expect(periodTarget(10, TargetPeriod.MONTHLY, '2026-10-01', '2026-12-31')).toBe(30);
  });

  it('counts part of a month by its share of days', () => {
    // 15 of October's 31 days.
    expect(periodTarget(10, TargetPeriod.MONTHLY, '2026-10-01', '2026-10-15')).toBe(5);
    // 16–30 September (15 of 30) plus all of October.
    expect(periodTarget(10, TargetPeriod.MONTHLY, '2026-09-16', '2026-10-31')).toBe(15);
  });

  it('counts a weekly target per 7 days', () => {
    expect(periodTarget(5, TargetPeriod.WEEKLY, '2026-10-05', '2026-10-11')).toBe(5);
    expect(periodTarget(5, TargetPeriod.WEEKLY, '2026-10-01', '2026-10-31')).toBe(22);
  });

  it('is at least 1 with a target, and null without one', () => {
    expect(periodTarget(1, TargetPeriod.MONTHLY, '2026-10-01', '2026-10-01')).toBe(1);
    expect(periodTarget(null, null, '2026-10-01', '2026-10-31')).toBeNull();
    expect(periodTarget(0, TargetPeriod.WEEKLY, '2026-10-01', '2026-10-31')).toBeNull();
  });
});

describe('mostCommon', () => {
  it('picks the top count, ties alphabetically', () => {
    expect(
      mostCommon(
        new Map([
          ['price', 2],
          ['competitor', 2],
          ['other', 1],
        ]),
      ),
    ).toBe('competitor');
    expect(mostCommon(new Map())).toBeNull();
  });
});

describe('team totals and averages', () => {
  const rows = [
    row({
      followUps: 10,
      dealsWon: 3,
      lostLeads: 1,
      conversionPercent: 75,
      avgDaysToWin: 4,
      target: 4,
      achieved: 3,
      targetPercent: 75,
      wonRevenue: 3000,
    }),
    row({
      followUps: 5,
      dealsWon: 1,
      lostLeads: 3,
      conversionPercent: 25,
      avgDaysToWin: 8,
      wonRevenue: 999,
    }),
    row({ followUps: 0 }),
  ];

  it('totals add counts and work percentages out from the sums', () => {
    const total = teamTotals(rows);
    expect(total).toMatchObject({
      followUps: 15,
      dealsWon: 4,
      lostLeads: 4,
      wonRevenue: 3999,
      conversionPercent: 50,
      // (4 × 3 + 8 × 1) ÷ 4 wins
      avgDaysToWin: 5,
      target: 4,
      targetPercent: 75,
    });
  });

  it('averages divide counts by every rep and percentages by the reps that have one', () => {
    const average = teamAverages(rows)!;
    expect(average).toMatchObject({
      followUps: 5,
      dealsWon: 1.3,
      conversionPercent: 50,
      avgDaysToWin: 6,
      target: 4,
      targetPercent: 75,
    });
    expect(teamAverages([])).toBeNull();
  });
});

describe('reviewTrend', () => {
  it('is daily up to 31 days', () => {
    const { bucket, points } = reviewTrend(
      '2026-10-01',
      '2026-10-03',
      new Map([['2026-10-02', { followUps: 2, visits: 1, wins: 1 }]]),
    );
    expect(bucket).toBe(TrendBucket.DAY);
    expect(points).toEqual([
      { date: '2026-10-01', followUps: 0, visits: 0, newLeads: 0, wins: 0 },
      { date: '2026-10-02', followUps: 2, visits: 1, newLeads: 0, wins: 1 },
      { date: '2026-10-03', followUps: 0, visits: 0, newLeads: 0, wins: 0 },
    ]);
  });

  it('is weekly past 31 days, the first week labelled with the first day', () => {
    const { bucket, points } = reviewTrend(
      '2026-10-01',
      '2026-11-05',
      new Map([
        ['2026-10-01', { followUps: 1 }],
        ['2026-10-04', { followUps: 2 }],
        ['2026-10-05', { newLeads: 3 }],
      ]),
    );
    expect(bucket).toBe(TrendBucket.WEEK);
    expect(points[0]).toEqual({
      date: '2026-10-01',
      followUps: 3,
      visits: 0,
      newLeads: 0,
      wins: 0,
    });
    expect(points[1]).toMatchObject({ date: '2026-10-05', newLeads: 3 });
    expect(points.at(-1)?.date).toBe('2026-11-02');
  });
});

describe('weekdayOf', () => {
  it('is Monday 0 to Sunday 6', () => {
    expect(weekdayOf('2026-10-12')).toBe(0);
    expect(weekdayOf('2026-10-18')).toBe(6);
  });
});
