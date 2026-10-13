import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { DiscountType, PlanCode } from '../../../common/enums';
import { toBoolean, trimString } from '../../../common/utils';
import { IsIsoDate } from '../../../common/validators/is-iso-date.validator';
import { COUPON_CODE_PATTERN } from '../../leads/dto/deal.dto';

// ---------------------------------------------------------------- plan prices

export class PlanPriceDto {
  @ApiProperty({ enum: PlanCode })
  plan: PlanCode;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 2499,
    description: 'List price per month in whole rupees. Null: not set yet. Free is always 0.',
  })
  monthlyPrice: number | null;
}

export class PlanPriceInputDto {
  @ApiProperty({ enum: PlanCode })
  @IsEnum(PlanCode)
  plan: PlanCode;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: BUSINESS_RULE.DEAL_VALUE_MAX,
    example: 2499,
    description: 'Null clears it. Free accepts only 0 (or null, which keeps 0).',
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.DEAL_VALUE_MAX)
  monthlyPrice: number | null;
}

export class UpdatePlanPricesDto {
  @ApiProperty({
    type: [PlanPriceInputDto],
    description: 'The plans to change; plans left out keep their price.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(Object.values(PlanCode).length)
  @ValidateNested({ each: true })
  @Type(() => PlanPriceInputDto)
  prices: PlanPriceInputDto[];
}

// ---------------------------------------------------------------- offers

/** A coupon as typed: trimmed and in capitals; empty means none. */
const toCoupon = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const code = value.trim().toUpperCase();
  return code.length > 0 ? code : null;
};

/** An empty date field means "no limit". */
const emptyToNull = ({ value }: { value: unknown }): unknown => (value === '' ? null : value);

export class OfferDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: 'Diwali offer' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'DIWALI10' })
  couponCode: string | null;

  @ApiProperty({ enum: DiscountType })
  discountType: DiscountType;

  @ApiProperty({ example: 10, description: 'Percent, or whole rupees off the whole deal.' })
  discountValue: number;

  @ApiPropertyOptional({ nullable: true, type: String, example: SWAGGER_EXAMPLE.DATE })
  startsOn: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: SWAGGER_EXAMPLE.DATE })
  endsOn: string | null;

  @ApiProperty({
    description:
      'False once the sales head ends it. Reps see an offer only while it is active and today (India) is within its dates.',
  })
  active: boolean;
}

export class ListOffersQueryDto {
  @ApiPropertyOptional({
    description:
      'Only offers reps can pick today: active and within their dates. Sales reps and managers always get only these.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class CreateOfferDto {
  @ApiProperty({ maxLength: BUSINESS_RULE.OFFER_NAME_MAX_LENGTH, example: 'Diwali offer' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.OFFER_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: BUSINESS_RULE.COUPON_CODE_MAX_LENGTH,
    example: 'DIWALI10',
    description: 'Letters, digits, - and _; stored in capitals.',
  })
  @IsOptional()
  @Transform(toCoupon)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.COUPON_CODE_MAX_LENGTH)
  @Matches(COUPON_CODE_PATTERN, { message: 'couponCode can use only letters, digits, - and _' })
  couponCode?: string | null;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    example: 10,
    description: 'Percent: more than 0, at most 100. Amount: whole rupees, more than 0.',
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(BUSINESS_RULE.DISCOUNT_AMOUNT_MAX)
  discountValue: number;

  @ApiPropertyOptional({ nullable: true, example: SWAGGER_EXAMPLE.DATE })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  startsOn?: string | null;

  @ApiPropertyOptional({ nullable: true, example: SWAGGER_EXAMPLE.DATE })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  endsOn?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Any of the offer's details. `active: false` ends it; `true` brings it back. */
export class UpdateOfferDto {
  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.OFFER_NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.OFFER_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: BUSINESS_RULE.COUPON_CODE_MAX_LENGTH })
  @IsOptional()
  @Transform(toCoupon)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.COUPON_CODE_MAX_LENGTH)
  @Matches(COUPON_CODE_PATTERN, { message: 'couponCode can use only letters, digits, - and _' })
  couponCode?: string | null;

  @ApiPropertyOptional({ enum: DiscountType })
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(BUSINESS_RULE.DISCOUNT_AMOUNT_MAX)
  discountValue?: number;

  @ApiPropertyOptional({ nullable: true, example: SWAGGER_EXAMPLE.DATE })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  startsOn?: string | null;

  @ApiPropertyOptional({ nullable: true, example: SWAGGER_EXAMPLE.DATE })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  endsOn?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
