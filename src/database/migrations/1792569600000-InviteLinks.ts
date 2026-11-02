import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Invite links of our own, which don't expire and can be sent again (`14_invite_links.sql`). */
export class InviteLinks1792569600000 implements MigrationInterface {
  name = 'InviteLinks1792569600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.INVITE_LINKS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.INVITE_LINKS_DOWN);
  }
}
