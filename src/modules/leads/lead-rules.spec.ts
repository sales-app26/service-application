import { ERROR_CODE, FOLLOW_UP_ERROR } from '../../common/constants';
import { LeadStatus } from '../../common/enums';
import {
  assertFollowUpStatus,
  assertManualStatusChange,
  conversionAfter,
  resolveNextFollowUpDate,
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
