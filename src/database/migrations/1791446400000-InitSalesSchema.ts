import { MigrationInterface, QueryRunner } from 'typeorm';

import { TABLE } from '../../common/constants';
import { runSqlFile, SQL_FILE, tableExists } from './sql-file.helper';

/** The seven version-1 tables (DB Design §2) and their rules (§3) and indexes (§4). */
export class InitSalesSchema1791446400000 implements MigrationInterface {
  name = 'InitSalesSchema1791446400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await tableExists(queryRunner, TABLE.USERS)) {
      return;
    }
    await runSqlFile(queryRunner, SQL_FILE.SALES_SCHEMA);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await runSqlFile(queryRunner, SQL_FILE.SALES_SCHEMA_DOWN);
  }
}
