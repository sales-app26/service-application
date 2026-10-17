import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Leads with no owner yet, assigned later (`12_unassigned_leads.sql`). */
export class UnassignedLeads1792396800000 implements MigrationInterface {
  name = 'UnassignedLeads1792396800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.UNASSIGNED_LEADS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.UNASSIGNED_LEADS_DOWN);
  }
}
