import { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL `NUMERIC` is returned by node-postgres as a string to avoid
 * silent float precision loss. Every quantity, price and tax column in this
 * schema is NUMERIC, so without a transformer arithmetic like
 * `line.unitPrice * line.qty` would silently concatenate strings.
 *
 * The transformer converts to `number` on read and passes values through
 * untouched on write (node-postgres serialises numbers correctly).
 *
 * Precision note: the largest column is NUMERIC(14,2) — about 10^12 — which is
 * well inside the 2^53 exact-integer range of a JavaScript double once scaled.
 * Rounding is still applied explicitly by `money.util.ts` at every arithmetic
 * step so results never drift.
 */
export class NumericTransformer implements ValueTransformer {
  to(value?: number | string | null): number | string | null | undefined {
    return value;
  }

  from(value?: string | number | null): number | null | undefined {
    if (value === null || value === undefined) {
      return value as null | undefined;
    }
    return typeof value === 'number' ? value : Number(value);
  }
}

/** Shared singleton — entities reference this instead of constructing their own. */
export const numericTransformer = new NumericTransformer();

/**
 * Same conversion for nullable columns where `null` must survive the round
 * trip untouched (TypeORM calls `from` with `null` for NULL columns).
 */
export const nullableNumericTransformer = numericTransformer;
