import { registerAs } from '@nestjs/config';

import {
  BUSINESS_RULE,
  CONFIG_DEFAULT,
  CONFIG_NAMESPACE,
  ENV,
  NODE_ENVIRONMENT,
  NodeEnvironment,
} from '../common/constants';

/**
 * Typed configuration namespaces.
 *
 * Nothing outside this file reads `process.env`. Values are parsed once, here,
 * and consumed everywhere else through `ConfigService.getOrThrow<T>()`.
 */

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') {
    return fallback;
  }
  return value.toLowerCase() === 'true' || value === '1';
};

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback;
};

const toList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/u, '');

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  isProduction: boolean;
  isDevelopment: boolean;
  port: number;
  name: string;
  apiPrefix: string;
  apiVersion: string;
  corsOrigins: string[] | boolean;
  bodyLimit: string;
  throttleTtlSeconds: number;
  throttleLimit: number;
  /**
   * The web app. Used for the photo link in a CSV export, which has to open
   * a screen that asks for login (PRD §5.12) rather than a raw storage URL.
   */
  appUrl: string;
}

export const appConfig = registerAs(CONFIG_NAMESPACE.APP, (): AppConfig => {
  const nodeEnv = (process.env[ENV.NODE_ENV] ?? NODE_ENVIRONMENT.DEVELOPMENT) as NodeEnvironment;
  const origins = toList(process.env[ENV.CORS_ORIGINS]);

  return {
    nodeEnv,
    isProduction: nodeEnv === NODE_ENVIRONMENT.PRODUCTION,
    isDevelopment: nodeEnv === NODE_ENVIRONMENT.DEVELOPMENT,
    port: toNumber(process.env[ENV.PORT], CONFIG_DEFAULT.PORT),
    name: process.env[ENV.APP_NAME] ?? 'Pronttera Sales API',
    apiPrefix: process.env[ENV.API_PREFIX] ?? 'api',
    apiVersion: process.env[ENV.API_VERSION] ?? 'v1',
    corsOrigins: origins.includes('*') || origins.length === 0 ? true : origins,
    bodyLimit: process.env[ENV.BODY_LIMIT] ?? '1mb',
    throttleTtlSeconds: toNumber(process.env[ENV.THROTTLE_TTL_SECONDS], 60),
    throttleLimit: toNumber(process.env[ENV.THROTTLE_LIMIT], 120),
    appUrl: withoutTrailingSlash(process.env[ENV.APP_URL] ?? ''),
  };
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface DatabaseConfig {
  /** Transaction-mode pooler (6543 on Supabase). Used by the running API. */
  url?: string;
  /** Session-mode pooler (5432). Used by migrations and seeds only. */
  directUrl?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
  poolMax: number;
  poolIdleTimeoutMs: number;
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  logging: boolean;
  migrationsRun: boolean;
}

export const databaseConfig = registerAs(CONFIG_NAMESPACE.DATABASE, (): DatabaseConfig => {
  const url = process.env[ENV.DATABASE_URL];
  const directUrl = process.env[ENV.DIRECT_URL];

  return {
    url: url && url.length > 0 ? url : undefined,
    directUrl: directUrl && directUrl.length > 0 ? directUrl : undefined,
    host: process.env[ENV.DB_HOST] ?? 'localhost',
    port: toNumber(process.env[ENV.DB_PORT], 5432),
    username: process.env[ENV.DB_USERNAME] ?? 'postgres',
    password: process.env[ENV.DB_PASSWORD] ?? '',
    database: process.env[ENV.DB_NAME] ?? 'postgres',
    ssl: toBoolean(process.env[ENV.DB_SSL], true),
    sslRejectUnauthorized: toBoolean(process.env[ENV.DB_SSL_REJECT_UNAUTHORIZED], false),
    poolMax: toNumber(process.env[ENV.DB_POOL_MAX], 15),
    poolIdleTimeoutMs: toNumber(process.env[ENV.DB_POOL_IDLE_TIMEOUT_MS], 30_000),
    connectionTimeoutMs: toNumber(process.env[ENV.DB_CONNECTION_TIMEOUT_MS], 20_000),
    statementTimeoutMs: toNumber(process.env[ENV.DB_STATEMENT_TIMEOUT_MS], 30_000),
    logging: toBoolean(process.env[ENV.DB_LOGGING], false),
    migrationsRun: toBoolean(process.env[ENV.DB_MIGRATIONS_RUN], false),
  };
});

// ---------------------------------------------------------------------------
// Supabase (Auth + Storage)
// ---------------------------------------------------------------------------

export interface SupabaseConfig {
  /** `https://<ref>.supabase.co` */
  url: string;
  /** Publishable / anon key. Sent as `apikey` on the user-facing Auth calls. */
  anonKey: string;
  /** Server-only. Creates users, changes emails, signs photo URLs. */
  serviceRoleKey: string;
  /**
   * Legacy HS256 signing secret. Blank means the project signs with
   * asymmetric keys and tokens are checked against its published JWKS.
   */
  jwtSecret: string;
  /** Private bucket for visit photos and project images. */
  storageBucket: string;
  timeoutMs: number;
}

export const supabaseConfig = registerAs(CONFIG_NAMESPACE.SUPABASE, (): SupabaseConfig => ({
  url: withoutTrailingSlash(process.env[ENV.SUPABASE_URL] ?? ''),
  anonKey: process.env[ENV.SUPABASE_ANON_KEY] ?? '',
  serviceRoleKey: process.env[ENV.SUPABASE_SERVICE_ROLE_KEY] ?? '',
  jwtSecret: process.env[ENV.SUPABASE_JWT_SECRET] ?? '',
  storageBucket: process.env[ENV.SUPABASE_STORAGE_BUCKET] ?? 'sales-tracker',
  timeoutMs: toNumber(process.env[ENV.SUPABASE_TIMEOUT_MS], 10_000),
}));

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export interface MailConfig {
  /** Brevo transactional API key: the only thing that sends invite and reset emails. */
  brevoApiKey: string;
  /** Brevo API origin; overridden only by the e2e suite. */
  brevoApiUrl: string;
  fromEmail: string;
  fromName: string;
}

export const mailConfig = registerAs(CONFIG_NAMESPACE.MAIL, (): MailConfig => ({
  brevoApiKey: process.env[ENV.BREVO_API_KEY] ?? '',
  brevoApiUrl: withoutTrailingSlash(process.env[ENV.BREVO_API_URL] ?? 'https://api.brevo.com'),
  fromEmail: process.env[ENV.MAIL_FROM_EMAIL] ?? '',
  fromName: process.env[ENV.MAIL_FROM_NAME] ?? 'Pronttera Sales',
}));

// ---------------------------------------------------------------------------
// Visit proof
// ---------------------------------------------------------------------------

export interface VisitConfig {
  /** Signs the capture token that starts the 10-minute photo window. */
  captureTokenSecret: string;
  captureWindowMinutes: number;
  /** PRD §5.7: photos load through short-lived links. */
  signedUrlTtlSeconds: number;
}

export const visitConfig = registerAs(CONFIG_NAMESPACE.VISIT, (): VisitConfig => ({
  captureTokenSecret: process.env[ENV.CAPTURE_TOKEN_SECRET] ?? '',
  captureWindowMinutes: BUSINESS_RULE.CAPTURE_WINDOW_MINUTES,
  signedUrlTtlSeconds: toNumber(process.env[ENV.SIGNED_URL_TTL_SECONDS], 600),
}));

// ---------------------------------------------------------------------------
// Place names (OpenStreetMap)
// ---------------------------------------------------------------------------

export interface GeoConfig {
  /** FALSE turns place names off: visits save without one, the lookup answers null. */
  enabled: boolean;
  /**
   * Who to contact about our traffic, sent in the User-Agent as Nominatim's usage
   * policy asks (an email or a web page). Optional, but set it in production.
   */
  contact: string;
  /** Nominatim (primary). Overridden by the tests so they never touch the internet. */
  nominatimUrl: string;
  /** Photon by komoot (fallback). */
  photonUrl: string;
  /** The whole lookup, queue wait and fallback included, gives up after this. */
  timeoutMs: number;
  /** At most one request per this many milliseconds to each service (Nominatim: 1/s). */
  minIntervalMs: number;
  /** In-memory cache of looked-up places, keyed by position rounded to ~11 m. */
  cacheSize: number;
  cacheTtlMs: number;
}

export const geoConfig = registerAs(CONFIG_NAMESPACE.GEO, (): GeoConfig => ({
  enabled: toBoolean(process.env[ENV.GEOCODER_ENABLED], true),
  contact: (process.env[ENV.GEOCODER_CONTACT] ?? '').trim(),
  nominatimUrl: withoutTrailingSlash(
    process.env[ENV.GEOCODER_NOMINATIM_URL] || 'https://nominatim.openstreetmap.org',
  ),
  photonUrl: withoutTrailingSlash(
    process.env[ENV.GEOCODER_PHOTON_URL] || 'https://photon.komoot.io',
  ),
  timeoutMs: toNumber(process.env[ENV.GEOCODER_TIMEOUT_MS], 4_000),
  minIntervalMs: BUSINESS_RULE.GEOCODER_MIN_INTERVAL_MS,
  cacheSize: BUSINESS_RULE.GEOCODER_CACHE_SIZE,
  cacheTtlMs: BUSINESS_RULE.GEOCODER_CACHE_TTL_MS,
}));

// ---------------------------------------------------------------------------
// Training: practice pitches with an AI shop owner (Claude)
// ---------------------------------------------------------------------------

export interface TrainingConfig {
  /** Empty turns practice pitches off; everything else in training still works. */
  anthropicApiKey: string;
  /** Empty: the SDK's default (api.anthropic.com). The e2e suite points it at a fake. */
  anthropicBaseUrl: string;
  /** The model that plays the shop owner and scores the pitch. */
  roleplayModel: string;
  /** Practice pitches one person may start per India day. */
  roleplayDailyLimit: number;
  /** Messages a rep may send in one pitch before it must be finished. */
  roleplayMaxTurns: number;
  /** YouTube's public playlist feed, read when a playlist lesson is saved. The e2e suite fakes it. */
  youtubeFeedUrl: string;
}

export const trainingConfig = registerAs(CONFIG_NAMESPACE.TRAINING, (): TrainingConfig => ({
  anthropicApiKey: (process.env[ENV.ANTHROPIC_API_KEY] ?? '').trim(),
  anthropicBaseUrl: withoutTrailingSlash((process.env[ENV.ANTHROPIC_BASE_URL] ?? '').trim()),
  roleplayModel: (process.env[ENV.ROLEPLAY_MODEL] ?? '').trim() || 'claude-opus-5-5',
  roleplayDailyLimit: toNumber(process.env[ENV.ROLEPLAY_DAILY_LIMIT], 5),
  roleplayMaxTurns: toNumber(process.env[ENV.ROLEPLAY_MAX_TURNS], 16),
  youtubeFeedUrl: withoutTrailingSlash(
    (process.env[ENV.YOUTUBE_FEED_URL] ?? '').trim() || 'https://www.youtube.com/feeds/videos.xml',
  ),
}));

// ---------------------------------------------------------------------------
// Swagger
// ---------------------------------------------------------------------------

export interface SwaggerConfig {
  enabled: boolean;
  path: string;
  user: string;
  password: string;
}

export const swaggerConfig = registerAs(CONFIG_NAMESPACE.SWAGGER, (): SwaggerConfig => ({
  enabled: toBoolean(process.env[ENV.SWAGGER_ENABLED], true),
  path: process.env[ENV.SWAGGER_PATH] ?? 'docs',
  user: process.env[ENV.SWAGGER_USER] ?? '',
  password: process.env[ENV.SWAGGER_PASSWORD] ?? '',
}));

/** Every namespace, in the order `ConfigModule.forRoot({ load })` expects. */
export const configurations = [
  appConfig,
  databaseConfig,
  supabaseConfig,
  visitConfig,
  swaggerConfig,
  mailConfig,
  geoConfig,
  trainingConfig,
];
