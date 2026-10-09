import { TargetPeriod } from '../enums';
import {
  addDays,
  daysBetween,
  formatIstDateTime,
  isSameIstDay,
  isValidIsoDate,
  istDateOf,
  istDateSpan,
  istDayRange,
  istMonthRange,
  istWeekRange,
  targetPeriodRange,
} from './ist-time.util';

/** An instant given as India wall-clock time. */
const ist = (wallClock: string): Date => new Date(`${wallClock}+05:30`);

describe('IST calendar (PRD §3: "Today" is India time)', () => {
  it('puts 00:30 IST on the new day although UTC is still on the old one', () => {
    const halfPastMidnight = ist('2026-10-09T00:30:00');
    expect(halfPastMidnight.toISOString().slice(0, 10)).toBe('2026-10-08');
    expect(istDateOf(halfPastMidnight)).toBe('2026-10-09');
  });

  it('locks at midnight IST, not 24 hours later (PRD §5.11)', () => {
    const loggedAt = ist('2026-10-08T23:58:00');
    expect(isSameIstDay(loggedAt, ist('2026-10-08T23:59:59'))).toBe(true);
    expect(isSameIstDay(loggedAt, ist('2026-10-09T00:00:00'))).toBe(false);
  });

  it('maps one IST day to the right instants', () => {
    const { start, end } = istDayRange('2026-10-08');
    expect(start.toISOString()).toBe('2026-10-07T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-08T18:30:00.000Z');
  });

  it('spans inclusive date ranges', () => {
    const { start, end } = istDateSpan('2026-10-01', '2026-10-01');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('weeks and months (BRD §7)', () => {
  it('runs weeks Monday 00:00 to Sunday 23:59 IST', () => {
    // Thursday 8 October 2026.
    const week = istWeekRange(ist('2026-10-08T12:00:00'));
    expect(week.start).toEqual(ist('2026-10-05T00:00:00'));
    expect(week.end).toEqual(ist('2026-10-12T00:00:00'));
  });

  it('counts Sunday 11:59 pm in the old week and Monday 12:00 am in the new one', () => {
    const sundayNight = ist('2026-10-11T23:59:00');
    const mondayMorning = ist('2026-10-12T00:00:00');
    expect(istWeekRange(sundayNight).start).toEqual(ist('2026-10-05T00:00:00'));
    expect(istWeekRange(mondayMorning).start).toEqual(ist('2026-10-12T00:00:00'));
  });

  it('treats a Sunday as the end of its week, not the start', () => {
    expect(istWeekRange(ist('2026-10-11T09:00:00')).start).toEqual(ist('2026-10-05T00:00:00'));
  });

  it('follows calendar months, including December into January', () => {
    const december = istMonthRange(ist('2026-12-31T23:59:00'));
    expect(december.start).toEqual(ist('2026-12-01T00:00:00'));
    expect(december.end).toEqual(ist('2027-01-01T00:00:00'));
    expect(istMonthRange(ist('2027-01-01T00:00:00')).start).toEqual(ist('2027-01-01T00:00:00'));
  });

  it('picks the target period window', () => {
    const at = ist('2026-10-08T12:00:00');
    expect(targetPeriodRange(TargetPeriod.WEEKLY, at)).toEqual(istWeekRange(at));
    expect(targetPeriodRange(TargetPeriod.MONTHLY, at)).toEqual(istMonthRange(at));
  });
});

describe('date helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-10-08T00:00:00Z')).toBe(false);
  });

  it('does day arithmetic across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-01', '2026-12-31')).toBe(91);
  });

  it('formats IST for exports', () => {
    expect(formatIstDateTime(ist('2026-10-08T15:42:10'))).toBe('2026-10-08 15:42');
    expect(formatIstDateTime(null)).toBe('');
  });
});
