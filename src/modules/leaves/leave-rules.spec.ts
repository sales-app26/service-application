import { LEAVE_ERROR } from '../../common/constants';
import { assertLeaveDates, leaveCovers, leavesOverlap } from './leave-rules';

const TODAY = '2026-10-13';

describe('assertLeaveDates', () => {
  it('accepts today, a later start, and the longest allowed span', () => {
    expect(() => assertLeaveDates({ startsOn: TODAY, endsOn: TODAY }, TODAY)).not.toThrow();
    expect(() =>
      assertLeaveDates({ startsOn: '2026-10-20', endsOn: '2026-12-19' }, TODAY),
    ).not.toThrow();
  });

  it('accepts a leave that started earlier while it still covers today', () => {
    expect(() =>
      assertLeaveDates({ startsOn: '2026-10-10', endsOn: '2026-10-14' }, TODAY),
    ).not.toThrow();
    expect(() => assertLeaveDates({ startsOn: '2026-10-10', endsOn: TODAY }, TODAY)).not.toThrow();
  });

  it('refuses a leave that is over before today', () => {
    expect(() => assertLeaveDates({ startsOn: '2026-10-10', endsOn: '2026-10-12' }, TODAY)).toThrow(
      LEAVE_ERROR.IN_PAST,
    );
  });

  it('refuses a last day before the first', () => {
    expect(() => assertLeaveDates({ startsOn: '2026-10-15', endsOn: '2026-10-14' }, TODAY)).toThrow(
      LEAVE_ERROR.END_BEFORE_START,
    );
  });

  it('refuses more than 60 days from the first day to the last', () => {
    expect(() => assertLeaveDates({ startsOn: '2026-10-20', endsOn: '2026-12-20' }, TODAY)).toThrow(
      LEAVE_ERROR.TOO_LONG,
    );
  });

  it('refuses a start more than a year ahead', () => {
    expect(() =>
      assertLeaveDates({ startsOn: '2027-10-13', endsOn: '2027-10-14' }, TODAY),
    ).not.toThrow();
    expect(() => assertLeaveDates({ startsOn: '2027-10-14', endsOn: '2027-10-15' }, TODAY)).toThrow(
      LEAVE_ERROR.TOO_FAR,
    );
  });
});

describe('leaveCovers', () => {
  const leave = { startsOn: '2026-10-13', endsOn: '2026-10-15' };

  it('includes both ends', () => {
    expect(leaveCovers(leave, '2026-10-13')).toBe(true);
    expect(leaveCovers(leave, '2026-10-15')).toBe(true);
    expect(leaveCovers(leave, '2026-10-12')).toBe(false);
    expect(leaveCovers(leave, '2026-10-16')).toBe(false);
  });
});

describe('leavesOverlap', () => {
  const leave = { startsOn: '2026-10-13', endsOn: '2026-10-15' };

  it('overlaps on a shared day, even only the last one', () => {
    expect(leavesOverlap(leave, { startsOn: '2026-10-15', endsOn: '2026-10-20' })).toBe(true);
    expect(leavesOverlap(leave, { startsOn: '2026-10-01', endsOn: '2026-10-13' })).toBe(true);
    expect(leavesOverlap(leave, { startsOn: '2026-10-14', endsOn: '2026-10-14' })).toBe(true);
  });

  it('does not overlap back-to-back leaves', () => {
    expect(leavesOverlap(leave, { startsOn: '2026-10-16', endsOn: '2026-10-20' })).toBe(false);
    expect(leavesOverlap(leave, { startsOn: '2026-10-01', endsOn: '2026-10-12' })).toBe(false);
  });
});
