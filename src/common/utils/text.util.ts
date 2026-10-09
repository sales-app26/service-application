/**
 * Trims and collapses inner whitespace. Used for location names, where
 * "Camp  Road" and "Camp Road" must be the same place (PRD §5.8).
 */
export const collapseWhitespace = (value: string): string => value.trim().replace(/\s+/gu, ' ');

/** Escapes a value for use inside a SQL `LIKE` pattern. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/gu, (char) => `\\${char}`);

/** Trimmed text, or null when nothing is left. */
export const blankToNull = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};
