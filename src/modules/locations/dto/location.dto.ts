import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { BUSINESS_RULE } from '../../../common/constants';

export class LocationSuggestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Wanowrie' })
  name: string;

  @ApiProperty({ description: 'Leads and entries using it.', example: 14 })
  usageCount: number;
}

export class LocationQueryDto {
  @ApiPropertyOptional({ description: 'What has been typed so far.', example: 'wan' })
  @IsOptional()
  @IsString()
  @MaxLength(BUSINESS_RULE.LOCATION_MAX_LENGTH)
  q?: string;
}

/** A location as shown on a lead or entry. */
export class LocationRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Wanowrie' })
  name: string;
}
