import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  CreateOfferDto,
  ListOffersQueryDto,
  OfferDto,
  PlanPriceDto,
  UpdateOfferDto,
  UpdatePlanPricesDto,
} from './dto/pricing.dto';
import { PricingService } from './pricing.service';

@ApiTags(SWAGGER_TAG.PRICING)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get(`${ROUTE.SETTINGS}/${ROUTE.PLAN_PRICES}`)
  @ApiOperation({
    summary: 'Plan prices',
    description:
      'Anyone signed in. The four plans in order — free, growth, growth_plus, pro — with the list price per month (null until the sales head sets it; Free is 0). Prefills the price when a rep marks a lead as won.',
  })
  @ApiOkArrayEnvelope(PlanPriceDto)
  planPrices(): Promise<PlanPriceDto[]> {
    return this.pricingService.planPrices();
  }

  @Put(`${ROUTE.SETTINGS}/${ROUTE.PLAN_PRICES}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.PLAN_PRICES_SAVED)
  @ApiOperation({
    summary: 'Set plan prices (sales head)',
    description:
      'Body `{ prices: [{ plan, monthlyPrice | null }] }`; plans left out keep their price. Returns all four. Deals already saved keep the price they were saved with.',
  })
  @ApiOkArrayEnvelope(PlanPriceDto)
  updatePlanPrices(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UpdatePlanPricesDto,
  ): Promise<PlanPriceDto[]> {
    return this.pricingService.updatePlanPrices(actor, dto);
  }

  @Get(ROUTE.OFFERS)
  @ApiOperation({
    summary: 'Offers',
    description:
      'Company-wide. Sales reps and managers get the offers they can pick today (active and within their dates), whatever they ask; the sales head gets every offer not removed, newest first, unless he asks for `active=true`.',
  })
  @ApiOkArrayEnvelope(OfferDto)
  listOffers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListOffersQueryDto,
  ): Promise<OfferDto[]> {
    return this.pricingService.listOffers(actor, query);
  }

  @Post(ROUTE.OFFERS)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.OFFER_SAVED)
  @ApiOperation({ summary: 'Add an offer (sales head)' })
  @ApiCreatedEnvelope(OfferDto)
  createOffer(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateOfferDto,
  ): Promise<OfferDto> {
    return this.pricingService.createOffer(actor, dto);
  }

  @Patch(`${ROUTE.OFFERS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.OFFER_SAVED)
  @ApiOperation({
    summary: 'Edit or end an offer (sales head)',
    description:
      '`active: false` ends it. Deals already won on it keep the discount they were saved with.',
  })
  @ApiOkEnvelope(OfferDto)
  updateOffer(@Param() params: UuidParamDto, @Body() dto: UpdateOfferDto): Promise<OfferDto> {
    return this.pricingService.updateOffer(params.id, dto);
  }

  @Delete(`${ROUTE.OFFERS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.OFFER_REMOVED)
  @ApiOperation({
    summary: 'Remove an offer (sales head)',
    description: 'Hidden from every list. Deals won on it keep its name and discount.',
  })
  async removeOffer(@Param() params: UuidParamDto): Promise<null> {
    await this.pricingService.removeOffer(params.id);
    return null;
  }
}
