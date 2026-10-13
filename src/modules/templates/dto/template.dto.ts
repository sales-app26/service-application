import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { trimString } from '../../../common/utils';

export class TemplateDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: 'First visit' })
  label: string;

  @ApiProperty({
    example: 'Hi {client}, this is {rep} from Pronttera. Thank you for your time at {business}.',
    description: '`{client}`, `{rep}` and `{business}` are kept as written for the app to fill in.',
  })
  body: string;

  @ApiProperty({ example: 0, description: 'Lower first.' })
  sort: number;
}

export class CreateTemplateDto {
  @ApiProperty({ maxLength: BUSINESS_RULE.TEMPLATE_LABEL_MAX_LENGTH, example: 'First visit' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.TEMPLATE_LABEL_MAX_LENGTH)
  label: string;

  @ApiProperty({
    maxLength: BUSINESS_RULE.TEMPLATE_BODY_MAX_LENGTH,
    example: 'Hi {client}, this is {rep} from Pronttera.',
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.TEMPLATE_BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({ minimum: 0, maximum: BUSINESS_RULE.TEMPLATE_SORT_MAX, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.TEMPLATE_SORT_MAX)
  sort?: number;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.TEMPLATE_LABEL_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.TEMPLATE_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.TEMPLATE_BODY_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.TEMPLATE_BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: BUSINESS_RULE.TEMPLATE_SORT_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.TEMPLATE_SORT_MAX)
  sort?: number;
}
