import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

import {
  COMMON_ERROR,
  DB_CONSTRAINT,
  ERROR_CODE,
  ErrorCode,
  FOLLOW_UP_ERROR,
  HTTP_HEADER,
  LEAD_ERROR,
  MEMBER_ERROR,
  TRANSFER_ERROR,
  USER_ERROR,
} from '../constants';
import { ApiErrorResponseDto, ValidationErrorDetailDto } from '../dto/api-response.dto';
import { BusinessException } from '../exceptions/business.exception';

/** PostgreSQL SQLSTATE codes translated into meaningful HTTP responses. */
const PG_ERROR_CODE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const;

/**
 * Unique indexes whose violation is a business rule, worded as that rule.
 * Services check these first; this map catches the race that slips past —
 * two people adding the same phone at the same moment (PRD §5.5).
 */
const UNIQUE_CONSTRAINT_MESSAGE: Record<string, { code: ErrorCode; message: string }> = {
  [DB_CONSTRAINT.USERS_EMAIL]: { code: ERROR_CODE.CONFLICT, message: USER_ERROR.EMAIL_EXISTS },
  [DB_CONSTRAINT.LEADS_PROJECT_PHONE]: {
    code: ERROR_CODE.DUPLICATE_LEAD_OTHER,
    message: 'This number is already a lead in this project.',
  },
  [DB_CONSTRAINT.LEAD_TRANSFERS_ONE_PENDING]: {
    code: ERROR_CODE.TRANSFER_PENDING,
    message: TRANSFER_ERROR.PENDING_EXISTS,
  },
  [DB_CONSTRAINT.PROJECT_MEMBERS_PROJECT_USER]: {
    code: ERROR_CODE.CONFLICT,
    message: MEMBER_ERROR.ALREADY_MEMBER,
  },
  [DB_CONSTRAINT.FOLLOW_UPS_CLIENT_REQUEST]: {
    code: ERROR_CODE.CONFLICT,
    message: FOLLOW_UP_ERROR.CLIENT_REQUEST_REUSED,
  },
};

interface PostgresError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

interface HttpErrorBody {
  message?: string | string[];
  errorCode?: ErrorCode;
  details?: Record<string, unknown>;
}

interface ResolvedError {
  status: number;
  errorCode: ErrorCode;
  message: string;
  errors?: ValidationErrorDetailDto[];
  details?: Record<string, unknown>;
}

/**
 * Single exit point for every error the API produces.
 *
 *  1. Shapes every failure into {@link ApiErrorResponseDto}.
 *  2. Translates database errors into meaningful statuses — a unique index is
 *     the last line of defence against duplicate leads and double approvals.
 *  3. Keeps internal details out of the response while logging them in full.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const { status, errorCode, message, errors, details } = this.resolve(exception);

    const body: ApiErrorResponseDto = {
      success: false,
      statusCode: status,
      errorCode,
      message,
      ...(errors ? { errors } : {}),
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
      requestId: this.requestId(request),
    };

    this.log(status, exception, request, message);

    response.status(status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof BusinessException) {
      return {
        status: exception.getStatus(),
        errorCode: exception.errorCode,
        message: this.extractMessage(exception),
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof QueryFailedError) {
      return this.fromDatabaseError(exception as QueryFailedError & PostgresError);
    }

    if (isPoolExhaustion(exception)) {
      // Nothing ran, so nothing is half-written: "come back in a second".
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: ERROR_CODE.SERVICE_BUSY,
        message: COMMON_ERROR.SERVICE_BUSY,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ERROR_CODE.INTERNAL,
      message: COMMON_ERROR.INTERNAL,
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
    const status = exception.getStatus();
    const payload = exception.getResponse() as string | HttpErrorBody;

    // ValidationPipe returns `message` as an array of constraint strings.
    if (typeof payload === 'object' && Array.isArray(payload.message)) {
      return {
        status,
        errorCode: ERROR_CODE.VALIDATION_FAILED,
        message: COMMON_ERROR.VALIDATION_FAILED,
        errors: this.groupValidationMessages(payload.message),
      };
    }

    const message =
      typeof payload === 'string'
        ? payload
        : ((payload.message as string | undefined) ?? exception.message);

    return {
      status,
      errorCode:
        (typeof payload === 'object' ? payload.errorCode : undefined) ??
        this.errorCodeForStatus(status),
      message,
    };
  }

  private fromDatabaseError(error: QueryFailedError & PostgresError): ResolvedError {
    switch (error.code) {
      case PG_ERROR_CODE.UNIQUE_VIOLATION: {
        const known = error.constraint ? UNIQUE_CONSTRAINT_MESSAGE[error.constraint] : undefined;
        return {
          status: HttpStatus.CONFLICT,
          errorCode: known?.code ?? ERROR_CODE.CONFLICT,
          message: known?.message ?? 'A record with these details already exists.',
        };
      }

      case PG_ERROR_CODE.FOREIGN_KEY_VIOLATION:
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: ERROR_CODE.UNPROCESSABLE,
          message: 'A referenced record does not exist or belongs to another project.',
        };

      case PG_ERROR_CODE.CHECK_VIOLATION:
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errorCode: ERROR_CODE.UNPROCESSABLE,
          message:
            error.constraint === 'leads_phone_format'
              ? LEAD_ERROR.INVALID_PHONE
              : 'The submitted values violate a data integrity rule.',
        };

      case PG_ERROR_CODE.NOT_NULL_VIOLATION:
        return {
          status: HttpStatus.BAD_REQUEST,
          errorCode: ERROR_CODE.VALIDATION_FAILED,
          message: 'A required field was missing.',
        };

      case PG_ERROR_CODE.INVALID_TEXT_REPRESENTATION:
        return {
          status: HttpStatus.BAD_REQUEST,
          errorCode: ERROR_CODE.VALIDATION_FAILED,
          message: COMMON_ERROR.INVALID_UUID,
        };

      case PG_ERROR_CODE.SERIALIZATION_FAILURE:
      case PG_ERROR_CODE.DEADLOCK_DETECTED:
      case PG_ERROR_CODE.LOCK_NOT_AVAILABLE:
        return {
          status: HttpStatus.CONFLICT,
          errorCode: ERROR_CODE.CONFLICT,
          message: 'This record is being updated by another request. Please try again.',
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          errorCode: ERROR_CODE.INTERNAL,
          message: COMMON_ERROR.INTERNAL,
        };
    }
  }

  /**
   * ValidationPipe emits flat strings like `phone must be a string`. Grouping
   * them by field lets a form highlight the offending inputs.
   */
  private groupValidationMessages(messages: string[]): ValidationErrorDetailDto[] {
    const grouped = new Map<string, string[]>();

    for (const message of messages) {
      const field = message.split(' ')[0] ?? 'unknown';
      const existing = grouped.get(field);
      if (existing) {
        existing.push(message);
      } else {
        grouped.set(field, [message]);
      }
    }

    return [...grouped.entries()].map(([field, fieldMessages]) => ({
      field,
      messages: fieldMessages,
    }));
  }

  private errorCodeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ERROR_CODE.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODE.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODE.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODE.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODE.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODE.UNPROCESSABLE;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODE.RATE_LIMITED;
      default:
        return ERROR_CODE.INTERNAL;
    }
  }

  private extractMessage(exception: HttpException): string {
    const payload = exception.getResponse() as string | { message?: string };
    if (typeof payload === 'string') {
      return payload;
    }
    return payload.message ?? exception.message;
  }

  private requestId(request: Request): string | undefined {
    const header = request.headers[HTTP_HEADER.REQUEST_ID];
    return Array.isArray(header) ? header[0] : header;
  }

  private log(status: number, exception: unknown, request: Request, message: string): void {
    const route = `${request.method} ${request.originalUrl ?? request.url}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${route} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    this.logger.warn(`${route} -> ${status}: ${message}`);
  }
}

const POOL_TIMEOUT_PATTERNS = [
  'timeout exceeded when trying to connect',
  'connection terminated due to connection timeout',
  'too many clients',
];

/** TRUE when the driver gave up waiting for a free pooled connection. */
const isPoolExhaustion = (exception: unknown): boolean => {
  const message = exception instanceof Error ? exception.message.toLowerCase() : '';
  return POOL_TIMEOUT_PATTERNS.some((pattern) => message.includes(pattern));
};
