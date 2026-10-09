import {
  BUSINESS_RULE,
  ERROR_CODE,
  FOLLOW_UP_ERROR,
  TERMINAL_STATUSES,
} from '../../common/constants';
import { LeadStatus } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
} from '../../common/exceptions/business.exception';
import { daysBetween } from '../../common/utils';

/**
 * The status model (PRD §4) as pure functions — no database, no clock of
 * their own — so every rule is unit-tested in isolation and the services
 * apply exactly one implementation of it.
 */

export const isTerminal = (status: LeadStatus): boolean => TERMINAL_STATUSES.includes(status);

/**
 * The next follow-up date an entry will carry.
 *
 *  - Not asked for Not interested, Converted and Lost — and cleared if sent.
 *  - Required for Follow-up scheduled.
 *  - Optional otherwise.
 *  - Never in the past, at most one year ahead (PRD §5.6).
 */
export const resolveNextFollowUpDate = (
  status: LeadStatus,
  requested: string | null | undefined,
  today: string,
): string | null => {
  if (isTerminal(status)) {
    return null;
  }

  const date = requested ?? null;

  if (date !== null) {
    if (date < today) {
      throw new BusinessException(FOLLOW_UP_ERROR.NEXT_DATE_PAST, ERROR_CODE.VALIDATION_FAILED);
    }
    if (daysBetween(today, date) > BUSINESS_RULE.NEXT_FOLLOW_UP_MAX_DAYS_AHEAD) {
      throw new BusinessException(FOLLOW_UP_ERROR.NEXT_DATE_TOO_FAR, ERROR_CODE.VALIDATION_FAILED);
    }
  }

  if (status === LeadStatus.FOLLOW_UP_SCHEDULED && date === null) {
    throw new BusinessException(FOLLOW_UP_ERROR.NEXT_DATE_REQUIRED, ERROR_CODE.VALIDATION_FAILED);
  }

  return date;
};

/**
 * A follow-up on an existing lead.
 *
 *  - New is only ever the starting status.
 *  - A Converted lead can be followed up (an after-sale visit) but stays
 *    Converted: only an admin moves it away, through a status change.
 *  - Not interested and Lost reopen freely.
 */
export const assertFollowUpStatus = (current: LeadStatus, next: LeadStatus): void => {
  if (next === LeadStatus.NEW) {
    throw new BusinessException(FOLLOW_UP_ERROR.NEW_NOT_ALLOWED, ERROR_CODE.UNPROCESSABLE);
  }
  if (current === LeadStatus.CONVERTED && next !== LeadStatus.CONVERTED) {
    throw new ForbiddenBusinessException(FOLLOW_UP_ERROR.CONVERTED_LOCKED);
  }
};

/**
 * A manual status change (PRD §5.9). It must actually change something, can
 * never go back to New, and only an admin can leave Converted.
 */
export const assertManualStatusChange = (
  current: LeadStatus,
  next: LeadStatus,
  actorIsAdmin: boolean,
): void => {
  if (next === current) {
    throw new BusinessException(FOLLOW_UP_ERROR.SAME_STATUS, ERROR_CODE.UNPROCESSABLE);
  }
  if (next === LeadStatus.NEW) {
    throw new BusinessException(FOLLOW_UP_ERROR.NEW_NOT_ALLOWED, ERROR_CODE.UNPROCESSABLE);
  }
  if (current === LeadStatus.CONVERTED && !actorIsAdmin) {
    throw new ForbiddenBusinessException(FOLLOW_UP_ERROR.CONVERTED_LOCKED);
  }
};

export interface ConversionState {
  convertedAt: Date | null;
  convertedBy: string | null;
}

/**
 * Conversion credit after an entry (DB Design §2.5).
 *
 *  - Becoming Converted stamps the entry's server time and credits the
 *    **owner at that moment** — never an admin who set it by hand, and never
 *    a later owner after a transfer.
 *  - Staying Converted keeps the original credit; a follow-up visit on a
 *    converted lead must not move the conversion into this week.
 *  - Leaving Converted clears both, so the target count drops.
 */
export const conversionAfter = (
  lead: { status: LeadStatus; ownerId: string } & ConversionState,
  next: LeadStatus,
  at: Date,
): ConversionState => {
  if (next !== LeadStatus.CONVERTED) {
    return { convertedAt: null, convertedBy: null };
  }
  if (lead.status === LeadStatus.CONVERTED && lead.convertedAt && lead.convertedBy) {
    return { convertedAt: lead.convertedAt, convertedBy: lead.convertedBy };
  }
  return { convertedAt: at, convertedBy: lead.ownerId };
};
