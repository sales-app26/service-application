import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/**
 * Release notes (`app_versions`) and the read receipts against them
 * (`app_version_views`). The file is idempotent, so a database where it was
 * already applied by hand in the Supabase SQL editor is left as it is.
 */
export class AppVersions1791532800000 implements MigrationInterface {
  name = 'AppVersions1791532800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.APP_VERSIONS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.APP_VERSIONS_DOWN);
  }
}
