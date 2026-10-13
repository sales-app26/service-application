import { BUSINESS_RULE, DEAL_ERROR, ERROR_CODE } from '../../common/constants';
import { DiscountType, PlanCode } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';

/**
 * The deal on a lead as pure functions (`08_deal_terms.sql`): what a form may
 * send, what is stored, and what the client pays. No database, no clock.
 *
 * The money:
 *  - `dealValue` is the list price per month, as the rep entered it.
 *  - Deal total = price × tenure − discount. A percent discount is turned into
 *    rupees on the whole deal and the client's total is rounded down to a rupee.
 *  - Effective monthly value = deal total ÷ tenure. This is what won revenue sums.
 *  - No tenure reads as 1 month and no discount as none, so every deal saved
 *    before tenure and discounts existed counts exactly as it did.
 *
 * `reports/revenue-rules.ts` is the same arithmetic in SQL; the two are tested
 * against each other.
 */

/** What a form sends about the deal. `undefined`: not sent. */
export interface DealInput {
  dealValue?: number | null;
  planCode?: PlanCode | null;
  dealTenureMonths?: number | null;
  offerId?: string | null;
  discountType?: DiscountType | null;
  discountValue?: number | null;
  couponCode?: string | null;
}

/** The deal columns written to a lead, all at once. `plan` (old free text) is always cleared. */
export interface DealTerms {
  dealValue: number | null;
  plan: null;
  planCode: PlanCode | null;
  dealTenureMonths: number | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  couponCode: string | null;
  offerId: string | null;
}

/** An offer's discount, as copied onto a lead. */
export interface OfferDiscount {
  id: string;
  discountType: DiscountType;
  discountValue: number;
  couponCode: string | null;
}

export const DEAL_FIELDS = [
  'dealValue',
  'planCode',
  'dealTenureMonths',
  'offerId',
  'discountType',
  'discountValue',
  'couponCode',
] as const satisfies ReadonlyArray<keyof DealInput>;

/** TRUE when the form sent at least one deal field with a value (a save that records a deal). */
export const dealGiven = (input: DealInput): boolean =>
  DEAL_FIELDS.some((key) => input[key] !== undefined && input[key] !== null);

/** TRUE when the form touched the deal at all, values or nulls (an edit that replaces it). */
export const dealTouched = (input: DealInput): boolean =>
  DEAL_FIELDS.some((key) => input[key] !== undefined);

const refuse = (message: string): never => {
  throw new BusinessException(message, ERROR_CODE.VALIDATION_FAILED);
};

const given = <T>(value: T | null | undefined): value is T => value !== undefined && value !== null;

/**
 * The deal a form describes, checked, as the columns to write. `offer` is the
 * offer named by `input.offerId`, already found usable by the caller.
 *
 *  - Free: no price (0), no tenure, no discount.
 *  - An offer brings its own discount and coupon; a typed discount is either
 *    % off (0–100) or ₹ off (at most the deal total), with an optional coupon.
 *  - A discount needs a price to come off.
 */
export const resolveDeal = (input: DealInput, offer: OfferDiscount | null): DealTerms => {
  const none: DealTerms = {
    dealValue: null,
    plan: null,
    planCode: null,
    dealTenureMonths: null,
    discountType: null,
    discountValue: null,
    couponCode: null,
    offerId: null,
  };

  if (input.planCode === PlanCode.FREE) {
    const extras =
      (given(input.dealValue) && input.dealValue !== 0) ||
      given(input.dealTenureMonths) ||
      given(input.offerId) ||
      given(input.discountType) ||
      given(input.discountValue) ||
      given(input.couponCode);
    if (extras) refuse(DEAL_ERROR.FREE_HAS_NO_PRICE);
    return { ...none, planCode: PlanCode.FREE, dealValue: 0 };
  }

  const terms: DealTerms = {
    ...none,
    dealValue: input.dealValue ?? null,
    planCode: input.planCode ?? null,
    dealTenureMonths: input.dealTenureMonths ?? null,
  };

  if (given(input.offerId)) {
    if (given(input.discountType) || given(input.discountValue)) {
      refuse(DEAL_ERROR.OFFER_OR_DISCOUNT);
    }
    if (given(input.couponCode)) refuse(DEAL_ERROR.COUPON_FROM_OFFER);
    if (!offer || offer.id !== input.offerId) refuse(DEAL_ERROR.OFFER_ENDED);
    terms.offerId = input.offerId;
    terms.discountType = offer!.discountType;
    terms.discountValue = offer!.discountValue;
    terms.couponCode = offer!.couponCode;
  } else if (given(input.discountType) || given(input.discountValue)) {
    if (!given(input.discountType) || !given(input.discountValue)) {
      refuse(DEAL_ERROR.DISCOUNT_INCOMPLETE);
    }
    terms.discountType = input.discountType!;
    terms.discountValue = input.discountValue!;
    terms.couponCode = input.couponCode ?? null;
  } else if (given(input.couponCode)) {
    refuse(DEAL_ERROR.COUPON_NEEDS_DISCOUNT);
  }

  if (terms.discountType !== null) {
    if (terms.dealValue === null) refuse(DEAL_ERROR.DISCOUNT_NEEDS_PRICE);
    const value = terms.discountValue as number;
    if (terms.discountType === DiscountType.PERCENT && (value < 0 || value > 100)) {
      refuse(DEAL_ERROR.PERCENT_RANGE);
    }
    if (
      terms.discountType === DiscountType.AMOUNT &&
      value > listTotal(terms.dealValue as number, terms.dealTenureMonths)
    ) {
      refuse(DEAL_ERROR.AMOUNT_OVER_TOTAL);
    }
  }

  return terms;
};

/** Price × tenure, a missing tenure read as one month. */
export const listTotal = (monthlyPrice: number, tenureMonths: number | null): number =>
  monthlyPrice * (tenureMonths ?? 1);

export interface DealMoney {
  /** Months the deal runs for (1 when not recorded). */
  tenureMonths: number;
  /** Price × tenure. */
  listTotal: number;
  /** Rupees off the whole deal. */
  discountAmount: number;
  /** What the client pays for the whole tenure. */
  dealTotal: number;
  /** Deal total ÷ tenure — what won revenue counts, per month. Two decimals. */
  effectiveMonthlyValue: number;
}

const PERCENT_SCALE = 100 * 100;

/**
 * What a deal comes to. Null when there is no price. Percent discounts are
 * worked in hundredths of a percent, as integers, so the result never drifts:
 * 10% off ₹2,499 × 6 is ₹13,494 (₹14,994 less ₹1,500, the total rounded down).
 */
export const dealMoney = (deal: {
  dealValue: number | null;
  dealTenureMonths: number | null;
  discountType: DiscountType | null;
  discountValue: number | null;
}): DealMoney | null => {
  if (deal.dealValue === null) return null;
  const tenureMonths = deal.dealTenureMonths ?? 1;
  const list = listTotal(deal.dealValue, tenureMonths);

  let dealTotal = list;
  if (deal.discountType === DiscountType.PERCENT && deal.discountValue !== null) {
    const hundredths = Math.round(deal.discountValue * 100);
    dealTotal = Math.floor((list * (PERCENT_SCALE - hundredths)) / PERCENT_SCALE);
  } else if (deal.discountType === DiscountType.AMOUNT && deal.discountValue !== null) {
    dealTotal = Math.max(list - deal.discountValue, 0);
  }

  return {
    tenureMonths,
    listTotal: list,
    discountAmount: list - dealTotal,
    dealTotal,
    effectiveMonthlyValue: Math.round((dealTotal / tenureMonths) * 100) / 100,
  };
};

/** The allowed tenures, for validators. */
export const DEAL_TENURES = BUSINESS_RULE.DEAL_TENURES;
