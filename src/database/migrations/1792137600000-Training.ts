import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** Courses, lessons, progress, practice pitches and certificates (`09_training.sql`). */
export class Training1792137600000 implements MigrationInterface {
  name = 'Training1792137600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TRAINING);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TRAINING_DOWN);
  }
}
