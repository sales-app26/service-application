import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** `users.deleted_at`: a deleted user's row stays, anonymised, for their history. */
export class UserDeletion1791619200000 implements MigrationInterface {
  name = 'UserDeletion1791619200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.USER_DELETION);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.USER_DELETION_DOWN);
  }
}
