/**
 * Indian mobile numbers only (PRD Assumption 1), stored as 10 bare digits.
 *
 * PRD §5.5: spaces, dashes, a leading 0 and +91 are removed before saving, so
 * `+91 98765-43210`, `098765 43210` and `9876543210` are one client and the
 * duplicate check sees them as one. Anything that does not reduce to a number
 * starting 6–9 is not an Indian mobile and is refused rather than guessed at.
 */
const SEPARATORS = /[\s\-().]/gu;
const INDIAN_MOBILE = /^[6-9]\d{9}$/u;

export const normaliseIndianMobile = (raw: string | null | undefined): string | null => {
  if (typeof raw !== 'string') return null;

  let digits = raw.replace(SEPARATORS, '');

  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return INDIAN_MOBILE.test(digits) ? digits : null;
};

/**
 * The digits of a search term, when it looks like part of a phone number.
 * Lets `98765 43` find `9876543210` without matching names that contain digits.
 */
export const phoneSearchDigits = (term: string): string | null => {
  const digits = term.replace(SEPARATORS, '').replace(/^\+91/u, '');
  return /^\d{3,10}$/u.test(digits) ? digits : null;
};
