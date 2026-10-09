import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ERROR_CODE, ErrorCode, SWAGGER_EXAMPLE } from '../constants';

/**
 * Every endpoint answers with the same envelope. Clients branch on `success`
 * alone and never have to guess whether a 200 body is the payload or a wrapper.
 */
export class ApiResponseDto<T> {
  @ApiProperty({ description: 'Always true for a successful response.', example: true })
  success: boolean;

  @ApiProperty({ description: 'HTTP status code, repeated in the body.', example: 200 })
  statusCode: number;

  @ApiProperty({ description: 'Human-readable summary.', example: 'Fetched successfully.' })
  message: string;

  @ApiProperty({ description: 'The response payload. Shape depends on the endpoint.' })
  data: T;

  @ApiProperty({ description: 'Server time (ISO 8601).', example: SWAGGER_EXAMPLE.TIMESTAMP })
  timestamp: string;

  @ApiProperty({ description: 'Path that produced this response.', example: '/api/v1/leads' })
  path: string;
}

/** One field's validation failures, grouped so a form can highlight inputs. */
export class ValidationErrorDetailDto {
  @ApiProperty({ description: 'Property that failed validation.', example: 'phone' })
  field: string;

  @ApiProperty({
    description: 'All constraints the value violated.',
    example: ['phone must be a 10-digit Indian mobile number'],
    type: [String],
  })
  messages: string[];
}

/** The error counterpart of {@link ApiResponseDto}. */
export class ApiErrorResponseDto {
  @ApiProperty({ description: 'Always false for an error response.', example: false })
  success: boolean;

  @ApiProperty({ description: 'HTTP status code.', example: 409 })
  statusCode: number;

  @ApiProperty({
    description: 'Stable machine-readable error code for client branching.',
    enum: Object.values(ERROR_CODE),
    example: ERROR_CODE.DUPLICATE_LEAD_OWN,
  })
  errorCode: ErrorCode;

  @ApiProperty({
    description: 'Message safe to show to the user.',
    example: 'You already have this lead.',
  })
  message: string;

  @ApiPropertyOptional({
    description: 'Field-level detail. Present only on validation failures.',
    type: [ValidationErrorDetailDto],
  })
  errors?: ValidationErrorDetailDto[];

  @ApiPropertyOptional({
    description:
      'Machine-readable context the screen can act on, e.g. `{ leadId }` to link to an existing lead or `{ userId }` to offer reactivation.',
    type: Object,
    example: { leadId: SWAGGER_EXAMPLE.UUID },
  })
  details?: Record<string, unknown>;

  @ApiProperty({ description: 'Server time (ISO 8601).', example: SWAGGER_EXAMPLE.TIMESTAMP })
  timestamp: string;

  @ApiProperty({ description: 'Path that produced this error.', example: '/api/v1/leads' })
  path: string;

  @ApiPropertyOptional({ description: 'Correlation id.', example: SWAGGER_EXAMPLE.UUID })
  requestId?: string;
}
