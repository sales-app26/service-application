import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Where a visit photo was taken, in words: follow_ups.place_name. */
export class VisitPlace1791964800000 implements MigrationInterface {
  name = 'VisitPlace1791964800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.VISIT_PLACE);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.VISIT_PLACE_DOWN);
  }
}
