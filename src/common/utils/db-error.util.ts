import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

/** TRUE when a write failed on the named unique constraint or index. */
export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  error instanceof QueryFailedError &&
  (error as QueryFailedError & { code?: string; constraint?: string }).code === UNIQUE_VIOLATION &&
  (error as QueryFailedError & { constraint?: string }).constraint === constraint;
