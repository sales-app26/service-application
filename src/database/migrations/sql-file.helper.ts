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
