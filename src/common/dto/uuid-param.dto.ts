import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { SWAGGER_EXAMPLE, SWAGGER_PARAM_DESCRIPTION } from '../constants';

/**
 * Reusable `:id` path parameter.
 *
 * Validating the UUID at the edge means a malformed id returns 400 instead of
 * reaching Postgres and coming back as a 500 "invalid input syntax for uuid".
 */
export class UuidParamDto {
  @ApiProperty({
    description: SWAGGER_PARAM_DESCRIPTION.ID,
    format: 'uuid',
    example: SWAGGER_EXAMPLE.UUID,
  })
  @IsUUID('4')
  id: string;
}
