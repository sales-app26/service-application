import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketHandler, PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { ConsoleLogger, INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import { FakeAnthropic } from './fake-anthropic';
import { FakeGeocoder } from './fake-geocoder';
import { FakeSupabase } from './fake-supabase';
import { FakeYoutube } from './fake-youtube';

const JWT_SECRET = 'e2e-supabase-jwt-secret-at-least-32-characters-long';
const BUCKET = 'sales-tracker-e2e';
export const APP_URL = 'https://app.example.com';

export interface Harness {
  baseUrl: string;
  db: PGlite;
  supabase: FakeSupabase;
  /** OpenStreetMap's place lookups, faked: no test reaches the internet. */
  geocoder: FakeGeocoder;
  /** The Claude API, faked: practice pitches never reach the internet. */
  anthropic: FakeAnthropic;
  /** YouTube's playlist feed, faked. */
  youtube: FakeYoutube;
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
  serialiseSocketChunks();
  const db = await PGlite.create();
  for (const file of [
    '01_sales_schema.sql',
    '02_app_versions.sql',
    '03_user_deletion.sql',
    '04_single_use_capture.sql',
    '05_sales_insights.sql',
    '06_team_collaboration.sql',
    '07_visit_place.sql',
    '08_deal_terms.sql',
    '09_training.sql',
    '10_training_playlists.sql',
    '11_lead_business_name.sql',
    '12_unassigned_leads.sql',
    '13_lead_phone_optional.sql',
  ]) {
    await db.exec(readFileSync(join(__dirname, '../../src/database/sql', file), 'utf8'));
  }

  const pgServer = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 1 });
  await pgServer.start();
  const pgPort = Number(pgServer.getServerConn().split(':').pop());

  const supabase = new FakeSupabase(JWT_SECRET, BUCKET);
  await supabase.start();
  const geocoder = new FakeGeocoder();
  await geocoder.start();
  const anthropic = new FakeAnthropic();
  await anthropic.start();
  const youtube = new FakeYoutube();
  await youtube.start();

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
    // Mail goes to the fake's Brevo endpoint, never the real API, whatever .env holds.
    BREVO_API_KEY: 'e2e-brevo-key',
    BREVO_API_URL: supabase.url,
    MAIL_FROM_EMAIL: 'sales@example.com',
    // Place lookups go to the fake, never to OpenStreetMap, whatever .env holds.
    GEOCODER_ENABLED: 'true',
    GEOCODER_NOMINATIM_URL: geocoder.nominatimUrl,
    GEOCODER_PHOTON_URL: geocoder.photonUrl,
    GEOCODER_CONTACT: 'e2e@example.com',
    GEOCODER_TIMEOUT_MS: '1500',
    // Practice pitches go to the fake, never to the Claude API, whatever .env holds.
    ANTHROPIC_API_KEY: 'e2e-anthropic-key',
    ANTHROPIC_BASE_URL: anthropic.url,
    ROLEPLAY_MODEL: 'claude-opus-5-5',
    ROLEPLAY_DAILY_LIMIT: '3',
    ROLEPLAY_MAX_TURNS: '4',
    // Playlist lessons read their modules from the fake, never from YouTube.
    YOUTUBE_FEED_URL: youtube.url,
    YOUTUBE_API_KEY: youtube.apiKey,
    YOUTUBE_API_URL: youtube.apiUrl,
  });

  const stopBackends = async (): Promise<void> => {
    await youtube.stop();
    await anthropic.stop();
    await geocoder.stop();
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
      geocoder,
      anthropic,
      youtube,
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

/**
 * pglite-socket parses each TCP chunk in its own `setImmediate` without waiting for the
 * previous chunk to finish, and both read one shared reassembly buffer. When a query's
 * messages arrive in two chunks close together (the error-and-rollback path is the usual
 * one), the halves are processed twice or out of order and the client gets a reply it
 * never asked for ("Received unexpected parseComplete message"). Real PostgreSQL reads a
 * connection in order; so do we, by running one chunk at a time per connection.
 */
const serialiseSocketChunks = (): void => {
  const proto = PGLiteSocketHandler.prototype as unknown as {
    handleData(data: Buffer): Promise<number>;
    inOrder?: true;
  };
  if (proto.inOrder) return;
  const handleData = proto.handleData;
  const previous = new WeakMap<object, Promise<unknown>>();
  proto.handleData = function (this: object, data: Buffer): Promise<number> {
    const next = (previous.get(this) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => handleData.call(this, data));
    previous.set(this, next);
    return next;
  };
  proto.inOrder = true;
};

/** Keeps expected 4xx warnings out of the test output; errors still print. */
class QuietLogger extends ConsoleLogger {
  log(): void {}
  warn(): void {}
  debug(): void {}
  verbose(): void {}
}
