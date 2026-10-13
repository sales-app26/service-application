import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { DEAL_ERROR, ERROR_CODE, PRICING_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PlanCode, UserRole } from '../../common/enums';
import {
  BusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { istToday } from '../../common/utils';
import { Offer, PlanPrice } from '../../database/entities';
import { OfferDiscount } from '../leads/deal-rules';
import {
  CreateOfferDto,
  ListOffersQueryDto,
  OfferDto,
  PlanPriceDto,
  UpdateOfferDto,
  UpdatePlanPricesDto,
} from './dto/pricing.dto';
import { assertOfferTerms, isOfferLive } from './pricing-rules';

const PLAN_ORDER: readonly PlanCode[] = [
  PlanCode.FREE,
  PlanCode.GROWTH,
  PlanCode.GROWTH_PLUS,
  PlanCode.PRO,
];

/**
 * Plan prices and company-wide offers (`08_deal_terms.sql`). Everyone signed
 * in reads the prices and the offers live today; only the sales head writes
 * them, and only he sees ended and scheduled offers.
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PlanPrice) private readonly prices: Repository<PlanPrice>,
    @InjectRepository(Offer) private readonly offers: Repository<Offer>,
  ) {}

  // ------------------------------------------------------------ plan prices

  async planPrices(): Promise<PlanPriceDto[]> {
    const rows = await this.prices.find();
    const byPlan = new Map(rows.map((row) => [row.plan, row.monthlyPrice]));
    return PLAN_ORDER.map((plan) => ({
      plan,
      monthlyPrice: plan === PlanCode.FREE ? 0 : (byPlan.get(plan) ?? null),
    }));
  }

  async updatePlanPrices(
    actor: AuthenticatedUser,
    dto: UpdatePlanPricesDto,
  ): Promise<PlanPriceDto[]> {
    const plans = dto.prices.map((price) => price.plan);
    if (new Set(plans).size !== plans.length) {
      throw new BusinessException(PRICING_ERROR.PLAN_TWICE, ERROR_CODE.VALIDATION_FAILED);
    }
    for (const price of dto.prices) {
      if (price.plan === PlanCode.FREE && price.monthlyPrice !== null && price.monthlyPrice !== 0) {
        throw new BusinessException(PRICING_ERROR.FREE_IS_FREE, ERROR_CODE.VALIDATION_FAILED);
      }
    }

    await this.prices.upsert(
      dto.prices.map((price) => ({
        plan: price.plan,
        monthlyPrice: price.plan === PlanCode.FREE ? 0 : price.monthlyPrice,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })),
      ['plan'],
    );
    return this.planPrices();
  }

  // ----------------------------------------------------------------- offers

  /** The sales head sees every offer not removed; everyone else the ones live today. */
  async listOffers(actor: AuthenticatedUser, query: ListOffersQueryDto): Promise<OfferDto[]> {
    const rows = await this.offers.find({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC', id: 'ASC' },
    });
    const onlyLive = query.active === true || actor.role !== UserRole.SUPER_ADMIN;
    const today = istToday();
    return rows.filter((row) => !onlyLive || isOfferLive(row, today)).map(toOfferDto);
  }

  async createOffer(actor: AuthenticatedUser, dto: CreateOfferDto): Promise<OfferDto> {
    const terms = {
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      startsOn: dto.startsOn ?? null,
      endsOn: dto.endsOn ?? null,
    };
    assertOfferTerms(terms);
    const saved = await this.offers.save(
      this.offers.create({
        name: dto.name,
        couponCode: dto.couponCode ?? null,
        ...terms,
        active: dto.active ?? true,
        createdBy: actor.id,
      }),
    );
    return toOfferDto(await this.offers.findOneByOrFail({ id: saved.id }));
  }

  async updateOffer(offerId: string, dto: UpdateOfferDto): Promise<OfferDto> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BusinessException(PRICING_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }
    const offer = await this.findLive(offerId);
    const changes: Partial<Offer> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.couponCode !== undefined) changes.couponCode = dto.couponCode;
    if (dto.discountType !== undefined) changes.discountType = dto.discountType;
    if (dto.discountValue !== undefined) changes.discountValue = dto.discountValue;
    if (dto.startsOn !== undefined) changes.startsOn = dto.startsOn;
    if (dto.endsOn !== undefined) changes.endsOn = dto.endsOn;
    if (dto.active !== undefined) changes.active = dto.active;
    assertOfferTerms({ ...offer, ...changes });

    // Deals already won keep the discount copied onto them: nothing else changes.
    await this.offers.update({ id: offer.id }, changes);
    return toOfferDto(await this.offers.findOneByOrFail({ id: offer.id }));
  }

  /** Hidden from every list; deals won on it keep its name. */
  async removeOffer(offerId: string): Promise<void> {
    const offer = await this.findLive(offerId);
    await this.offers.update(
      { id: offer.id, deletedAt: IsNull() },
      { deletedAt: new Date(), active: false },
    );
  }

  /**
   * The discount a deal takes from the offer it names. The offer must be live
   * today — except the offer the lead already carries, whose copied discount is
   * kept, so re-saving a won deal after its offer ended changes nothing.
   */
  async dealOffer(
    offerId: string | null | undefined,
    current: {
      offerId: string | null;
      discountType: OfferDiscount['discountType'] | null;
      discountValue: number | null;
      couponCode: string | null;
    } | null,
  ): Promise<OfferDiscount | null> {
    if (offerId === undefined || offerId === null) return null;
    if (
      current &&
      current.offerId === offerId &&
      current.discountType &&
      current.discountValue !== null
    ) {
      return {
        id: offerId,
        discountType: current.discountType,
        discountValue: current.discountValue,
        couponCode: current.couponCode,
      };
    }
    const offer = await this.offers.findOne({ where: { id: offerId } });
    if (!offer || !isOfferLive(offer, istToday())) {
      throw new BusinessException(DEAL_ERROR.OFFER_ENDED, ERROR_CODE.UNPROCESSABLE);
    }
    return {
      id: offer.id,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      couponCode: offer.couponCode,
    };
  }

  private async findLive(offerId: string): Promise<Offer> {
    const offer = await this.offers.findOne({ where: { id: offerId, deletedAt: IsNull() } });
    if (!offer) throw new NotFoundBusinessException(PRICING_ERROR.OFFER_NOT_FOUND);
    return offer;
  }
}

const toOfferDto = (row: Offer): OfferDto => ({
  id: row.id,
  name: row.name,
  couponCode: row.couponCode,
  discountType: row.discountType,
  discountValue: row.discountValue,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  active: row.active,
});
