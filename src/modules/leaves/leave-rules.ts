import { BUSINESS_RULE, ERROR_CODE, LEAVE_ERROR } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { daysBetween } from '../../common/utils';

/**
 * Leave dates as pure functions — no database, no clock of their own — so the
 * rules are unit-tested in isolation. Dates are India calendar days,
 * `YYYY-MM-DD`, both ends included.
 */

export interface LeaveSpan {
  startsOn: string;
  endsOn: string;
}

/**
 * A leave the API will save:
 *
 *  - the last day on or after the first;
 *  - at most `LEAVE_MAX_SPAN_DAYS` from the first day to the last
 *    (`user_leaves_span_max`);
 *  - not over before today — one that started earlier is fine while it still
 *    covers today (someone off sick since yesterday);
 *  - starting at most `LEAVE_MAX_DAYS_AHEAD` days from today.
 */
export const assertLeaveDates = (span: LeaveSpan, today: string): void => {
  if (span.endsOn < span.startsOn) {
    throw new BusinessException(LEAVE_ERROR.END_BEFORE_START, ERROR_CODE.VALIDATION_FAILED);
  }
  if (daysBetween(span.startsOn, span.endsOn) > BUSINESS_RULE.LEAVE_MAX_SPAN_DAYS) {
    throw new BusinessException(LEAVE_ERROR.TOO_LONG, ERROR_CODE.VALIDATION_FAILED);
  }
  if (span.endsOn < today) {
    throw new BusinessException(LEAVE_ERROR.IN_PAST, ERROR_CODE.VALIDATION_FAILED);
  }
  if (daysBetween(today, span.startsOn) > BUSINESS_RULE.LEAVE_MAX_DAYS_AHEAD) {
    throw new BusinessException(LEAVE_ERROR.TOO_FAR, ERROR_CODE.VALIDATION_FAILED);
  }
};

/** TRUE when the leave includes `date` — "on leave today" with today's date. */
export const leaveCovers = (span: LeaveSpan, date: string): boolean =>
  span.startsOn <= date && date <= span.endsOn;

/** TRUE when two leaves share at least one day. */
export const leavesOverlap = (a: LeaveSpan, b: LeaveSpan): boolean =>
  a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
