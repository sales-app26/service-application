import { ERROR_CODE, PRICING_ERROR } from '../../common/constants';
import { DiscountType } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';

/**
 * Plans and offers as pure functions: which offers a rep can pick today, and
 * what makes an offer's discount valid.
 */

/** An offer reps can pick on `today` (an India date): active, not removed, within its dates. */
export const isOfferLive = (
  offer: {
    active: boolean;
    deletedAt: Date | null;
    startsOn: string | null;
    endsOn: string | null;
  },
  today: string,
): boolean =>
  offer.active &&
  offer.deletedAt === null &&
  (offer.startsOn === null || offer.startsOn <= today) &&
  (offer.endsOn === null || offer.endsOn >= today);

/**
 * An offer's discount and dates, after a create or an edit: percent more than
 * 0 and at most 100, rupees whole and more than 0, and the last day not before
 * the first.
 */
export const assertOfferTerms = (offer: {
  discountType: DiscountType;
  discountValue: number;
  startsOn: string | null;
  endsOn: string | null;
}): void => {
  const fail = (message: string): never => {
    throw new BusinessException(message, ERROR_CODE.VALIDATION_FAILED);
  };
  if (offer.discountType === DiscountType.PERCENT) {
    if (!(offer.discountValue > 0 && offer.discountValue <= 100)) fail(PRICING_ERROR.PERCENT_RANGE);
  } else if (!(offer.discountValue > 0 && Number.isInteger(offer.discountValue))) {
    fail(PRICING_ERROR.AMOUNT_WHOLE);
  }
  if (offer.startsOn !== null && offer.endsOn !== null && offer.endsOn < offer.startsOn) {
    fail(PRICING_ERROR.OFFER_ENDS_BEFORE_START);
  }
};
