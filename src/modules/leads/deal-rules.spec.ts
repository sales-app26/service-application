import { DEAL_ERROR, ERROR_CODE } from '../../common/constants';
import { DiscountType, PlanCode } from '../../common/enums';
import {
  dealGiven,
  dealMoney,
  dealTouched,
  listTotal,
  OfferDiscount,
  resolveDeal,
} from './deal-rules';

const OFFER: OfferDiscount = {
  id: '7c0c4b8e-3b8a-4b71-9f2c-2f3c0d6a1e01',
  discountType: DiscountType.PERCENT,
  discountValue: 10,
  couponCode: 'DIWALI10',
};

const refused = (message: string) =>
  expect.objectContaining({ message, errorCode: ERROR_CODE.VALIDATION_FAILED });

describe('dealMoney: what the client pays and what revenue counts', () => {
  const deal = (
    dealValue: number | null,
    dealTenureMonths: number | null = null,
    discountType: DiscountType | null = null,
    discountValue: number | null = null,
  ) => dealMoney({ dealValue, dealTenureMonths, discountType, discountValue });

  it('is nothing without a price', () => {
    expect(deal(null)).toBeNull();
    expect(deal(null, 6, DiscountType.PERCENT, 10)).toBeNull();
  });

  it('counts an old deal (no tenure, no discount) exactly as before: its monthly price', () => {
    expect(deal(1499)).toEqual({
      tenureMonths: 1,
      listTotal: 1499,
      discountAmount: 0,
      dealTotal: 1499,
      effectiveMonthlyValue: 1499,
    });
  });

  it('takes a percent off the whole deal and rounds the client’s total down to a rupee', () => {
    // ₹2,499 × 6 = ₹14,994; 10% is ₹1,499.40, so the client pays ₹13,494.
    expect(deal(2499, 6, DiscountType.PERCENT, 10)).toEqual({
      tenureMonths: 6,
      listTotal: 14994,
      discountAmount: 1500,
      dealTotal: 13494,
      effectiveMonthlyValue: 2249,
    });
  });

  it('works percent discounts with decimals without drifting', () => {
    // 12.5% off ₹999 × 12 = ₹11,988 → ₹10,489.50 → ₹10,489.
    expect(deal(999, 12, DiscountType.PERCENT, 12.5)?.dealTotal).toBe(10489);
    // 33.33% off ₹3 × 1: 2.0001 → 2.
    expect(deal(3, 1, DiscountType.PERCENT, 33.33)?.dealTotal).toBe(2);
    expect(deal(1000, 3, DiscountType.PERCENT, 0)?.dealTotal).toBe(3000);
    expect(deal(1000, 3, DiscountType.PERCENT, 100)?.dealTotal).toBe(0);
  });

  it('takes rupees off the whole deal, spread over the tenure', () => {
    expect(deal(1000, 3, DiscountType.AMOUNT, 500)).toEqual({
      tenureMonths: 3,
      listTotal: 3000,
      discountAmount: 500,
      dealTotal: 2500,
      effectiveMonthlyValue: 833.33,
    });
    expect(deal(1000, 3, DiscountType.AMOUNT, 3000)?.dealTotal).toBe(0);
  });

  it('counts a Free deal as nothing', () => {
    expect(deal(0)?.effectiveMonthlyValue).toBe(0);
  });

  it('reads a missing tenure as one month', () => {
    expect(listTotal(2499, null)).toBe(2499);
    expect(deal(2000, null, DiscountType.AMOUNT, 500)?.effectiveMonthlyValue).toBe(1500);
  });
});

describe('dealGiven / dealTouched', () => {
  it('tells a form that sent a deal from one that did not', () => {
    expect(dealGiven({})).toBe(false);
    expect(dealGiven({ dealValue: null, planCode: null })).toBe(false);
    expect(dealGiven({ dealTenureMonths: 3 })).toBe(true);
    expect(dealTouched({})).toBe(false);
    expect(dealTouched({ couponCode: null })).toBe(true);
  });
});

describe('resolveDeal: what a deal form may save', () => {
  const none = {
    dealValue: null,
    plan: null,
    planCode: null,
    dealTenureMonths: null,
    discountType: null,
    discountValue: null,
    couponCode: null,
    offerId: null,
  };

  it('saves a plan, tenure and price with no discount, clearing the old plan text', () => {
    expect(
      resolveDeal({ planCode: PlanCode.GROWTH, dealTenureMonths: 6, dealValue: 2499 }, null),
    ).toEqual({ ...none, planCode: PlanCode.GROWTH, dealTenureMonths: 6, dealValue: 2499 });
  });

  it('clears everything when every field is null', () => {
    expect(resolveDeal({ dealValue: null, planCode: null, couponCode: null }, null)).toEqual(none);
  });

  it('makes Free cost nothing and refuses a price, tenure or discount with it', () => {
    expect(resolveDeal({ planCode: PlanCode.FREE }, null)).toEqual({
      ...none,
      planCode: PlanCode.FREE,
      dealValue: 0,
    });
    expect(resolveDeal({ planCode: PlanCode.FREE, dealValue: 0 }, null).dealValue).toBe(0);
    for (const extra of [
      { dealValue: 499 },
      { dealTenureMonths: 3 },
      { offerId: OFFER.id },
      { discountType: DiscountType.PERCENT, discountValue: 5 },
      { couponCode: 'FREE' },
    ]) {
      expect(() => resolveDeal({ planCode: PlanCode.FREE, ...extra }, OFFER)).toThrow(
        refused(DEAL_ERROR.FREE_HAS_NO_PRICE),
      );
    }
  });

  it('copies an offer’s discount and coupon onto the deal', () => {
    expect(
      resolveDeal(
        { planCode: PlanCode.PRO, dealTenureMonths: 12, dealValue: 3999, offerId: OFFER.id },
        OFFER,
      ),
    ).toEqual({
      ...none,
      planCode: PlanCode.PRO,
      dealTenureMonths: 12,
      dealValue: 3999,
      offerId: OFFER.id,
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      couponCode: 'DIWALI10',
    });
  });

  it('refuses an offer together with a typed discount or coupon, or an offer not found usable', () => {
    const base = { dealValue: 1000, offerId: OFFER.id };
    expect(() =>
      resolveDeal({ ...base, discountType: DiscountType.AMOUNT, discountValue: 100 }, OFFER),
    ).toThrow(refused(DEAL_ERROR.OFFER_OR_DISCOUNT));
    expect(() => resolveDeal({ ...base, couponCode: 'X' }, OFFER)).toThrow(
      refused(DEAL_ERROR.COUPON_FROM_OFFER),
    );
    expect(() => resolveDeal(base, null)).toThrow(refused(DEAL_ERROR.OFFER_ENDED));
  });

  it('saves a typed discount with its coupon', () => {
    expect(
      resolveDeal(
        {
          dealValue: 2499,
          dealTenureMonths: 6,
          discountType: DiscountType.AMOUNT,
          discountValue: 1000,
          couponCode: 'SHOP500',
        },
        null,
      ),
    ).toMatchObject({
      discountType: DiscountType.AMOUNT,
      discountValue: 1000,
      couponCode: 'SHOP500',
      offerId: null,
    });
  });

  it('checks a typed discount: both halves, a price, percent 0–100, rupees within the total', () => {
    expect(() =>
      resolveDeal({ dealValue: 1000, discountType: DiscountType.PERCENT }, null),
    ).toThrow(refused(DEAL_ERROR.DISCOUNT_INCOMPLETE));
    expect(() => resolveDeal({ dealValue: 1000, discountValue: 10 }, null)).toThrow(
      refused(DEAL_ERROR.DISCOUNT_INCOMPLETE),
    );
    expect(() =>
      resolveDeal({ discountType: DiscountType.PERCENT, discountValue: 10 }, null),
    ).toThrow(refused(DEAL_ERROR.DISCOUNT_NEEDS_PRICE));
    expect(() =>
      resolveDeal(
        { dealValue: 1000, discountType: DiscountType.PERCENT, discountValue: 100.5 },
        null,
      ),
    ).toThrow(refused(DEAL_ERROR.PERCENT_RANGE));
    expect(() =>
      resolveDeal(
        {
          dealValue: 1000,
          dealTenureMonths: 3,
          discountType: DiscountType.AMOUNT,
          discountValue: 3001,
        },
        null,
      ),
    ).toThrow(refused(DEAL_ERROR.AMOUNT_OVER_TOTAL));
    // Exactly the total is allowed: the client pays nothing.
    expect(
      resolveDeal(
        {
          dealValue: 1000,
          dealTenureMonths: 3,
          discountType: DiscountType.AMOUNT,
          discountValue: 3000,
        },
        null,
      ).discountValue,
    ).toBe(3000);
    // No tenure: the total is one month.
    expect(() =>
      resolveDeal(
        { dealValue: 1000, discountType: DiscountType.AMOUNT, discountValue: 1001 },
        null,
      ),
    ).toThrow(refused(DEAL_ERROR.AMOUNT_OVER_TOTAL));
  });

  it('refuses a coupon with no discount', () => {
    expect(() => resolveDeal({ dealValue: 1000, couponCode: 'SAVE' }, null)).toThrow(
      refused(DEAL_ERROR.COUPON_NEEDS_DISCOUNT),
    );
  });
});
