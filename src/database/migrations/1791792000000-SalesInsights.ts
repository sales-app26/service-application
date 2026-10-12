import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Deal value, plan, source, creator and last activity on leads; lost reasons on entries. */
export class SalesInsights1791792000000 implements MigrationInterface {
  name = 'SalesInsights1791792000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.SALES_INSIGHTS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.SALES_INSIGHTS_DOWN);
  }
}
