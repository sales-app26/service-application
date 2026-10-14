import { MigrationInterface, QueryRunner } from 'typeorm';

import { runSqlFile, SQL_FILE } from './sql-file.helper';

/** YouTube playlist lessons, the App tutorial step, per-module progress (`10_training_playlists.sql`). */
export class TrainingPlaylists1792224000000 implements MigrationInterface {
  name = 'TrainingPlaylists1792224000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TRAINING_PLAYLISTS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.TRAINING_PLAYLISTS_DOWN);
  }
}
