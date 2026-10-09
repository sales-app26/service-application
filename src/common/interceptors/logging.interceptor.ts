import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { HTTP_HEADER } from '../constants';

/** Requests slower than this are logged at warn level. */
const SLOW_REQUEST_MS = 1_000;

/**
 * One log line per request with method, path, status and duration.
 *
 * Deliberately never logs request bodies: they carry passwords, client phone numbers
 * and GPS positions.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const startedAt = Date.now();
    const route = `${request.method} ${request.originalUrl ?? request.url}`;
    const requestId = request.headers[HTTP_HEADER.REQUEST_ID];
    const suffix = requestId ? ` [${String(requestId)}]` : '';

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startedAt;
          const line = `${route} ${response.statusCode} ${duration}ms${suffix}`;

          if (duration >= SLOW_REQUEST_MS) {
            this.logger.warn(`SLOW ${line}`);
          } else {
            this.logger.log(line);
          }
        },
        // Failures are logged by AllExceptionsFilter with their stack trace;
        // duplicating them here would double every error line.
        error: () => undefined,
      }),
    );
  }
}
