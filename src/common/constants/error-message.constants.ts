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

/*
 * Everything below is read by field sales reps and their managers, usually as
 * a toast. Write it the way a sales manager would say it: campaign (not
 * project), sales manager / sales head (not moderator / super admin), team,
 * handover, follow-up, won. No "record", "ID", "file", "row", "invalid".
 */

export const COMMON_ERROR = {
  INTERNAL: 'Something went wrong on our side. Please try again.',
  SERVICE_BUSY: 'The app is busy right now. Please try again in a moment.',
  VALIDATION_FAILED: 'Some details need a fix. Please check and try again.',
  FORBIDDEN: 'You don’t have access to this. Ask your sales manager if you need it.',
  UNAUTHORIZED: 'Please sign in to continue.',
  /**
   * Kept word for word: the portal matches this exact text to refresh the
   * sign-in quietly (portal-application/src/lib/api.ts, TOKEN_EXPIRED).
   */
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  INVALID_UUID: 'Something you picked is no longer available. Please refresh and try again.',
  NOT_FOUND: 'We couldn’t find that.',
  INVALID_DATE_RANGE: 'The start date must be on or before the end date.',
  TOO_LARGE: 'That’s too big to send. Try a smaller photo or sheet.',
  RATE_LIMITED: 'Too many tries. Please wait a minute and try again.',
  ALREADY_SAVED: 'This is already saved.',
  MISSING_DETAILS: 'Some required details are missing.',
  DETAILS_NOT_RIGHT: 'Some details aren’t right. Please check and try again.',
  BUSY_SAVING: 'Someone else is saving this right now. Please try again.',
  EMAIL_NOT_SENT: 'The email couldn’t be sent. Please try again in a minute.',
} as const;

export const AUTH_ERROR = {
  /** PRD §5.1: one message for both; it never says which was wrong. */
  INVALID_CREDENTIALS: 'Email or password is incorrect',
  ACCOUNT_DEACTIVATED: 'You’re no longer on the team. Talk to your sales manager to get back in.',
  ACCOUNT_NOT_SET_UP:
    'This email isn’t set up in Pronttera Sales yet. Ask your sales manager to invite you.',
  INVALID_REFRESH_TOKEN: 'Please sign in again.',
  INVALID_SET_PASSWORD_LINK: 'This link has expired or was already used. Ask for a new one.',
  CURRENT_PASSWORD_WRONG: 'The current password is incorrect.',
  PASSWORD_NOT_SAVED:
    'Your password couldn’t be saved, and this link can’t be used again. Ask your sales manager for a new one.',
  AUTH_UNAVAILABLE: 'Signing in isn’t working right now. Please try again in a minute.',
} as const;

export const USER_ERROR = {
  NOT_FOUND: 'We couldn’t find this person on your team.',
  EMAIL_EXISTS: 'Someone on the team already uses this email.',
  EMAIL_EXISTS_DEACTIVATED:
    'This email belongs to someone who left the team. Bring them back to the team instead of adding them again.',
  EMAIL_IN_AUTH: 'This email is already used to sign in elsewhere. Contact support to link it.',
  MODERATOR_CREATES_SALES_ONLY: 'Sales managers can add only sales reps.',
  CANNOT_CREATE_SUPER_ADMIN: 'A sales head can’t be added from the app.',
  NOT_MANAGEABLE: 'You can manage only sales reps you added or who share a campaign with you.',
  ACCOUNT_OUTSIDE_SCOPE:
    'This person also works in a campaign you don’t manage, so only the sales head can do this.',
  LAST_SUPER_ADMIN: 'You’re the only active sales head, so you can’t be removed from the team.',
  LAST_SUPER_ADMIN_ROLE: 'The only active sales head can’t change role.',
  ALREADY_ACTIVE: 'This person is already on the team.',
  ALREADY_INACTIVE: 'This person has already left the team.',
  SAME_ROLE: 'This person already has this role.',
  SAME_EMAIL: 'This person already uses this email.',
  RESET_LINK_INACTIVE: 'Bring this person back to the team first, then make a reset link.',
  DELETE_SELF: 'You can’t delete your own account.',
  DELETE_SUPER_ADMIN: 'A sales head can’t be deleted. Change their role first.',
  DELETE_NEEDS_RECIPIENT: 'This person still owns leads. Choose who takes them over.',
  DELETE_RECIPIENT_INVALID:
    'Choose an active sales rep or sales manager, other than the person being deleted, to take over the leads.',
  /** Written as the name of a deleted person, so their past follow-ups still read well. */
  DELETED_NAME: 'Former team member',
} as const;

export const PROJECT_ERROR = {
  NOT_FOUND: 'We couldn’t find this campaign.',
  CLOSED: 'This campaign is closed.',
  ALREADY_CLOSED: 'This campaign is already closed.',
  ALREADY_ACTIVE: 'This campaign is already running.',
  TYPE_LOCKED: 'The campaign type can’t change once the campaign has a lead.',
  END_BEFORE_START: 'The end date must be on or after the start date.',
  NAME_EXISTS_WARNING: 'Another campaign already has this name.',
  IMAGE_TYPE: 'The campaign picture must be a JPG or PNG photo.',
  IMAGE_TOO_LARGE: 'The campaign picture must be 2 MB or smaller.',
  NO_IMAGE: 'This campaign has no picture.',
} as const;

export const MEMBER_ERROR = {
  NOT_MEMBER: 'This person isn’t on this campaign’s team.',
  ALREADY_MEMBER: 'This person is already on this campaign’s team.',
  USER_INACTIVE: 'Someone who left the team can’t be added to a campaign.',
  SUPER_ADMIN_NOT_MEMBER: 'The sales head sees every campaign, so isn’t added to a team.',
  MODERATOR_ADDS_SALES_ONLY: 'Only the sales head can add sales managers to a campaign.',
  MODERATOR_REMOVES_SALES_ONLY: 'Only the sales head can remove another sales manager.',
  ALREADY_ASSIGNED: 'You’re already on this campaign’s team.',
  TARGET_PAIR: 'Set the target number and the period together, or clear both.',
  TARGET_NOT_ALLOWED: 'You can set targets only for sales reps in your campaigns and for yourself.',
  BACKUP_NOT_ALLOWED: 'You can set backups only for sales reps in your campaigns and for yourself.',
  BACKUP_INVALID:
    'Choose someone active on this campaign’s team as the backup — not this person, and not the sales head.',
} as const;

export const LEAVE_ERROR = {
  NOT_FOUND: 'We couldn’t find this leave.',
  ONLY_SELF: 'You can add leave only for yourself.',
  USER_INACTIVE: 'Leave can be added only for someone on the team.',
  END_BEFORE_START: 'The last day of leave must be on or after the first.',
  IN_PAST: 'A leave cannot end before today.',
  TOO_LONG: `The last day of leave can be at most ${BUSINESS_RULE.LEAVE_MAX_SPAN_DAYS} days after the first.`,
  TOO_FAR: `A leave can start at most ${BUSINESS_RULE.LEAVE_MAX_DAYS_AHEAD} days ahead.`,
  OVERLAP: 'This person already has leave on some of these days.',
} as const;

export const COVER_ERROR = {
  NOT_COVERING: 'You aren’t covering for this person in this campaign today.',
} as const;

export const COMMENT_ERROR = {
  NOT_FOUND: 'We couldn’t find this note.',
  MENTION_INVALID:
    'You can mention only the lead’s owner, the campaign’s sales managers and the backup covering for the owner.',
  PIN_NOT_ALLOWED: 'Only the lead’s owner or a sales manager can pin a note.',
  FEEDBACK_ADMIN_ONLY: 'Only a sales manager of this campaign can give feedback on a follow-up.',
  FEEDBACK_NEEDS_ENTRY: 'Choose the follow-up this feedback is about.',
  ENTRY_NOT_ON_LEAD: 'That follow-up isn’t part of this lead’s activity.',
  ONLY_AUTHOR_EDITS: 'Only the person who wrote this note can edit it.',
  ONLY_AUTHOR_DELETES: 'Only the person who wrote this note, or the sales head, can delete it.',
  NOTHING_TO_UPDATE: 'Change the text or the pin, then save.',
  HELP_OPEN: 'There’s already an open help request on this lead.',
  HELP_NOT_ALLOWED: 'Only the lead’s owner, or the backup covering for them, can ask for help.',
  NOT_HELP: 'Only a help request can be marked resolved.',
  ALREADY_RESOLVED: 'This help request is already resolved.',
  RESOLVE_NOT_ALLOWED:
    'Only a sales manager of this campaign or the person who asked can resolve this.',
} as const;

export const NOTIFICATION_ERROR = {
  NOTHING_TO_MARK: 'Pick the notifications to mark as read.',
} as const;

export const TEMPLATE_ERROR = {
  NOT_FOUND: 'We couldn’t find this ready message.',
  NOTHING_TO_UPDATE: 'Change the name, text or order, then save.',
} as const;

export const LOCATION_ERROR = {
  LENGTH: `Location must be ${BUSINESS_RULE.LOCATION_MIN_LENGTH} to ${BUSINESS_RULE.LOCATION_MAX_LENGTH} characters.`,
} as const;

/** Adding leads from a sheet (the sheet is saved as CSV; that word appears only in how to save it). */
export const IMPORT_ERROR = {
  NO_FILE: 'Choose the sheet with your leads.',
  TOO_BIG: 'This sheet is too big. Split it into sheets of at most 1,000 leads.',
  TOO_MANY_ROWS: 'A sheet can hold at most 1,000 leads. Split it and add the parts one by one.',
  NOT_CSV:
    'We couldn’t read this sheet. In Excel or Google Sheets, save it as “CSV (comma separated)” and try again.',
  MISSING_COLUMNS: 'The top line of the sheet needs headings, including name and phone.',
  EMPTY: 'This sheet has no leads in it.',
  OWNER_NOT_MEMBER: 'Choose only people on this campaign’s team to get the leads.',
  ASSIGNMENTS_INVALID: 'We couldn’t read who gets which lead. Check the sheet and try again.',
  UNASSIGNED: 'Every lead needs a person. Assign the rest, then add the leads.',
  RACE: 'Someone added some of these numbers a moment ago. Check the sheet again.',
  ROW_NAME: 'Name is missing.',
  ROW_PHONE: 'Phone must be a 10-digit Indian mobile number.',
  ROW_NO_LOCATION: 'No location: fill one in, or pick a default location.',
  ROW_NO_OWNER: 'No owner: choose who gets this lead, or fill in owner_email.',
  ROW_OWNER_UNKNOWN: 'No one on this campaign’s team has this owner_email.',
  ROW_LONG: 'Some details are too long.',
  ROW_SAME_NUMBER: (line: number): string => `Same number as line ${line} of this sheet.`,
  ROW_ALREADY_LEAD: (owner: string): string =>
    `Already a lead in this campaign, owned by ${owner}.`,
} as const;

export const LEAD_ERROR = {
  LEADS_NOT_IN_PROJECT: 'Some of these leads aren’t in this campaign, or were already deleted.',
  NOT_FOUND: 'We couldn’t find this lead.',
  INVALID_PHONE: 'Enter a 10-digit Indian mobile number.',
  DUPLICATE_OWN: 'You already have this lead.',
  DUPLICATE_OTHER: (owner: string): string =>
    `This number is already a lead in this campaign, owned by ${owner}.`,
  /** The same rule caught at the last moment, when the owner's name is not at hand. */
  DUPLICATE_ANY: 'This number is already a lead in this campaign.',
  NOT_A_MEMBER: 'You aren’t on this campaign’s team.',
  ADMINS_CANNOT_ADD: 'Only people on this campaign’s team can add leads.',
  ONLY_OWNER_EDITS: 'Only the lead’s owner can edit it.',
  OWNER_UNAVAILABLE:
    'The lead’s owner has left the team or this campaign. Assign the lead to someone first.',
} as const;

export const FOLLOW_UP_ERROR = {
  NOT_FOUND: 'We couldn’t find this follow-up.',
  ONLY_OWNER_LOGS: 'Only the lead’s owner can log a follow-up.',
  LEAD_TRANSFERRED: (owner: string): string => `This lead now belongs to ${owner}.`,
  NEW_NOT_ALLOWED: 'A lead cannot be set back to New.',
  CONVERTED_LOCKED: 'Ask your sales manager to change this.',
  NEXT_DATE_REQUIRED: 'Choose the next follow-up date for Follow-up scheduled.',
  NEXT_DATE_PAST: 'The next follow-up date cannot be in the past.',
  NEXT_DATE_TOO_FAR: `The next follow-up date can be at most ${BUSINESS_RULE.NEXT_FOLLOW_UP_MAX_DAYS_AHEAD} days ahead.`,
  SAME_STATUS: 'The lead is already at this stage.',
  LOCKED: 'This follow-up can’t be changed any more.',
  ONLY_AUTHOR_EDITS: 'Only the person who logged this follow-up can edit it.',
  STATUS_CHANGE_NOTE_ONLY: 'Only the note of a stage change can be edited.',
  NEXT_DATE_NOT_OWNER: 'The next follow-up date can be changed only while you own the lead.',
  CLIENT_REQUEST_REUSED:
    'This was already saved as a different follow-up. Please refresh and try again.',
  NOTHING_TO_UPDATE: 'Change the note or the next follow-up date, then save.',
  REASON_NOT_ALLOWED: 'A reason can be given only for Not interested or Lost.',
  DEAL_ONLY_WHEN_CONVERTED: 'Deal details can be added only when the lead is Won.',
} as const;

/** The deal on a lead: plan, tenure, price, offer or discount (`08_deal_terms.sql`). */
export const DEAL_ERROR = {
  FREE_HAS_NO_PRICE: 'The Free plan has no price, tenure or discount.',
  OFFER_OR_DISCOUNT: 'Pick an offer or type a discount, not both.',
  DISCOUNT_INCOMPLETE: 'Choose % off or ₹ off, and how much.',
  DISCOUNT_NEEDS_PRICE: 'Enter the monthly price before adding a discount.',
  COUPON_NEEDS_DISCOUNT: 'A coupon goes with a discount. Add the discount too.',
  COUPON_FROM_OFFER: 'This offer fills in its own coupon.',
  PERCENT_RANGE: 'A % discount must be between 0 and 100.',
  AMOUNT_OVER_TOTAL: 'The ₹ discount can’t be more than the deal total.',
  OFFER_ENDED: 'This offer has ended. Pick another offer or type the discount.',
} as const;

export const PRICING_ERROR = {
  OFFER_NOT_FOUND: 'We couldn’t find this offer.',
  OFFER_ENDS_BEFORE_START: 'The last day must be on or after the first day.',
  PERCENT_RANGE: 'A % off must be more than 0 and at most 100.',
  AMOUNT_WHOLE: 'A ₹ off must be whole rupees, more than 0.',
  NOTHING_TO_UPDATE: 'Change something, then save.',
  FREE_IS_FREE: 'The Free plan is always ₹0.',
  PLAN_TWICE: 'Each plan can be priced once.',
} as const;

export const VISIT_ERROR = {
  PHOTO_REQUIRED: 'Take a photo of the visit to save it.',
  GPS_REQUIRED: 'Your location is needed to save a visit. Turn on location and try again.',
  CAPTURE_TOKEN_REQUIRED: 'Take the photo again before saving.',
  CAPTURE_EXPIRED: `The photo was taken more than ${BUSINESS_RULE.CAPTURE_WINDOW_MINUTES} minutes ago. Take it again.`,
  CAPTURE_INVALID: 'This photo couldn’t be checked. Take it again.',
  CAPTURE_USED: 'This photo was already used for another visit. Take a new one.',
  PHOTO_INVALID: 'The photo couldn’t be read. Take it again.',
  PHOTO_TOO_LARGE: 'The photo is too large. Take it again.',
  STORAGE_UNAVAILABLE: 'The photo couldn’t be saved. Please try again.',
  STORAGE_NOT_CONFIGURED: 'Photos can’t be saved right now. Please contact support.',
  NO_PHOTO: 'This follow-up has no photo.',
} as const;

export const TRANSFER_ERROR = {
  NOT_FOUND: 'We couldn’t find this handover.',
  PENDING_EXISTS: 'A handover is already waiting for approval.',
  ONLY_OWNER_REQUESTS: 'Only the lead’s owner can ask for a handover.',
  RECIPIENT_INVALID: 'Choose someone active on this campaign’s team, other than the current owner.',
  ALREADY_DECIDED: (name: string): string => `Already decided by ${name}.`,
  /** Who decided, when their name is not at hand. */
  ANOTHER_MANAGER: 'another manager',
  SELF_DECISION: 'You can’t approve or reject a handover you asked for or would receive.',
  SELF_REASSIGN: 'You can’t assign a lead to or from yourself. Ask another manager.',
  OWNER_CHANGED: 'The lead’s owner changed after this handover was asked for.',
  LEADS_NOT_IN_PROJECT: 'Some of these leads aren’t in this campaign.',
} as const;

export const REPORT_ERROR = {
  EXPORT_RANGE_TOO_LONG: `A report can cover at most ${BUSINESS_RULE.EXPORT_MAX_DAYS} days.`,
  EXPORT_TOO_MANY_ROWS:
    'This report is too big (over 20,000 lines). Choose fewer days, one campaign or one person.',
  DASHBOARD_RANGE_TOO_LONG: `The sales overview can cover at most ${BUSINESS_RULE.DASHBOARD_MAX_DAYS} days.`,
  SUMMARY_RANGE_TOO_LONG: `A summary can cover at most ${BUSINESS_RULE.SUMMARY_MAX_DAYS} days.`,
  SCORECARD_RANGE_TOO_LONG: `A scorecard or review can cover at most ${BUSINESS_RULE.DASHBOARD_MAX_DAYS} days.`,
  DATE_REQUIRED: 'Choose a start and end date.',
} as const;

/** Release notes are written by the sales head, who works with .md files here. */
export const TRAINING_ERROR = {
  COURSE_NOT_FOUND: 'We couldn’t find this course.',
  LESSON_NOT_FOUND: 'We couldn’t find this lesson.',
  NOTHING_TO_UPDATE: 'Change something, then save.',
  COURSE_UNPUBLISHED: (title: string) =>
    `“${title}” is still a draft. Publish it in the training library first.`,
  TOO_MANY_COURSES: 'A campaign can use at most 20 courses.',
  NOT_IN_CAMPAIGN: 'This lesson isn’t part of this campaign’s training.',
  WRONG_KIND: 'This lesson doesn’t work that way.',
  YOUTUBE_LINK:
    'Paste a YouTube link, like https://youtu.be/… or https://www.youtube.com/watch?v=…',
  PLAYLIST_LINK: 'Paste a YouTube playlist link, like https://www.youtube.com/playlist?list=…',
  MODULE_NOT_IN_PLAYLIST: 'That video isn’t one of this playlist’s modules.',
  VIDEO_TIMES: 'The end time must be after the start time.',
  DOCUMENT_SOURCE: 'Upload a PDF or image, or paste a link to the document.',
  LINK_FORMAT: 'The link must start with https://',
  FILE_REQUIRED: 'Choose the PDF or image to upload.',
  FILE_TYPE: 'Upload a PDF, JPG or PNG.',
  FILE_TOO_LARGE: 'The file is larger than 20 MB.',
  NO_FILE: 'This lesson has no file yet.',
  MARKDOWN_REQUIRED: 'Write the card’s text.',
  QUESTIONS_REQUIRED: 'Add at least one question.',
  TOO_MANY_QUESTIONS: (max: number) => `A quiz can have at most ${max} questions.`,
  QUESTION_SHAPE: (n: number) =>
    `Question ${n} needs its text, 2 to 6 answers and the right answer picked.`,
  PASS_PERCENT: 'The pass mark must be between 1 and 100%.',
  ANSWERS_COUNT: 'Answer every question, then submit.',
  ATTEMPTS_TODAY: (max: number) =>
    `You’ve used today’s ${max} tries for this quiz. Read the explanations and try again tomorrow.`,
  ROLEPLAY_SHAPE:
    'Give the owner a name and shop, what the rep should know, and how the owner behaves.',
  ROLEPLAY_RUBRIC: 'Add 1 to 12 things the coach scores the pitch on.',
  ROLEPLAY_OFF: 'Practice with an AI owner isn’t switched on yet. Ask your sales head.',
  ROLEPLAY_DAILY_LIMIT: (max: number) =>
    `You’ve done today’s ${max} practice pitches. Come back tomorrow for more.`,
  ROLEPLAY_NOT_FOUND: 'We couldn’t find this practice pitch.',
  ROLEPLAY_FINISHED: 'This practice pitch is finished. Start a new one to try again.',
  ROLEPLAY_TOO_LONG: (max: number) =>
    `This pitch has reached ${max} messages. Finish it to get your score.`,
  ROLEPLAY_EMPTY: 'Say something to the owner first.',
  ROLEPLAY_UNAVAILABLE: 'The practice owner couldn’t answer just now. Please try again.',
} as const;

export const VERSION_ERROR = {
  NOT_FOUND: 'That version no longer exists.',
  EXISTS: (version: string) => `Version ${version} already exists.`,
  BAD_FORMAT: 'Version must look like 1.2.0 — three numbers separated by dots.',
  PART_TOO_LARGE: 'Minor and patch numbers must be below 1000.',
  MAJOR_TOO_LARGE: 'The major number must be below 2000.',
  NOTE_REQUIRED: 'Add the release note — upload a .md file or write it in.',
  NOTE_EMPTY: 'The release note can’t be empty.',
  FILE_TYPE: 'Upload a .md or .txt file.',
  FILE_TOO_LARGE: 'The file is larger than 512 KB.',
  FILE_EMPTY: 'That file is empty.',
} as const;
