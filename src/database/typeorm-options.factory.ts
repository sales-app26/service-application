import { DataSourceOptions } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { DB_SCHEMA } from '../common/constants';
import { AppConfig, DatabaseConfig } from '../config/configuration';
import { ALL_ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

/** TypeORM's own bookkeeping table for applied migrations. */
export const MIGRATIONS_TABLE_NAME = 'typeorm_migrations';

/** Shows up in `pg_stat_activity`, which makes Supabase dashboards readable. */
const APPLICATION_NAME = 'sales-tracker-api';

/**
 * Builds the TypeORM connection options, shared by the Nest runtime and the
 * CLI (`data-source.ts`) so migrations and the API can never drift apart.
 *
 * Supabase notes:
 *  - Its certificate is not in Node's default CA bundle, so
 *    `rejectUnauthorized` defaults to false. TLS is still negotiated.
 *  - Port 5432 (session pooler) is required for migrations; 6543 (transaction
 *    pooler) is right for the running API.
 *  - `synchronize` is hard-wired off. The SQL file is authoritative.
 *  - Everything lives in the `sales` schema, never `public`.
 */
export const buildTypeOrmOptions = (
  database: DatabaseConfig,
  app: Pick<AppConfig, 'isProduction'>,
  options: { preferDirectConnection?: boolean } = {},
): DataSourceOptions => {
  const ssl = database.ssl ? { rejectUnauthorized: database.sslRejectUnauthorized } : false;

  const base = {
    type: 'postgres',
    // Entities and TypeORM's migrations table both live in `sales`.
    schema: DB_SCHEMA,
    entities: ALL_ENTITIES,
    migrations: MIGRATIONS,
    migrationsTableName: MIGRATIONS_TABLE_NAME,
    migrationsRun: database.migrationsRun,
    synchronize: false,
    logging: database.logging ? ['query', 'error', 'warn', 'migration'] : ['error', 'migration'],
    ssl,
    extra: {
      max: database.poolMax,
      idleTimeoutMillis: database.poolIdleTimeoutMs,
      connectionTimeoutMillis: database.connectionTimeoutMs,
      statement_timeout: database.statementTimeoutMs,
      application_name: APPLICATION_NAME,
      ssl,
    },
    // A dropped Supabase connection should not take the process down with it.
    poolErrorHandler: (error: Error): void => {
      console.error('[typeorm] postgres pool error:', error.message);
    },
    installExtensions: false,
    maxQueryExecutionTime: app.isProduction ? 5_000 : 1_000,
  } satisfies Partial<PostgresConnectionOptions> & Record<string, unknown>;

  const connectionUrl =
    options.preferDirectConnection && database.directUrl ? database.directUrl : database.url;

  if (connectionUrl) {
    return { ...base, url: connectionUrl } as DataSourceOptions;
  }

  return {
    ...base,
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.database,
  } as DataSourceOptions;
};
