export const SWAGGER_SECURITY = {
  BEARER: 'bearer',
} as const;

export const SWAGGER_TAG = {
  HEALTH: 'Health',
  AUTH: 'Auth',
  USERS: 'Users',
  PROJECTS: 'Projects',
  MEMBERS: 'Project members & targets',
  LOCATIONS: 'Locations',
  LEADS: 'Leads',
  ENTRIES: 'Follow-ups & entries',
  VISITS: 'Visit proof',
  TRANSFERS: 'Lead transfers',
  ME: 'My work',
  TIMELINE: 'Timeline',
  DASHBOARD: 'Dashboard',
  EXPORTS: 'Exports',
} as const;

export const SWAGGER_TAG_DESCRIPTION: Record<string, string> = {
  [SWAGGER_TAG.HEALTH]: 'Liveness and database reachability.',
  [SWAGGER_TAG.AUTH]: 'Email and password sign-in through Supabase Auth.',
  [SWAGGER_TAG.USERS]: 'Moderators and sales persons. Deactivated, never deleted.',
  [SWAGGER_TAG.PROJECTS]: 'Online and door-to-door projects. Closed, never deleted.',
  [SWAGGER_TAG.MEMBERS]: 'Who works in a project, and their conversion target.',
  [SWAGGER_TAG.LOCATIONS]: 'Per-project location autocomplete.',
  [SWAGGER_TAG.LEADS]: 'Clients, one owner each, unique by phone within a project.',
  [SWAGGER_TAG.ENTRIES]: 'Follow-ups and manual status changes — the lead history.',
  [SWAGGER_TAG.VISITS]: 'Live photo + GPS proof for door-to-door follow-ups.',
  [SWAGGER_TAG.TRANSFERS]: 'Handing a lead to another member, with approval.',
  [SWAGGER_TAG.ME]: 'The signed-in member’s home screen, Due today and targets.',
  [SWAGGER_TAG.TIMELINE]: 'One person’s day, in time order, with photos and map pins.',
  [SWAGGER_TAG.DASHBOARD]: 'Admin numbers: targets, activity, statuses, conversions.',
  [SWAGGER_TAG.EXPORTS]: 'CSV exports for the current filters.',
};

export const SWAGGER_RESPONSE = {
  OK: 'Success.',
  CREATED: 'Created.',
  BAD_REQUEST: 'Validation failed.',
  UNAUTHORIZED: 'Missing, invalid or expired token, or a deactivated account.',
  FORBIDDEN: 'The role or project scope does not allow this.',
  NOT_FOUND: 'The record does not exist or is not visible to the caller.',
  CONFLICT: 'A uniqueness or state conflict.',
  UNPROCESSABLE: 'A business rule refused the request.',
  TOO_MANY_REQUESTS: 'Rate limit exceeded.',
  INTERNAL: 'Unexpected server error.',
} as const;

export const SWAGGER_EXAMPLE = {
  UUID: '3f1c2a5e-8b0d-4c5e-9a71-2d6f0b8e4c11',
  TIMESTAMP: '2026-10-08T09:30:00.000Z',
  DATE: '2026-10-08',
  EMAIL: 'ravi.kumar@example.com',
  PHONE: '9876543210',
  PAGE: 1,
  LIMIT: 20,
  TOTAL: 134,
} as const;

export const SWAGGER_PARAM_DESCRIPTION = {
  ID: 'Record id (UUID v4).',
  PAGE: 'Page number, starting at 1.',
  LIMIT: 'Records per page.',
  SEARCH: 'Free-text search.',
} as const;
