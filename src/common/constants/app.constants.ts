/** Route segments. Controllers compose paths from these, never from literals. */
export const ROUTE = {
  AUTH: 'auth',
  USERS: 'users',
  PROJECTS: 'projects',
  LEADS: 'leads',
  ENTRIES: 'entries',
  TRANSFERS: 'transfers',
  VISITS: 'visits',
  ME: 'me',
  TIMELINE: 'timeline',
  DASHBOARD: 'dashboard',
  EXPORTS: 'exports',
  VERSIONS: 'versions',
  HEALTH: 'health',
  LEAVES: 'leaves',
  COMMENTS: 'comments',
  NOTIFICATIONS: 'notifications',
  TEMPLATES: 'templates',
  TEAM: 'team',
  GEO: 'geo',
  ID_PARAM: ':id',
} as const;

export const ROUTE_PARAM = {
  ID: 'id',
  PROJECT_ID: 'projectId',
  LEAD_ID: 'leadId',
  USER_ID: 'userId',
} as const;

export const METADATA_KEY = {
  IS_PUBLIC: 'isPublic',
  ROLES: 'roles',
  RESPONSE_MESSAGE: 'responseMessage',
  SKIP_RESPONSE_WRAPPER: 'skipResponseWrapper',
} as const;

export const HTTP_HEADER = {
  AUTHORIZATION: 'authorization',
  REQUEST_ID: 'x-request-id',
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  /** PRD §8: lists load 20 items at a time. */
  DEFAULT_LIMIT: 20,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
} as const;

export const SORT_ORDER = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;

export type SortDirection = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/** India time. Every "today", week and month in the product is measured here. */
export const TIME_ZONE = 'Asia/Kolkata';

/** Multipart field names. */
export const UPLOAD_FIELD = {
  PHOTO: 'photo',
  IMAGE: 'image',
  FILE: 'file',
} as const;

export const MIME_TYPE = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  CSV: 'text/csv; charset=utf-8',
} as const;

/**
 * The toast after a successful action. Short, in sales words: campaign, team,
 * handover, follow-up, won — never "record", "entity" or "resource".
 */
export const SUCCESS_MESSAGE = {
  CREATED: 'Saved.',
  UPDATED: 'Changes saved.',
  DELETED: 'Removed.',
  FETCHED: 'Done.',
  LOGGED_IN: 'Signed in.',
  LOGGED_OUT: 'Signed out.',
  TOKEN_REFRESHED: 'Still signed in.',
  /** Same text whether or not the email exists, so emails cannot be guessed. */
  RESET_LINK_SENT: 'If this email is on the team, a reset link is on its way.',
  PASSWORD_SET: 'Password saved. You can sign in now.',
  PASSWORD_CHANGED: 'Password changed.',
  USER_CREATED: 'Added to the team. We’ve emailed them an invite to set a password.',
  USER_DEACTIVATED: 'Removed from the team.',
  USER_REACTIVATED: 'Back on the team.',
  USER_DELETED: 'Person deleted.',
  RESET_LINK_CREATED: 'Reset link ready. Share it only with this person.',
  RESET_EMAIL_SENT: 'Reset email sent.',
  PROJECT_CLOSED: 'Campaign closed. It can still be viewed, but not changed.',
  PROJECT_REOPENED: 'Campaign reopened.',
  MEMBER_ADDED: 'Added to the campaign team.',
  MEMBER_REMOVED: 'Removed from the campaign team.',
  TARGET_UPDATED: 'Target updated.',
  LEADS_IMPORTED: 'Leads added.',
  LEADS_IMPORT_CHECKED: 'Sheet checked. No leads added yet.',
  LEAD_CREATED: 'Lead saved.',
  FOLLOW_UP_LOGGED: 'Follow-up saved.',
  STATUS_CHANGED: 'Stage updated.',
  TRANSFER_REQUESTED: 'Handover requested. The lead moves once a manager approves it.',
  TRANSFER_APPROVED: 'Handover approved.',
  TRANSFER_REJECTED: 'Handover rejected.',
  LEADS_REASSIGNED: 'Leads assigned.',
  LEAVE_SAVED: 'Leave saved.',
  LEAVE_CANCELLED: 'Leave cancelled.',
  BACKUP_UPDATED: 'Backup updated.',
  COMMENT_SAVED: 'Note saved.',
  COMMENT_DELETED: 'Note deleted.',
  HELP_REQUESTED: 'Your sales managers have been asked for help.',
  HELP_RESOLVED: 'Help request resolved.',
  NOTIFICATIONS_READ: 'Marked as read.',
  LEAD_REQUESTED: 'Request sent. The lead moves to you once a manager approves it.',
  TEMPLATE_SAVED: 'Ready message saved.',
  NOTHING_LOGGED: 'No activity on this day.',
  NO_DATA: 'No sales activity for these dates.',
  NO_PROJECTS: 'You’re not on any campaign yet. Your sales manager will add you.',
} as const;

/** The `detail` line of each Sales overview "Needs attention" item. */
export const ATTENTION_DETAIL = {
  BEHIND_TARGET: (achieved: number, target: number, period: string, elapsedPercent: number) =>
    `${achieved} of ${target} deals won with ${elapsedPercent}% of the ${period} gone.`,
  OVERDUE_PILE: (count: number) => `${count} leads overdue for a follow-up.`,
  IDLE: (days: number) => `No activity for ${days} days.`,
  IDLE_NEVER: (days: number) => `No activity since joining ${days} days ago.`,
  STALE_TRANSFER: (lead: string, to: string, hours: number) =>
    `Handover of ${lead} to ${to} waiting ${hours} hours.`,
  HELP_REQUEST: (lead: string) => `Asked for help on ${lead}`,
} as const;

/** Where a notification opens in the portal. Paths, never full URLs. */
export const NOTIFICATION_LINK = {
  HOME: '/home',
  TRANSFERS: '/transfers',
  LEADS: '/leads',
  LEAD: (leadId: string) => `/leads/${leadId}`,
  DAY: (date: string) => `/day?date=${date}`,
} as const;

/** The title and body lines of each in-app notification. */
export const NOTIFICATION_TEXT = {
  LEAVE_COVER_TITLE: (name: string, span: string) => `${name} is on leave ${span}`,
  LEAVE_COVER_BODY: (projects: string) => `You're covering their follow-ups in ${projects}.`,
  MENTION_TITLE: (actor: string, lead: string) => `${actor} mentioned you on ${lead}`,
  COMMENT_TITLE: (actor: string, lead: string) => `${actor} left a note on ${lead}`,
  FEEDBACK_TITLE: (actor: string, lead: string) =>
    `${actor} left feedback on your follow-up with ${lead}`,
  HELP_REQUESTED_TITLE: (actor: string, lead: string) => `${actor} asked for help on ${lead}`,
  HELP_RESOLVED_TITLE: (actor: string, lead: string) =>
    `${actor} resolved your help request on ${lead}`,
  TRANSFER_REQUESTED_TITLE: (actor: string, lead: string, to: string) =>
    `${actor} asked to hand over ${lead} to ${to}`,
  LEAD_REQUESTED_TITLE: (actor: string, lead: string) => `${actor} asked for ${lead}`,
  TRANSFER_APPROVED_TITLE: (actor: string, lead: string, to: string) =>
    `${actor} approved the handover of ${lead} to ${to}`,
  TRANSFER_REJECTED_TITLE: (actor: string, lead: string, to: string) =>
    `${actor} rejected the handover of ${lead} to ${to}`,
  LEAD_ASSIGNED_TITLE: (actor: string, lead: string) => `${actor} assigned ${lead} to you`,
  LEADS_ASSIGNED_TITLE: (actor: string, count: number, project: string) =>
    `${actor} assigned ${count} leads in ${project} to you`,
} as const;
