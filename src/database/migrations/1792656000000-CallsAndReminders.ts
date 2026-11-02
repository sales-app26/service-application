import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Field or Calling people, calls with recordings, and timed reminders (`15_calls_and_reminders.sql`). */
export class CallsAndReminders1792656000000 implements MigrationInterface {
  name = 'CallsAndReminders1792656000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.CALLS_AND_REMINDERS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.CALLS_AND_REMINDERS_DOWN);
  }
}
