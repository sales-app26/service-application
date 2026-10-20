import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryRunner } from 'typeorm';

import { DB_SCHEMA } from '../../common/constants';

/**
 * Migrations replay the authoritative `.sql` files rather than generating DDL
 * from entity metadata: partial unique indexes, composite same-project foreign
 * keys and the CHECK constraints are the rules, and they live in SQL.
 *
 * The files are copied into `dist/database/sql` by the `assets` entry in
 * nest-cli.json, so `__dirname` resolves under both ts-node and the build.
 */
const SQL_DIRECTORY = join(__dirname, '..', 'sql');

export const SQL_FILE = {
  SALES_SCHEMA: '01_sales_schema.sql',
  SALES_SCHEMA_DOWN: '01_sales_schema_down.sql',
  APP_VERSIONS: '02_app_versions.sql',
  APP_VERSIONS_DOWN: '02_app_versions_down.sql',
  USER_DELETION: '03_user_deletion.sql',
  USER_DELETION_DOWN: '03_user_deletion_down.sql',
  SINGLE_USE_CAPTURE: '04_single_use_capture.sql',
  SINGLE_USE_CAPTURE_DOWN: '04_single_use_capture_down.sql',
  SALES_INSIGHTS: '05_sales_insights.sql',
  SALES_INSIGHTS_DOWN: '05_sales_insights_down.sql',
  TEAM_COLLABORATION: '06_team_collaboration.sql',
  TEAM_COLLABORATION_DOWN: '06_team_collaboration_down.sql',
  VISIT_PLACE: '07_visit_place.sql',
  VISIT_PLACE_DOWN: '07_visit_place_down.sql',
  DEAL_TERMS: '08_deal_terms.sql',
  DEAL_TERMS_DOWN: '08_deal_terms_down.sql',
  TRAINING: '09_training.sql',
  TRAINING_DOWN: '09_training_down.sql',
  TRAINING_PLAYLISTS: '10_training_playlists.sql',
  TRAINING_PLAYLISTS_DOWN: '10_training_playlists_down.sql',
  LEAD_BUSINESS_NAME: '11_lead_business_name.sql',
  LEAD_BUSINESS_NAME_DOWN: '11_lead_business_name_down.sql',
  UNASSIGNED_LEADS: '12_unassigned_leads.sql',
  UNASSIGNED_LEADS_DOWN: '12_unassigned_leads_down.sql',
  LEAD_PHONE_OPTIONAL: '13_lead_phone_optional.sql',
  LEAD_PHONE_OPTIONAL_DOWN: '13_lead_phone_optional_down.sql',
} as const;

export const readSqlFile = (fileName: string): string =>
  readFileSync(join(SQL_DIRECTORY, fileName), 'utf-8');

/**
 * Runs a whole `.sql` file in one round trip. With no parameters node-postgres
 * uses the simple query protocol, which accepts multiple statements.
 */
export const runSqlFile = async (queryRunner: QueryRunner, fileName: string): Promise<void> => {
  await queryRunner.query(readSqlFile(fileName));
};

/**
 * TRUE when the table already exists in the `sales` schema — makes the schema
 * migration a no-op on a database where the file was applied by hand in the
 * Supabase SQL editor.
 */
export const tableExists = async (queryRunner: QueryRunner, table: string): Promise<boolean> => {
  const rows = (await queryRunner.query('SELECT to_regclass($1) AS oid', [
    `${DB_SCHEMA}.${table}`,
  ])) as Array<{ oid: string | null }>;

  return rows.length > 0 && rows[0].oid !== null;
};
