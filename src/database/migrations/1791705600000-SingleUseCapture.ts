import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** `follow_ups.capture_token_hash`: a visit's capture token can be used once. */
export class SingleUseCapture1791705600000 implements MigrationInterface {
  name = 'SingleUseCapture1791705600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.SINGLE_USE_CAPTURE);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.SINGLE_USE_CAPTURE_DOWN);
  }
}
