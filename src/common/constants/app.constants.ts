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
  HEALTH: 'health',
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

export const SUCCESS_MESSAGE = {
  CREATED: 'Created successfully.',
  UPDATED: 'Updated successfully.',
  DELETED: 'Deleted successfully.',
  FETCHED: 'Fetched successfully.',
  LOGGED_IN: 'Signed in.',
  LOGGED_OUT: 'Signed out.',
  TOKEN_REFRESHED: 'Session refreshed.',
  /** Same text whether or not the email exists, so emails cannot be guessed. */
  RESET_LINK_SENT: 'If an account exists for this email, a reset link has been sent.',
  PASSWORD_SET: 'Password saved. You can sign in now.',
  PASSWORD_CHANGED: 'Password changed.',
  USER_CREATED: 'User created. An email has been sent to set the password.',
  USER_DEACTIVATED: 'User deactivated.',
  USER_REACTIVATED: 'User reactivated.',
  PROJECT_CLOSED: 'Project closed. It is now read-only.',
  PROJECT_REOPENED: 'Project reopened.',
  MEMBER_ADDED: 'Member added to the project.',
  MEMBER_REMOVED: 'Member removed from the project.',
  TARGET_UPDATED: 'Target updated.',
  JOINED_PROJECT: 'Project assigned to you.',
  LEADS_IMPORTED: 'Leads imported.',
  LEADS_IMPORT_CHECKED: 'File checked. Nothing has been imported yet.',
  LEAD_CREATED: 'Lead saved.',
  FOLLOW_UP_LOGGED: 'Follow-up saved.',
  STATUS_CHANGED: 'Status changed.',
  TRANSFER_REQUESTED: 'Transfer requested. It moves once an admin approves it.',
  TRANSFER_APPROVED: 'Transfer approved.',
  TRANSFER_REJECTED: 'Transfer rejected.',
  LEADS_REASSIGNED: 'Leads reassigned.',
  NOTHING_LOGGED: 'Nothing logged on this day.',
  NO_DATA: 'No data for these dates.',
  NO_PROJECTS: 'You are not assigned to any project yet.',
} as const;
