/**
 * `@Transform` callbacks shared by the DTOs.
 *
 * Multipart forms (a follow-up with its photo) send every field as a string,
 * so the numeric and boolean ones need an explicit conversion — the global
 * ValidationPipe deliberately has implicit conversion off.
 */
type TransformArgs = { value: unknown };

export const trimString = ({ value }: TransformArgs): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const lowerTrimString = ({ value }: TransformArgs): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Trimmed; an empty string becomes null so "clear this field" is expressible in a form. */
export const trimToNull = ({ value }: TransformArgs): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** `"true"` / `"false"` from a query string or form field. */
export const toBoolean = ({ value }: TransformArgs): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** A numeric string to a number; anything else is left for the validator to refuse. */
export const toNumber = ({ value }: TransformArgs): unknown => {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value === '' ? undefined : value;
};

/** An empty form field means "not sent". */
export const emptyToUndefined = ({ value }: TransformArgs): unknown =>
  value === '' || value === null ? undefined : value;
