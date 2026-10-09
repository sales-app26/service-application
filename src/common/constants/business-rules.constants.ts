import { LeadStatus } from '../enums';

/**
 * The numbers the PRD fixes. Items marked **Assumption** in the PRD (§12) live
 * here so confirming or changing one is a one-line edit.
 */
export const BUSINESS_RULE = {
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
} as const;

/** Statuses after which no next follow-up date is asked, and any is cleared (PRD §4). */
export const TERMINAL_STATUSES: readonly LeadStatus[] = [
  LeadStatus.NOT_INTERESTED,
  LeadStatus.CONVERTED,
  LeadStatus.LOST,
];

/** Statuses that keep a lead off every Due today list (DB Design §5). */
export const NOT_DUE_STATUSES = TERMINAL_STATUSES;

/** Storage folders inside the private bucket. */
export const STORAGE_FOLDER = {
  VISITS: 'visits',
  PROJECTS: 'projects',
} as const;

/** Reasons written on transfers the system rejects on someone's behalf. */
export const AUTO_REJECT_REASON = {
  USER_DEACTIVATED: 'User deactivated',
  MEMBER_REMOVED: 'Member removed from the project',
  PROJECT_CLOSED: 'Project closed',
  LEAD_DELETED: 'Lead deleted',
  SUPERSEDED: 'Superseded by a direct reassignment',
} as const;
