import { HttpException, HttpStatus } from '@nestjs/common';

import { ERROR_CODE, ErrorCode } from '../constants';

/**
 * The HTTP status each error code implies, so the two cannot drift apart:
 * a caller never receives `400` with `CONFLICT`.
 */
const STATUS_FOR_ERROR_CODE: Record<ErrorCode, HttpStatus> = {
  [ERROR_CODE.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ERROR_CODE.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODE.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODE.ACCOUNT_DEACTIVATED]: HttpStatus.UNAUTHORIZED,
  [ERROR_CODE.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ERROR_CODE.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ERROR_CODE.CONFLICT]: HttpStatus.CONFLICT,
  [ERROR_CODE.UNPROCESSABLE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODE.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ERROR_CODE.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ERROR_CODE.SERVICE_BUSY]: HttpStatus.SERVICE_UNAVAILABLE,
  [ERROR_CODE.INTEGRATION_ERROR]: HttpStatus.BAD_GATEWAY,
  [ERROR_CODE.USER_DEACTIVATED_EXISTS]: HttpStatus.CONFLICT,
  // The request was valid; the project changed underneath it.
  [ERROR_CODE.PROJECT_CLOSED]: HttpStatus.CONFLICT,
  [ERROR_CODE.DUPLICATE_LEAD_OWN]: HttpStatus.CONFLICT,
  [ERROR_CODE.DUPLICATE_LEAD_OTHER]: HttpStatus.CONFLICT,
  [ERROR_CODE.LEAD_TRANSFERRED]: HttpStatus.CONFLICT,
  [ERROR_CODE.ENTRY_LOCKED]: HttpStatus.CONFLICT,
  [ERROR_CODE.VISIT_PROOF_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODE.CAPTURE_EXPIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ERROR_CODE.TRANSFER_PENDING]: HttpStatus.CONFLICT,
  [ERROR_CODE.TRANSFER_ALREADY_DECIDED]: HttpStatus.CONFLICT,
};

/**
 * A rule violation the caller can act on, as opposed to a bug.
 *
 * Carries a stable `errorCode` so clients branch on a constant instead of
 * pattern-matching prose, and optional `details` — the id of the lead that
 * already has this phone, the user that could be reactivated — so the screen
 * can offer the next step the PRD describes.
 */
export class BusinessException extends HttpException {
  readonly errorCode: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    errorCode: ErrorCode = ERROR_CODE.UNPROCESSABLE,
    details?: Record<string, unknown>,
    status?: HttpStatus,
  ) {
    super(
      { message, errorCode, ...(details ? { details } : {}) },
      status ?? STATUS_FOR_ERROR_CODE[errorCode],
    );
    this.errorCode = errorCode;
    this.details = details;
  }
}

/** 404 with the standard envelope. */
export class NotFoundBusinessException extends BusinessException {
  constructor(message: string) {
    super(message, ERROR_CODE.NOT_FOUND);
  }
}

/** 403 with the standard envelope and a message the user can read. */
export class ForbiddenBusinessException extends BusinessException {
  constructor(message: string) {
    super(message, ERROR_CODE.FORBIDDEN);
  }
}

/** 409 — a uniqueness or state conflict. */
export class ConflictBusinessException extends BusinessException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ERROR_CODE.CONFLICT, details);
  }
}

/** A Supabase call failed for a reason that is not the caller's fault. */
export class IntegrationException extends BusinessException {
  constructor(message: string) {
    super(message, ERROR_CODE.INTEGRATION_ERROR);
  }
}
