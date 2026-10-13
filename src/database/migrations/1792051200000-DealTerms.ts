import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Plan, tenure, discount and offer on a deal; plan prices and offers (`08_deal_terms.sql`). */
export class DealTerms1792051200000 implements MigrationInterface {
  name = 'DealTerms1792051200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.DEAL_TERMS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.DEAL_TERMS_DOWN);
  }
}
