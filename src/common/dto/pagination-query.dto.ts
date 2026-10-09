import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import {
  BUSINESS_RULE,
  PAGINATION,
  SWAGGER_EXAMPLE,
  SWAGGER_PARAM_DESCRIPTION,
} from '../constants';

/**
 * Query parameters shared by every list endpoint.
 *
 * Extend this rather than redeclaring page/limit/search, so paging behaves the
 * same everywhere (PRD §8: lists load 20 items at a time).
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: SWAGGER_PARAM_DESCRIPTION.PAGE,
    minimum: PAGINATION.DEFAULT_PAGE,
    default: PAGINATION.DEFAULT_PAGE,
    example: SWAGGER_EXAMPLE.PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAGINATION.DEFAULT_PAGE)
  page: number = PAGINATION.DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: SWAGGER_PARAM_DESCRIPTION.LIMIT,
    minimum: PAGINATION.MIN_LIMIT,
    maximum: PAGINATION.MAX_LIMIT,
    default: PAGINATION.DEFAULT_LIMIT,
    example: SWAGGER_EXAMPLE.LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PAGINATION.MIN_LIMIT)
  @Max(PAGINATION.MAX_LIMIT)
  limit: number = PAGINATION.DEFAULT_LIMIT;

  @ApiPropertyOptional({ description: SWAGGER_PARAM_DESCRIPTION.SEARCH, example: 'sharma' })
  @IsOptional()
  @IsString()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : (value as string),
  )
  search?: string;

  /** Offset for `skip`, derived rather than accepted from the client. */
  get skip(): number {
    return (this.page - PAGINATION.DEFAULT_PAGE) * this.limit;
  }
}
