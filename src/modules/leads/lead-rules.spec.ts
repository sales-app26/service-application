import { ERROR_CODE, FOLLOW_UP_ERROR } from '../../common/constants';
import { LeadStatus, LostReason } from '../../common/enums';
import {
  assertFollowUpStatus,
  assertManualStatusChange,
  coldSince,
  conversionAfter,
  dealChangesAfter,
  resolveNextFollowUpDate,
  resolveReason,
} from './lead-rules';

const TODAY = '2026-10-08';

describe('resolveNextFollowUpDate (PRD §4)', () => {
  it('requires a date for Follow-up scheduled', () => {
    expect(() => resolveNextFollowUpDate(LeadStatus.FOLLOW_UP_SCHEDULED, undefined, TODAY)).toThrow(
      FOLLOW_UP_ERROR.NEXT_DATE_REQUIRED,
    );
  });

  it('keeps an optional date for Contacted and Interested', () => {
    expect(resolveNextFollowUpDate(LeadStatus.CONTACTED, undefined, TODAY)).toBeNull();
    expect(resolveNextFollowUpDate(LeadStatus.INTERESTED, '2026-10-10', TODAY)).toBe('2026-10-10');
  });

  it.each([LeadStatus.NOT_INTERESTED, LeadStatus.CONVERTED, LeadStatus.LOST])(
    'clears any date for %s',
    (status) => {
      expect(resolveNextFollowUpDate(status, '2026-10-10', TODAY)).toBeNull();
    },
  );

  it('accepts today and refuses the past', () => {
    expect(resolveNextFollowUpDate(LeadStatus.FOLLOW_UP_SCHEDULED, TODAY, TODAY)).toBe(TODAY);
    expect(() => resolveNextFollowUpDate(LeadStatus.CONTACTED, '2026-10-07', TODAY)).toThrow(
      FOLLOW_UP_ERROR.NEXT_DATE_PAST,
    );
  });

  it('allows up to one year ahead and no further', () => {
    expect(resolveNextFollowUpDate(LeadStatus.CONTACTED, '2027-10-08', TODAY)).toBe('2027-10-08');
    expect(() => resolveNextFollowUpDate(LeadStatus.CONTACTED, '2027-10-09', TODAY)).toThrow(
      FOLLOW_UP_ERROR.NEXT_DATE_TOO_FAR,
    );
  });
});

describe('assertFollowUpStatus', () => {
  it('never goes back to New', () => {
    expect(() => assertFollowUpStatus(LeadStatus.CONTACTED, LeadStatus.NEW)).toThrow(
      FOLLOW_UP_ERROR.NEW_NOT_ALLOWED,
    );
  });

  it('lets Lost and Not interested reopen', () => {
    expect(() => assertFollowUpStatus(LeadStatus.LOST, LeadStatus.INTERESTED)).not.toThrow();
    expect(() =>
      assertFollowUpStatus(LeadStatus.NOT_INTERESTED, LeadStatus.CONTACTED),
    ).not.toThrow();
  });

  it('allows an after-sale visit on a Converted lead but keeps it Converted', () => {
    expect(() => assertFollowUpStatus(LeadStatus.CONVERTED, LeadStatus.CONVERTED)).not.toThrow();
    expect(() => assertFollowUpStatus(LeadStatus.CONVERTED, LeadStatus.INTERESTED)).toThrow(
      expect.objectContaining({
        errorCode: ERROR_CODE.FORBIDDEN,
        message: FOLLOW_UP_ERROR.CONVERTED_LOCKED,
      }),
    );
  });

  it('allows Converted from any status', () => {
    for (const status of [LeadStatus.NEW, LeadStatus.LOST, LeadStatus.FOLLOW_UP_SCHEDULED]) {
      expect(() => assertFollowUpStatus(status, LeadStatus.CONVERTED)).not.toThrow();
    }
  });
});

describe('assertManualStatusChange (PRD §5.9)', () => {
  it('must change something', () => {
    expect(() => assertManualStatusChange(LeadStatus.LOST, LeadStatus.LOST, true)).toThrow(
      FOLLOW_UP_ERROR.SAME_STATUS,
    );
  });

  it('lets only an admin leave Converted', () => {
    expect(() => assertManualStatusChange(LeadStatus.CONVERTED, LeadStatus.LOST, false)).toThrow(
      FOLLOW_UP_ERROR.CONVERTED_LOCKED,
    );
    expect(() =>
      assertManualStatusChange(LeadStatus.CONVERTED, LeadStatus.LOST, true),
    ).not.toThrow();
  });

  it('lets the owner set Converted by hand', () => {
    expect(() =>
      assertManualStatusChange(LeadStatus.INTERESTED, LeadStatus.CONVERTED, false),
    ).not.toThrow();
  });
});

describe('conversionAfter (credit and time)', () => {
  const at = new Date('2026-10-08T10:00:00Z');
  const earlier = new Date('2026-10-01T10:00:00Z');

  it('credits the owner, not whoever made the change', () => {
    const lead = {
      status: LeadStatus.INTERESTED,
      ownerId: 'owner',
      convertedAt: null,
      convertedBy: null,
    };
    expect(conversionAfter(lead, LeadStatus.CONVERTED, at)).toEqual({
      convertedAt: at,
      convertedBy: 'owner',
    });
  });

  it('keeps the original credit on a follow-up to an already converted lead', () => {
    const lead = {
      status: LeadStatus.CONVERTED,
      ownerId: 'new-owner',
      convertedAt: earlier,
      convertedBy: 'converter',
    };
    expect(conversionAfter(lead, LeadStatus.CONVERTED, at)).toEqual({
      convertedAt: earlier,
      convertedBy: 'converter',
    });
  });

  it('clears the credit when the lead leaves Converted', () => {
    const lead = {
      status: LeadStatus.CONVERTED,
      ownerId: 'o',
      convertedAt: earlier,
      convertedBy: 'o',
    };
    expect(conversionAfter(lead, LeadStatus.LOST, at)).toEqual({
      convertedAt: null,
      convertedBy: null,
    });
  });

  it('re-converting counts in the period it happens, for the owner at that time', () => {
    const reverted = {
      status: LeadStatus.LOST,
      ownerId: 'current',
      convertedAt: null,
      convertedBy: null,
    };
    expect(conversionAfter(reverted, LeadStatus.CONVERTED, at)).toEqual({
      convertedAt: at,
      convertedBy: 'current',
    });
  });
});

describe('resolveReason', () => {
  it.each([LeadStatus.NOT_INTERESTED, LeadStatus.LOST])('keeps a reason for %s', (status) => {
    expect(resolveReason(status, LostReason.PRICE)).toBe(LostReason.PRICE);
  });

  it('is optional, even for Lost', () => {
    expect(resolveReason(LeadStatus.LOST, undefined)).toBeNull();
    expect(resolveReason(LeadStatus.CONTACTED, null)).toBeNull();
  });

  it.each([LeadStatus.CONTACTED, LeadStatus.INTERESTED, LeadStatus.CONVERTED])(
    'refuses a reason for %s as a validation error',
    (status) => {
      expect(() => resolveReason(status, LostReason.COMPETITOR)).toThrow(
        expect.objectContaining({
          message: FOLLOW_UP_ERROR.REASON_NOT_ALLOWED,
          errorCode: ERROR_CODE.VALIDATION_FAILED,
        }),
      );
    },
  );
});

describe('dealChangesAfter', () => {
  it('writes what a Converted entry sends, and only that', () => {
    expect(dealChangesAfter(LeadStatus.CONVERTED, { dealValue: 1499, plan: 'Gold' })).toEqual({
      dealValue: 1499,
      plan: 'Gold',
    });
    expect(dealChangesAfter(LeadStatus.CONVERTED, { dealValue: 0 })).toEqual({ dealValue: 0 });
    // A follow-up visit on a converted lead that sends nothing keeps the deal.
    expect(dealChangesAfter(LeadStatus.CONVERTED, {})).toEqual({});
  });

  it('ignores empty values, so a blank form field never clears the deal', () => {
    expect(dealChangesAfter(LeadStatus.CONTACTED, { dealValue: undefined, plan: null })).toEqual(
      {},
    );
  });

  it('refuses a deal on any other status as a validation error', () => {
    expect(() => dealChangesAfter(LeadStatus.INTERESTED, { plan: 'Gold' })).toThrow(
      expect.objectContaining({
        message: FOLLOW_UP_ERROR.DEAL_ONLY_WHEN_CONVERTED,
        errorCode: ERROR_CODE.VALIDATION_FAILED,
      }),
    );
  });
});

describe('coldSince', () => {
  it('is exactly 14 days before now', () => {
    const now = new Date('2026-10-15T06:00:00.000Z');
    expect(coldSince(now).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });
});
