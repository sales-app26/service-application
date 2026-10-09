import { DB_SCHEMA } from '../common/constants';
import { dataSource } from './data-source';

/**
 * `npm run migration:run`.
 *
 * A thin wrapper over TypeORM's runner for one reason: TypeORM creates its
 * `typeorm_migrations` table in the DataSource schema (`sales`) *before* the
 * first migration runs, and does not create the schema itself. So the schema
 * is created here first; the migrations do the rest.
 */
async function run(): Promise<void> {
  await dataSource.initialize();
  try {
    await dataSource.query(`CREATE SCHEMA IF NOT EXISTS ${DB_SCHEMA}`);
    const applied = await dataSource.runMigrations({ transaction: 'each' });

    if (applied.length === 0) {
      console.warn(`Schema "${DB_SCHEMA}" is up to date.`);
    }
    for (const migration of applied) {
      console.warn(`Applied ${migration.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: Error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
