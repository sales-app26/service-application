import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable, map } from 'rxjs';

import { METADATA_KEY, SUCCESS_MESSAGE } from '../constants';
import { ApiResponseDto } from '../dto/api-response.dto';

/**
 * Wraps every successful handler return value in {@link ApiResponseDto}.
 *
 * The message comes from `@ResponseMessage(...)` when a handler sets one,
 * otherwise from a sensible default for the HTTP verb. Handlers that must emit
 * a raw body — CSV downloads — opt out
 * with `@SkipResponseWrapper()`.
 *
 * A `StreamableFile` is passed through whether or not it opted out. Wrapping a
 * binary body does not fail: it produces a JSON envelope with the bytes mangled
 * inside it, and the caller discovers this only when the download will not open.
 * Anything that is plainly not a JSON payload should never depend on remembering
 * a decorator.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponseDto<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponseDto<T> | T> {
    const skip = this.reflector.getAllAndOverride<boolean>(METADATA_KEY.SKIP_RESPONSE_WRAPPER, [
      context.getHandler(),
      context.getClass(),
    ]);

    // A server-sent event stream is passed through for the same reason a
    // `StreamableFile` is, and detected the same way — from what the route
    // *is*, not from a decorator somebody has to remember. Wrapping it does not
    // fail loudly: Nest takes the envelope's `data` as the frame payload, so
    // every event silently arrives nested one level deeper than the client
    // expects, and the only symptom is a stream that looks like it works.
    const isStream = this.reflector.getAllAndOverride<boolean>(SSE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip || isStream) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const configured = this.reflector.getAllAndOverride<string>(METADATA_KEY.RESPONSE_MESSAGE, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) =>
        data instanceof StreamableFile
          ? data
          : ({
              success: true,
              statusCode: response.statusCode,
              message: configured ?? this.defaultMessage(request.method),
              data,
              timestamp: new Date().toISOString(),
              path: request.originalUrl ?? request.url,
            } as ApiResponseDto<T>),
      ),
    );
  }

  private defaultMessage(method: string): string {
    switch (method) {
      case 'POST':
        return SUCCESS_MESSAGE.CREATED;
      case 'PUT':
      case 'PATCH':
        return SUCCESS_MESSAGE.UPDATED;
      case 'DELETE':
        return SUCCESS_MESSAGE.DELETED;
      default:
        return SUCCESS_MESSAGE.FETCHED;
    }
  }
}
