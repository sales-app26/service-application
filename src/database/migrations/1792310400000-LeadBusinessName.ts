import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** The person's name on a lead becomes optional; the business name leads (`11_lead_business_name.sql`). */
export class LeadBusinessName1792310400000 implements MigrationInterface {
  name = 'LeadBusinessName1792310400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.LEAD_BUSINESS_NAME);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.LEAD_BUSINESS_NAME_DOWN);
  }
}
