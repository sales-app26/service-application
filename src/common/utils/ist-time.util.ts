import { TargetPeriod } from '../enums';

/**
 * India time, wherever the container runs.
 *
 * Every "today" in the product is India's (PRD §3): the Due today list, the
 * same-day edit lock at midnight, "who logged nothing today", Monday–Sunday
 * weeks and calendar months. The production image runs in UTC, so reading the
 * server's local calendar would move every one of those boundaries by 5h30m —
 * an entry logged at 00:30 IST would still belong to "yesterday" and stay
 * editable until 05:30.
 *
 * India has had a fixed +05:30 offset with no daylight saving since 1945, so
 * the conversion is plain arithmetic and does not need a time-zone database.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A `[start, end)` window of real instants. */
export interface InstantRange {
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** The IST calendar date of an instant, `YYYY-MM-DD`. */
export const istDateOf = (at: Date): string =>
  new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Today's date in India. */
export const istToday = (now: Date = new Date()): string => istDateOf(now);

/** TRUE for a well-formed calendar date that actually exists (no 31 February). */
export const isValidIsoDate = (value: string): boolean => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** The instant IST midnight begins on the given date. */
export const istStartOfDay = (date: string): Date =>
  new Date(Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS);

/** One IST calendar day as instants. */
export const istDayRange = (date: string): InstantRange => {
  const start = istStartOfDay(date);
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

/** `from` 00:00 IST to the end of `to` (inclusive dates), as instants. */
export const istDateSpan = (from: string, to: string): InstantRange => ({
  start: istStartOfDay(from),
  end: istStartOfDay(addDays(to, 1)),
});

/** Calendar arithmetic on a `YYYY-MM-DD` string. */
export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The Monday–Sunday IST week containing `at` (BRD §7). */
export const istWeekRange = (at: Date = new Date()): InstantRange => {
  const today = istDateOf(at);
  // 0 = Sunday … 6 = Saturday, read from the IST date itself.
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  return istDateSpan(monday, addDays(monday, 6));
};

/** The calendar month in IST containing `at`. */
export const istMonthRange = (at: Date = new Date()): InstantRange => {
  const [year, month] = istDateOf(at).split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextFirst = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start: istStartOfDay(first), end: istStartOfDay(nextFirst) };
};

/** The current target period window (PRD §5.4). */
export const targetPeriodRange = (period: TargetPeriod, at: Date = new Date()): InstantRange =>
  period === TargetPeriod.WEEKLY ? istWeekRange(at) : istMonthRange(at);

/** TRUE when two instants fall on the same IST calendar day. */
export const isSameIstDay = (a: Date, b: Date): boolean => istDateOf(a) === istDateOf(b);

const IST_STAMP_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** `08 Oct 2026, 03:42 pm` — the date and time burnt onto a visit photo. */
export const formatIstStamp = (at: Date): string => IST_STAMP_FORMAT.format(at);

/** `2026-10-08 15:42` in IST — sortable, for CSV exports. */
export const formatIstDateTime = (at: Date | null): string => {
  if (!at) return '';
  const shifted = new Date(at.getTime() + IST_OFFSET_MS).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)}`;
};
