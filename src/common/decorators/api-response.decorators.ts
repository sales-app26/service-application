import { Type, applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { SWAGGER_RESPONSE } from '../constants';
import { ApiErrorResponseDto, ApiResponseDto } from '../dto/api-response.dto';
import { PaginatedResponseDto, PaginationMetaDto } from '../dto/paginated-response.dto';

/**
 * Swagger helpers that describe the response envelope.
 *
 * Because every handler returns its payload wrapped in {@link ApiResponseDto},
 * a bare `@ApiOkResponse({ type: Foo })` would document the wrong shape. These
 * decorators compose the wrapper and the payload so the published schema
 * matches what clients actually receive.
 */

const envelopeSchema = (payload: Record<string, unknown>) => ({
  allOf: [{ $ref: getSchemaPath(ApiResponseDto) }, { properties: { data: payload } }],
});

/** 200 with a single object in `data`. */
export const ApiOkEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  description: string = SWAGGER_RESPONSE.OK,
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiOkResponse({
      description,
      schema: envelopeSchema({ $ref: getSchemaPath(model) }),
    }),
  );

/** 201 with the created object in `data`. */
export const ApiCreatedEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  description: string = SWAGGER_RESPONSE.CREATED,
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiCreatedResponse({
      description,
      schema: envelopeSchema({ $ref: getSchemaPath(model) }),
    }),
  );

/** 200 with a bare array in `data` — for endpoints that never paginate. */
export const ApiOkArrayEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  description: string = SWAGGER_RESPONSE.OK,
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiOkResponse({
      description,
      schema: envelopeSchema({ type: 'array', items: { $ref: getSchemaPath(model) } }),
    }),
  );

/** 200 with a bare array of strings in `data` — for option lists. */
export const ApiOkStringArrayEnvelope = (description: string = SWAGGER_RESPONSE.OK) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto),
    ApiOkResponse({
      description,
      schema: envelopeSchema({ type: 'array', items: { type: 'string' } }),
    }),
  );

/** 200 with `{ items, meta }` in `data`. */
export const ApiPaginatedEnvelope = <TModel extends Type<unknown>>(
  model: TModel,
  description: string = SWAGGER_RESPONSE.OK,
) =>
  applyDecorators(
    ApiExtraModels(ApiResponseDto, PaginatedResponseDto, PaginationMetaDto, model),
    ApiOkResponse({
      description,
      schema: envelopeSchema({
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              items: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PaginationMetaDto) },
            },
          },
        ],
      }),
    }),
  );

/**
 * The failure responses every authenticated endpoint can produce.
 *
 * Applied once per controller rather than repeated on each handler, so the
 * documentation stays honest without cluttering the route definitions.
 */
export const ApiStandardErrors = () =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiBadRequestResponse({
      description: SWAGGER_RESPONSE.BAD_REQUEST,
      type: ApiErrorResponseDto,
    }),
    ApiUnauthorizedResponse({
      description: SWAGGER_RESPONSE.UNAUTHORIZED,
      type: ApiErrorResponseDto,
    }),
    ApiForbiddenResponse({
      description: SWAGGER_RESPONSE.FORBIDDEN,
      type: ApiErrorResponseDto,
    }),
    ApiNotFoundResponse({
      description: SWAGGER_RESPONSE.NOT_FOUND,
      type: ApiErrorResponseDto,
    }),
    ApiConflictResponse({
      description: SWAGGER_RESPONSE.CONFLICT,
      type: ApiErrorResponseDto,
    }),
    ApiUnprocessableEntityResponse({
      description: SWAGGER_RESPONSE.UNPROCESSABLE,
      type: ApiErrorResponseDto,
    }),
    ApiTooManyRequestsResponse({
      description: SWAGGER_RESPONSE.TOO_MANY_REQUESTS,
      type: ApiErrorResponseDto,
    }),
    ApiInternalServerErrorResponse({
      description: SWAGGER_RESPONSE.INTERNAL,
      type: ApiErrorResponseDto,
    }),
  );
