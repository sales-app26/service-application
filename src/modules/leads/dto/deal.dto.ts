import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BUSINESS_RULE } from '../../../common/constants';
import { DiscountType, PlanCode } from '../../../common/enums';
import { emptyToUndefined, toNumber } from '../../../common/utils';

/** A coupon as typed: trimmed and in capitals; an empty field is "not sent". */
const toCouponCode = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const code = value.trim().toUpperCase();
  return code.length > 0 ? code : undefined;
};

export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]+$/u;

/**
 * The deal fields of a form (`08_deal_terms.sql`). Multipart sends strings, so
 * numbers are converted explicitly. Null is accepted: on Edit lead it clears
 * the deal; on a follow-up it reads as "not sent".
 *
 * Sent with a value on a follow-up or status change (Won only), when adding a
 * lead (any stage: the expected deal) or on Edit lead, the deal is written as a
 * whole — a field left out is cleared. Free takes no price, tenure or discount;
 * an offer brings its own discount and coupon.
 */
export class DealFieldsDto {
  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: BUSINESS_RULE.DEAL_VALUE_MAX,
    example: 2499,
    description: 'List price per month in whole rupees, before any discount. 0 for Free.',
  })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.DEAL_VALUE_MAX)
  dealValue?: number | null;

  @ApiPropertyOptional({ enum: PlanCode, nullable: true, description: 'The plan sold.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(PlanCode)
  planCode?: PlanCode | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: BUSINESS_RULE.DEAL_TENURES,
    example: 6,
    description: 'Months the deal runs for. Not sent: 1. Not with Free.',
  })
  @IsOptional()
  @Transform(toNumber)
  @IsIn(BUSINESS_RULE.DEAL_TENURES)
  dealTenureMonths?: number | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'An active offer from GET /offers?active=true. Its discount and coupon are copied onto the lead; do not send discountType, discountValue or couponCode with it.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUUID('4')
  offerId?: string | null;

  @ApiPropertyOptional({
    enum: DiscountType,
    nullable: true,
    description: 'A discount typed by hand: `percent` off or `amount` (₹) off the whole deal.',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(DiscountType)
  discountType?: DiscountType | null;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    example: 10,
    description:
      'With `discountType`: percent 0–100 (two decimals at most), or whole rupees no more than price × tenure.',
  })
  @IsOptional()
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(BUSINESS_RULE.DISCOUNT_AMOUNT_MAX)
  discountValue?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: BUSINESS_RULE.COUPON_CODE_MAX_LENGTH,
    example: 'DIWALI10',
    description: 'With a typed discount only. Letters, digits, - and _; stored in capitals.',
  })
  @IsOptional()
  @Transform(toCouponCode)
  @IsString()
  @MaxLength(BUSINESS_RULE.COUPON_CODE_MAX_LENGTH)
  @Matches(COUPON_CODE_PATTERN, { message: 'couponCode can use only letters, digits, - and _' })
  couponCode?: string | null;
}

/** The offer a deal used, by name. */
export class DealOfferRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Diwali offer' })
  name: string;
}
