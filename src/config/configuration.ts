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
  /** Where the invite and password-reset emails send the user. */
  authRedirectUrl: string;
}

export const supabaseConfig = registerAs(CONFIG_NAMESPACE.SUPABASE, (): SupabaseConfig => ({
  url: withoutTrailingSlash(process.env[ENV.SUPABASE_URL] ?? ''),
  anonKey: process.env[ENV.SUPABASE_ANON_KEY] ?? '',
  serviceRoleKey: process.env[ENV.SUPABASE_SERVICE_ROLE_KEY] ?? '',
  jwtSecret: process.env[ENV.SUPABASE_JWT_SECRET] ?? '',
  storageBucket: process.env[ENV.SUPABASE_STORAGE_BUCKET] ?? 'sales-tracker',
  timeoutMs: toNumber(process.env[ENV.SUPABASE_TIMEOUT_MS], 10_000),
  authRedirectUrl: process.env[ENV.AUTH_REDIRECT_URL] ?? '',
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
];
