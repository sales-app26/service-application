import { config as loadDotenv } from 'dotenv';
import { DataSource } from 'typeorm';

import { appConfig, databaseConfig } from '../config/configuration';
import { buildTypeOrmOptions } from './typeorm-options.factory';

/**
 * DataSource for the TypeORM CLI and standalone scripts (`migration:run`,
 * `db:seed`). The Nest app builds its options from `ConfigService` through the
 * same factory, so both share one definition of "how we connect".
 *
 * `preferDirectConnection` routes these scripts to `DIRECT_URL` (session
 * pooler, 5432): migrations take an advisory lock and run multi-statement DDL,
 * neither of which survives the transaction pooler.
 */
loadDotenv({ path: process.env.ENV_FILE });

export const dataSource = new DataSource(
  buildTypeOrmOptions(databaseConfig(), appConfig(), { preferDirectConnection: true }),
);
