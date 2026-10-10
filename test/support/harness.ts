import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { ConsoleLogger, INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { FakeSupabase } from './fake-supabase';

const JWT_SECRET = 'e2e-supabase-jwt-secret-at-least-32-characters-long';
const BUCKET = 'sales-tracker-e2e';
export const APP_URL = 'https://app.example.com';

export interface Harness {
  baseUrl: string;
  db: PGlite;
  supabase: FakeSupabase;
  superAdminId: string;
  close(): Promise<void>;
}

/**
 * Boots the real API against real PostgreSQL (PGlite over the wire protocol)
 * and a fake Supabase, with the schema applied from the same SQL file the
 * migration runs.
 *
 * PGlite is a single connection, so the pool is one connection too — which
 * also proves no code path asks for a second connection while holding a
 * transaction (it would hang here, and starve a busy pool in production).
 */
export const startHarness = async (): Promise<Harness> => {
  const db = await PGlite.create();
  for (const file of ['01_sales_schema.sql', '02_app_versions.sql']) {
    await db.exec(readFileSync(join(__dirname, '../../src/database/sql', file), 'utf8'));
  }

  const pgServer = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 1 });
  await pgServer.start();
  const pgPort = Number(pgServer.getServerConn().split(':').pop());

  const supabase = new FakeSupabase(JWT_SECRET, BUCKET);
  await supabase.start();

  const superAdminId = randomUUID();
  supabase.addUser('owner@pronttera.in', 'super-secret-1', superAdminId);
  await db.query(
    `INSERT INTO sales.users (id, name, email, role) VALUES ($1, 'Adeeb Shah', 'owner@pronttera.in', 'super_admin')`,
    [superAdminId],
  );

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
    DB_SSL: 'false',
    DB_POOL_MAX: '1',
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: 'anon-key-for-the-e2e-suite',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-the-e2e-suite',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    SUPABASE_STORAGE_BUCKET: BUCKET,
    CAPTURE_TOKEN_SECRET: 'e2e-capture-token-secret-at-least-32-chars',
    APP_URL,
    THROTTLE_LIMIT: '100000',
    SWAGGER_ENABLED: 'true',
  });

  const stopBackends = async (): Promise<void> => {
    await supabase.stop();
    await pgServer.stop();
    await db.close();
  };

  // Whatever fails from here on, the servers above must not outlive it: an
  // open socket keeps Jest running forever instead of reporting the failure.
  let app: NestExpressApplication | undefined;
  try {
    // Imported only now: ConfigModule validates the environment on import.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.setup');
    const { setupSwagger } = await import('../../src/config/swagger.setup');
    const { CONFIG_NAMESPACE } = await import('../../src/common/constants');
    const { ConfigService } = await import('@nestjs/config');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .setLogger(new QuietLogger())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    const config = app.get(ConfigService);
    configureApp(app, config.getOrThrow(CONFIG_NAMESPACE.APP));
    setupSwagger(
      app,
      config.getOrThrow(CONFIG_NAMESPACE.SWAGGER),
      config.getOrThrow(CONFIG_NAMESPACE.APP),
    );
    await app.listen(0, '127.0.0.1');

    const port = (app.getHttpServer().address() as AddressInfo).port;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      db,
      supabase,
      superAdminId,
      close: async () => {
        await (app as INestApplication).close();
        await stopBackends();
      },
    };
  } catch (error) {
    await app?.close().catch(() => undefined);
    await stopBackends();
    throw error;
  }
};

/** Keeps expected 4xx warnings out of the test output; errors still print. */
class QuietLogger extends ConsoleLogger {
  log(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
