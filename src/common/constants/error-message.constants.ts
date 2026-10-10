import { BUSINESS_RULE } from './business-rules.constants';

/**
 * Stable machine-readable codes. Clients branch on these, never on prose — the
 * messages below can be reworded without breaking a screen.
 */
export const ERROR_CODE = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE: 'UNPROCESSABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  SERVICE_BUSY: 'SERVICE_BUSY',
  INTEGRATION_ERROR: 'INTEGRATION_ERROR',

  /** The email belongs to a deactivated user; `details.userId` says which. */
  USER_DEACTIVATED_EXISTS: 'USER_DEACTIVATED_EXISTS',
  PROJECT_CLOSED: 'PROJECT_CLOSED',
  /** Same phone, same owner. `details.leadId` links to it. */
  DUPLICATE_LEAD_OWN: 'DUPLICATE_LEAD_OWN',
  /** Same phone, someone else's lead. Only the owner's name is disclosed. */
  DUPLICATE_LEAD_OTHER: 'DUPLICATE_LEAD_OTHER',
  LEAD_TRANSFERRED: 'LEAD_TRANSFERRED',
  ENTRY_LOCKED: 'ENTRY_LOCKED',
  VISIT_PROOF_REQUIRED: 'VISIT_PROOF_REQUIRED',
  CAPTURE_EXPIRED: 'CAPTURE_EXPIRED',
  TRANSFER_PENDING: 'TRANSFER_PENDING',
  TRANSFER_ALREADY_DECIDED: 'TRANSFER_ALREADY_DECIDED',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export const COMMON_ERROR = {
  INTERNAL: 'Something went wrong on our side. Please try again.',
  SERVICE_BUSY: 'The service is busy. Please try again in a moment.',
  VALIDATION_FAILED: 'Some of the submitted values are not valid.',
  FORBIDDEN: 'You do not have access to this.',
  UNAUTHORIZED: 'Please sign in to continue.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  INVALID_UUID: 'One of the ids in the request is not valid.',
  NOT_FOUND: 'Not found.',
  INVALID_DATE_RANGE: 'The start date must be on or before the end date.',
} as const;

export const AUTH_ERROR = {
  /** PRD §5.1: one message for both; it never says which was wrong. */
  INVALID_CREDENTIALS: 'Email or password is incorrect',
  ACCOUNT_DEACTIVATED: 'Your account is deactivated. Contact your admin.',
  ACCOUNT_NOT_SET_UP: 'This login has no account in the Sales Tracker. Contact your admin.',
  INVALID_REFRESH_TOKEN: 'Your session has expired. Please sign in again.',
  INVALID_SET_PASSWORD_LINK: 'This link has expired or was already used. Ask for a new one.',
  CURRENT_PASSWORD_WRONG: 'The current password is incorrect.',
  AUTH_UNAVAILABLE: 'Sign-in is temporarily unavailable. Please try again.',
} as const;

export const USER_ERROR = {
  NOT_FOUND: 'User not found.',
  EMAIL_EXISTS: 'A user with this email already exists.',
  EMAIL_EXISTS_DEACTIVATED:
    'This email belongs to a deactivated user. Reactivate that user instead of creating a new one.',
  EMAIL_IN_AUTH:
    'This email is already registered with the login system. Contact support to link it.',
  MODERATOR_CREATES_SALES_ONLY: 'Moderators can only create sales persons.',
  CANNOT_CREATE_SUPER_ADMIN: 'Super Admins cannot be created from the app.',
  NOT_MANAGEABLE: 'You can only manage sales persons you created or share a project with.',
  LAST_SUPER_ADMIN: 'You are the only active Super Admin, so this account cannot be deactivated.',
  LAST_SUPER_ADMIN_ROLE: 'The only active Super Admin cannot change role.',
  ALREADY_ACTIVE: 'This user is already active.',
  ALREADY_INACTIVE: 'This user is already deactivated.',
  SAME_ROLE: 'The user already has this role.',
  SAME_EMAIL: 'The user already has this email.',
} as const;

export const PROJECT_ERROR = {
  NOT_FOUND: 'Project not found.',
  CLOSED: 'This project is closed.',
  ALREADY_CLOSED: 'This project is already closed.',
  ALREADY_ACTIVE: 'This project is already active.',
  TYPE_LOCKED: 'The project type cannot change once the project has a lead.',
  END_BEFORE_START: 'The end date must be on or after the start date.',
  NAME_EXISTS_WARNING: 'Another project already has this name.',
  IMAGE_TYPE: 'The project image must be a JPG or PNG.',
  IMAGE_TOO_LARGE: 'The project image must be 2 MB or smaller.',
  NO_IMAGE: 'This project has no image.',
} as const;

export const MEMBER_ERROR = {
  NOT_MEMBER: 'This person is not a member of the project.',
  ALREADY_MEMBER: 'This person is already a member of the project.',
  USER_INACTIVE: 'A deactivated user cannot be added to a project.',
  SUPER_ADMIN_NOT_MEMBER: 'Super Admins have access to every project and are not added as members.',
  MODERATOR_ADDS_SALES_ONLY: 'Only the Super Admin can add moderators to a project.',
  MODERATOR_REMOVES_SALES_ONLY: 'Only the Super Admin can remove another moderator.',
  SELF_ASSIGN_CLOSED: 'A closed project cannot be assigned.',
  ALREADY_ASSIGNED: 'This project is already assigned to you.',
  TARGET_PAIR: 'Set the target number and the period together, or clear both.',
  TARGET_NOT_ALLOWED:
    'You can set targets only for sales persons in your projects and for yourself.',
} as const;

export const LOCATION_ERROR = {
  LENGTH: `Location must be ${BUSINESS_RULE.LOCATION_MIN_LENGTH} to ${BUSINESS_RULE.LOCATION_MAX_LENGTH} characters.`,
} as const;

export const IMPORT_ERROR = {
  NO_FILE: 'Choose a CSV file.',
  TOO_BIG: 'The file is too big. Split it into files of at most 1,000 leads.',
  TOO_MANY_ROWS: 'A file can hold at most 1,000 leads. Split it and upload the parts one by one.',
  NOT_CSV: 'The file could not be read as a CSV. Save it as CSV (comma separated) and try again.',
  MISSING_COLUMNS: 'The first row must name the columns, including name and phone.',
  EMPTY: 'The file has no leads in it.',
  OWNER_NOT_MEMBER: 'Choose only active members of this project to receive the leads.',
  ASSIGNMENTS_INVALID: 'The lead assignments could not be read. Check the file again.',
  UNASSIGNED: 'Every lead needs a person. Assign the rest, then import.',
  RACE: 'Some of these numbers were added by someone else a moment ago. Check the file again.',
  ROW_NAME: 'Name is missing.',
  ROW_PHONE: 'Phone must be a 10-digit Indian mobile number.',
  ROW_NO_LOCATION: 'No location: add a location column, or a default location.',
  ROW_NO_OWNER: 'No owner: choose who gets this lead, or add an owner_email.',
  ROW_OWNER_UNKNOWN: 'No active member of this project has this owner_email.',
  ROW_LONG: 'A value is too long.',
} as const;

export const LEAD_ERROR = {
  NOT_FOUND: 'Lead not found.',
  INVALID_PHONE: 'Enter a 10-digit Indian mobile number.',
  DUPLICATE_OWN: 'You already have this lead.',
  DUPLICATE_OTHER: (owner: string): string =>
    `This number is already a lead in this project, owned by ${owner}.`,
  NOT_A_MEMBER: 'You are not a member of this project.',
  ADMINS_CANNOT_ADD: 'Only members of the project can add leads.',
  ONLY_OWNER_EDITS: 'Only the lead’s owner can edit it.',
  OWNER_UNAVAILABLE: 'The lead’s owner is inactive or removed. Reassign the lead first.',
} as const;

export const FOLLOW_UP_ERROR = {
  NOT_FOUND: 'Entry not found.',
  ONLY_OWNER_LOGS: 'Only the lead’s owner can log a follow-up.',
  LEAD_TRANSFERRED: (owner: string): string => `This lead now belongs to ${owner}.`,
  NEW_NOT_ALLOWED: 'A lead cannot be set back to New.',
  CONVERTED_LOCKED: 'Ask your moderator to change this.',
  NEXT_DATE_REQUIRED: 'Choose the next follow-up date for Follow-up scheduled.',
  NEXT_DATE_PAST: 'The next follow-up date cannot be in the past.',
  NEXT_DATE_TOO_FAR: `The next follow-up date can be at most ${BUSINESS_RULE.NEXT_FOLLOW_UP_MAX_DAYS_AHEAD} days ahead.`,
  SAME_STATUS: 'The lead already has this status.',
  LOCKED: 'This entry is now locked.',
  ONLY_AUTHOR_EDITS: 'Only the person who logged this entry can edit it.',
  STATUS_CHANGE_NOTE_ONLY: 'Only the note of a status change can be edited.',
  NEXT_DATE_NOT_OWNER: 'The next follow-up date can be changed only while you own the lead.',
  CLIENT_REQUEST_REUSED: 'This request id was already used for a different entry.',
  NOTHING_TO_UPDATE: 'Send a note or a next follow-up date to change.',
} as const;

export const VISIT_ERROR = {
  PHOTO_REQUIRED: 'Take a photo of the visit to save it.',
  GPS_REQUIRED: 'Your location is needed to save a visit. Turn on location and try again.',
  CAPTURE_TOKEN_REQUIRED: 'Take the photo again before saving.',
  CAPTURE_EXPIRED: `The photo was taken more than ${BUSINESS_RULE.CAPTURE_WINDOW_MINUTES} minutes ago. Take it again.`,
  CAPTURE_INVALID: 'This photo could not be verified. Take it again.',
  PHOTO_INVALID: 'The photo could not be read. Take it again.',
  PHOTO_TOO_LARGE: 'The photo is too large. Take it again.',
  STORAGE_UNAVAILABLE: 'The photo could not be saved. Please retry.',
  STORAGE_NOT_CONFIGURED: 'Photo storage is not configured on the server.',
  NO_PHOTO: 'This entry has no photo.',
} as const;

export const TRANSFER_ERROR = {
  NOT_FOUND: 'Transfer not found.',
  PENDING_EXISTS: 'A transfer is already waiting for approval.',
  ONLY_OWNER_REQUESTS: 'Only the lead’s owner can request a transfer.',
  RECIPIENT_INVALID: 'Choose an active member of this project other than the current owner.',
  ALREADY_DECIDED: (name: string): string => `Already decided by ${name}.`,
  SELF_DECISION: 'You cannot decide a transfer you requested or would receive.',
  SELF_REASSIGN: 'You cannot reassign a lead to or from yourself. Ask another admin.',
  OWNER_CHANGED: 'The lead’s owner changed after this request was made.',
  LEADS_NOT_IN_PROJECT: 'Some leads were not found in this project.',
} as const;

export const REPORT_ERROR = {
  EXPORT_RANGE_TOO_LONG: `An export can cover at most ${BUSINESS_RULE.EXPORT_MAX_DAYS} days.`,
  DATE_REQUIRED: 'Choose a start and end date.',
} as const;
