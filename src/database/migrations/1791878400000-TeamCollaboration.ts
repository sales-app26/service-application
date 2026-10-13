import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Leave and cover, lead comments and help requests, notifications and message templates. */
export class TeamCollaboration1791878400000 implements MigrationInterface {
  name = 'TeamCollaboration1791878400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TEAM_COLLABORATION);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TEAM_COLLABORATION_DOWN);
  }
}
