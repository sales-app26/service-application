import { ERROR_CODE, PRICING_ERROR } from '../../common/constants';
import { DiscountType } from '../../common/enums';
import { assertOfferTerms, isOfferLive } from './pricing-rules';

const TODAY = '2026-10-13';

describe('isOfferLive: the offers a rep can pick today', () => {
  const offer = (fields: Partial<Parameters<typeof isOfferLive>[0]> = {}) => ({
    active: true,
    deletedAt: null,
    startsOn: null,
    endsOn: null,
    ...fields,
  });

  it('takes an active offer with no dates, or one whose dates include today', () => {
    expect(isOfferLive(offer(), TODAY)).toBe(true);
    expect(isOfferLive(offer({ startsOn: TODAY, endsOn: TODAY }), TODAY)).toBe(true);
    expect(isOfferLive(offer({ startsOn: '2026-10-01', endsOn: '2026-11-15' }), TODAY)).toBe(true);
  });

  it('leaves out an ended, removed, not yet started or finished offer', () => {
    expect(isOfferLive(offer({ active: false }), TODAY)).toBe(false);
    expect(isOfferLive(offer({ deletedAt: new Date() }), TODAY)).toBe(false);
    expect(isOfferLive(offer({ startsOn: '2026-10-14' }), TODAY)).toBe(false);
    expect(isOfferLive(offer({ endsOn: '2026-10-12' }), TODAY)).toBe(false);
  });
});

describe('assertOfferTerms', () => {
  const terms = (fields: Partial<Parameters<typeof assertOfferTerms>[0]>) => () =>
    assertOfferTerms({
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      startsOn: null,
      endsOn: null,
      ...fields,
    });
  const refused = (message: string) =>
    expect.objectContaining({ message, errorCode: ERROR_CODE.VALIDATION_FAILED });

  it('takes a percent above 0 up to 100, and whole rupees above 0', () => {
    expect(terms({ discountValue: 100 })).not.toThrow();
    expect(terms({ discountValue: 12.5 })).not.toThrow();
    expect(terms({ discountType: DiscountType.AMOUNT, discountValue: 500 })).not.toThrow();
  });

  it('refuses 0%, over 100%, ₹0 and paise', () => {
    expect(terms({ discountValue: 0 })).toThrow(refused(PRICING_ERROR.PERCENT_RANGE));
    expect(terms({ discountValue: 100.01 })).toThrow(refused(PRICING_ERROR.PERCENT_RANGE));
    expect(terms({ discountType: DiscountType.AMOUNT, discountValue: 0 })).toThrow(
      refused(PRICING_ERROR.AMOUNT_WHOLE),
    );
    expect(terms({ discountType: DiscountType.AMOUNT, discountValue: 99.5 })).toThrow(
      refused(PRICING_ERROR.AMOUNT_WHOLE),
    );
  });

  it('refuses a last day before the first', () => {
    expect(terms({ startsOn: '2026-10-13', endsOn: '2026-10-12' })).toThrow(
      refused(PRICING_ERROR.OFFER_ENDS_BEFORE_START),
    );
    expect(terms({ startsOn: '2026-10-13', endsOn: '2026-10-13' })).not.toThrow();
  });
});
