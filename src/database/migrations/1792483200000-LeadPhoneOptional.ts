import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** A lead's phone becomes optional, for sheets of shops with no number yet (`13_lead_phone_optional.sql`). */
export class LeadPhoneOptional1792483200000 implements MigrationInterface {
  name = 'LeadPhoneOptional1792483200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.LEAD_PHONE_OPTIONAL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.LEAD_PHONE_OPTIONAL_DOWN);
  }
}
