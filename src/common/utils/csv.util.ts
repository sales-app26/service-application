/**
 * RFC 4180 CSV, safe to open in Excel.
 *
 * Cells that begin with `=`, `+`, `-`, `@`, tab or carriage return are
 * prefixed with an apostrophe. A client's name or a follow-up note typed as
 * `=HYPERLINK(...)` would otherwise run as a formula on the admin's laptop.
 * Negative coordinates are numbers, not text, and are left alone.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/u;

/** Byte-order mark: without it Excel reads the file as Windows-1252 and mangles names. */
const UTF8_BOM = '\uFEFF';

export type CsvValue = string | number | boolean | Date | null | undefined;

export const csvCell = (value: CsvValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  let text = value instanceof Date ? value.toISOString() : value;
  if (FORMULA_TRIGGER.test(text)) {
    text = `'${text}`;
  }

  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

/** Header row plus data rows, CRLF-separated, with a BOM so Excel reads UTF-8. */
export const toCsv = (headers: string[], rows: CsvValue[][]): string => {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
};
