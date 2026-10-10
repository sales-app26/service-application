/**
 * The Postgres schema every table lives in. Not `public`: the Supabase project
 * is shared, and `public` is what PostgREST exposes by default.
 *
 * Fixed rather than configurable because `01_sales_schema.sql` names it.
 */
export const DB_SCHEMA = 'sales';

/** Table names, one-for-one with `01_sales_schema.sql` (DB Design §2). */
export const TABLE = {
  USERS: 'users',
  PROJECTS: 'projects',
  PROJECT_MEMBERS: 'project_members',
  LOCATIONS: 'locations',
  LEADS: 'leads',
  FOLLOW_UPS: 'follow_ups',
  LEAD_TRANSFERS: 'lead_transfers',
  APP_VERSIONS: 'app_versions',
  APP_VERSION_VIEWS: 'app_version_views',
} as const;

/**
 * Schema-qualified names for hand-written SQL. Entities get the schema from
 * the DataSource; raw queries must not depend on `search_path`, which
 * Supabase's transaction pooler does not carry between statements.
 */
export const SQL_TABLE = Object.fromEntries(
  Object.entries(TABLE).map(([key, name]) => [key, `${DB_SCHEMA}.${name}`]),
) as { readonly [K in keyof typeof TABLE]: `${typeof DB_SCHEMA}.${(typeof TABLE)[K]}` };

/** PostgreSQL column types used by the entities. */
export const PG_TYPE = {
  UUID: 'uuid',
  TEXT: 'text',
  BOOLEAN: 'boolean',
  INTEGER: 'integer',
  NUMERIC: 'numeric',
  DATE: 'date',
  TIMESTAMPTZ: 'timestamptz',
} as const;

export const SQL_DEFAULT = {
  NOW: 'now()',
} as const;

/**
 * Constraint names the exception filter and services recognise, so a race
 * that slips past an application check still reads as the business rule it
 * broke rather than a generic conflict.
 */
export const DB_CONSTRAINT = {
  USERS_EMAIL: 'users_email_key',
  LEADS_PROJECT_PHONE: 'leads_project_phone_key',
  LOCATIONS_PROJECT_NAME: 'locations_project_name_key',
  FOLLOW_UPS_CLIENT_REQUEST: 'follow_ups_client_request_id_key',
  LEAD_TRANSFERS_ONE_PENDING: 'lead_transfers_one_pending_per_lead',
  PROJECT_MEMBERS_PROJECT_USER: 'project_members_project_user_key',
  APP_VERSIONS_VERSION: 'app_versions_version_key',
} as const;
