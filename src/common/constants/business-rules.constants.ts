import { LeadStatus } from '../enums';

/**
 * The numbers the PRD fixes. Items marked **Assumption** in the PRD (§12) live
 * here so confirming or changing one is a one-line edit.
 */
export const BUSINESS_RULE = {
  /** A release note is text — 512 KB is already a book. */
  RELEASE_NOTE_MAX_BYTES: 512 * 1024,
  VERSION_TITLE_MAX_LENGTH: 120,
  VERSION_TAG_MAX_LENGTH: 40,
  VERSION_TAGS_MAX: 8,
  /** PRD §5.1 — Assumption 13. */
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 72,
  /** Indian 10-digit mobile numbers only — Assumption 1. */
  PHONE_DIGITS: 10,
  NAME_MAX_LENGTH: 120,
  BUSINESS_NAME_MAX_LENGTH: 160,
  NOTES_MAX_LENGTH: 2000,
  DESCRIPTION_MAX_LENGTH: 2000,
  REASON_MAX_LENGTH: 500,
  /** PRD §5.6 / §5.9 — Assumption 3. */
  NOTE_MIN_LENGTH: 5,
  NOTE_MAX_LENGTH: 2000,
  /** PRD §5.8. */
  LOCATION_MIN_LENGTH: 2,
  LOCATION_MAX_LENGTH: 100,
  /** PRD §5.8: suggestions show the 10 closest matches, most used first. */
  LOCATION_SUGGESTION_LIMIT: 10,
  /** PRD §5.6: next follow-up date allowed up to one year ahead. */
  NEXT_FOLLOW_UP_MAX_DAYS_AHEAD: 365,
  /** PRD §5.7 — Assumption 4: submit within 10 minutes of capture. */
  CAPTURE_WINDOW_MINUTES: 10,
  /** PRD §5.7: above this the entry is tagged "Low accuracy". Never rejected. */
  LOW_ACCURACY_METRES: 100,
  /** A phone reporting more than this is not reporting a position at all. */
  MAX_GPS_ACCURACY_METRES: 100_000,
  /** Nominatim's usage policy: at most one request a second, from the whole service. */
  GEOCODER_MIN_INTERVAL_MS: 1_000,
  /** Looked-up places kept in memory, keyed by position rounded to 4 decimals (~11 m). */
  GEOCODER_CACHE_SIZE: 5_000,
  GEOCODER_CACHE_TTL_MS: 7 * 24 * 60 * 60 * 1_000,
  /** Decimal places a position is rounded to before it is looked up (~11 m). */
  GEOCODER_ROUND_DECIMALS: 4,
  /** "Use my location" and the camera's "Near …": lookups per person per minute. */
  GEO_LOOKUPS_PER_MINUTE: 20,
  /** The stored place name. */
  PLACE_NAME_MAX_LENGTH: 200,
  /** Raw camera upload ceiling; the phone compresses before sending (VP-7). */
  VISIT_PHOTO_MAX_BYTES: 8 * 1024 * 1024,
  /** Stored photo: longest edge and JPEG quality steps toward ~200–300 KB. */
  VISIT_PHOTO_MAX_EDGE_PX: 1280,
  VISIT_PHOTO_QUALITY_STEPS: [72, 62, 52] as readonly number[],
  VISIT_PHOTO_TARGET_MAX_BYTES: 300 * 1024,
  /** PRD §5.3 — Assumption 13: JPG or PNG up to 2 MB. */
  PROJECT_IMAGE_MAX_BYTES: 2 * 1024 * 1024,
  PROJECT_IMAGE_MAX_EDGE_PX: 1200,
  /** PRD §5.12 — Assumption 12. */
  EXPORT_MAX_DAYS: 92,
  /** Bulk reassignment of a departed person's leads, per request. */
  BULK_REASSIGN_MAX_LEADS: 500,
  /** One CSV import: rows (not counting the header) and file size. */
  IMPORT_MAX_ROWS: 1000,
  IMPORT_MAX_BYTES: 1024 * 1024,
  /** Problem rows listed back to the admin; the counts are always complete. */
  IMPORT_MAX_PROBLEMS_LISTED: 200,
  SUMMARY_MAX_DAYS: 92,
  /** Lead detail shows this many recent entries; the rest are paged. */
  LEAD_DETAIL_RECENT_ENTRIES: 20,
  /** Deal value in rupees per month: a whole number up to 10 crore. */
  DEAL_VALUE_MAX: 100_000_000,
  PLAN_MAX_LENGTH: 80,
  /** An open lead with no entry for this many days is "cold". */
  COLD_LEAD_DAYS: 14,
  /** A dashboard covers at most a year (a leap year included). */
  DASHBOARD_MAX_DAYS: 366,
  /** Longer than this, the dashboard trend is counted per week instead of per day. */
  TREND_MAX_DAILY_POINTS: 92,
  /** One CSV export holds at most this many rows. */
  EXPORT_MAX_ROWS: 20_000,
  /** Needs attention: conversions this many percentage points behind the time gone. */
  ATTENTION_BEHIND_TARGET_POINTS: 20,
  /** Needs attention: this many overdue leads with one person in one project. */
  ATTENTION_OVERDUE_PILE: 5,
  /** Needs attention: no entry for this many India days (today included). */
  ATTENTION_IDLE_DAYS: 2,
  /** Needs attention: a transfer waiting longer than this. */
  ATTENTION_STALE_TRANSFER_HOURS: 24,
  ATTENTION_LIST_LIMIT: 20,
  /**
   * Needs attention: an open help request starts at this severity — above any
   * other kind until that is several times past its threshold — and climbs by
   * one for every day it waits.
   */
  ATTENTION_HELP_BASE_SEVERITY: 10,
  /** One leave covers at most this many days after its first (`user_leaves_span_max`). */
  LEAVE_MAX_SPAN_DAYS: 60,
  /** A leave can be booked at most this far ahead. */
  LEAVE_MAX_DAYS_AHEAD: 365,
  LEAVE_NOTE_MAX_LENGTH: 200,
  COMMENT_MAX_LENGTH: 2000,
  /** People one comment may mention. */
  COMMENT_MAX_MENTIONS: 20,
  /** A notification quotes this much of the comment that caused it. */
  NOTIFICATION_PREVIEW_LENGTH: 140,
  /** The note written with a transfer or reassignment, pinned for the next owner. */
  HANDOVER_NOTE_MAX_LENGTH: 500,
  TEMPLATE_LABEL_MAX_LENGTH: 40,
  TEMPLATE_BODY_MAX_LENGTH: 1000,
  TEMPLATE_SORT_MAX: 10_000,
  /** Ids one "mark as read" may name; `all` covers the rest. */
  NOTIFICATIONS_READ_MAX_IDS: 100,
} as const;

/** Statuses after which no next follow-up date is asked, and any is cleared (PRD §4). */
export const TERMINAL_STATUSES: readonly LeadStatus[] = [
  LeadStatus.NOT_INTERESTED,
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
];

/** Statuses that keep a lead off every Due today list (DB Design §5). */
export const NOT_DUE_STATUSES = TERMINAL_STATUSES;

/** The only statuses an entry may give a reason for (`follow_ups_reason_only_when_closed`). */
export const REASON_STATUSES: readonly LeadStatus[] = [LeadStatus.NOT_INTERESTED, LeadStatus.LOST];

/**
 * Funnel stage "interested", reached by current status. "Contacted" is any
 * status but New; "converted" is Converted.
 */
export const FUNNEL_INTERESTED_STATUSES: readonly LeadStatus[] = [
  LeadStatus.INTERESTED,
  LeadStatus.FOLLOW_UP_SCHEDULED,
  LeadStatus.CONVERTED,
];

/** What a dashboard count reads when a lead or entry has no source or reason. */
export const UNSPECIFIED = 'unspecified';

/** Storage folders inside the private bucket. */
export const STORAGE_FOLDER = {
  VISITS: 'visits',
  PROJECTS: 'projects',
} as const;

/**
 * Reasons written on handovers the system rejects (or, for a deleted person,
 * makes) on someone's behalf. People read them on the handover card.
 */
export const AUTO_REJECT_REASON = {
  USER_DEACTIVATED: 'Person left the team',
  USER_DELETED: 'Person removed from the app',
  MEMBER_REMOVED: 'Person removed from the campaign team',
  PROJECT_CLOSED: 'Campaign closed',
  LEAD_DELETED: 'Lead removed',
  SUPERSEDED: 'A manager assigned the lead directly',
} as const;
