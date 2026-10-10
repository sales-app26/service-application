import * as Joi from 'joi';

import { CONFIG_DEFAULT, ENV, NODE_ENVIRONMENT } from '../common/constants';

const MIN_SECRET_LENGTH = 32;

const requiredWithoutUrl = (): Joi.StringSchema =>
  Joi.string().when(ENV.DATABASE_URL, {
    is: Joi.string().min(1).required(),
    then: Joi.optional().allow(''),
    otherwise: Joi.required(),
  });

/**
 * Boot-time environment contract.
 *
 * The application refuses to start when a required variable is missing or
 * malformed, so a misconfigured deployment fails at boot instead of on the
 * first sales person's first save.
 */
export const envValidationSchema = Joi.object({
  // ---------------------------------------------------------------- application
  [ENV.NODE_ENV]: Joi.string()
    .valid(...Object.values(NODE_ENVIRONMENT))
    .default(NODE_ENVIRONMENT.DEVELOPMENT),
  [ENV.PORT]: Joi.number().port().default(CONFIG_DEFAULT.PORT),
  [ENV.APP_NAME]: Joi.string().default('Pronttera Sales API'),
  [ENV.API_PREFIX]: Joi.string().default('api'),
  [ENV.API_VERSION]: Joi.string().default('v1'),
  [ENV.CORS_ORIGINS]: Joi.string().default('*'),
  [ENV.BODY_LIMIT]: Joi.string().default('1mb'),
  [ENV.THROTTLE_TTL_SECONDS]: Joi.number().integer().min(1).default(60),
  [ENV.THROTTLE_LIMIT]: Joi.number().integer().min(1).default(120),
  [ENV.APP_URL]: Joi.string().uri().allow('').default(''),

  // ------------------------------------------------------------------- database
  [ENV.DATABASE_URL]: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .optional(),
  [ENV.DIRECT_URL]: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .optional(),
  [ENV.DB_HOST]: requiredWithoutUrl(),
  [ENV.DB_PORT]: Joi.number().port().default(5432),
  [ENV.DB_USERNAME]: requiredWithoutUrl(),
  [ENV.DB_PASSWORD]: requiredWithoutUrl(),
  [ENV.DB_NAME]: requiredWithoutUrl(),
  [ENV.DB_SSL]: Joi.boolean().default(true),
  [ENV.DB_SSL_REJECT_UNAUTHORIZED]: Joi.boolean().default(false),
  [ENV.DB_POOL_MAX]: Joi.number().integer().min(1).max(100).default(15),
  [ENV.DB_POOL_IDLE_TIMEOUT_MS]: Joi.number().integer().min(0).default(30_000),
  [ENV.DB_CONNECTION_TIMEOUT_MS]: Joi.number().integer().min(0).default(20_000),
  [ENV.DB_STATEMENT_TIMEOUT_MS]: Joi.number().integer().min(0).default(30_000),
  [ENV.DB_LOGGING]: Joi.boolean().default(false),
  [ENV.DB_MIGRATIONS_RUN]: Joi.boolean().default(false),

  // ------------------------------------------------------------------- supabase
  // Login is Supabase Auth (BRD §5), so there is no running without it.
  [ENV.SUPABASE_URL]: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .required(),
  [ENV.SUPABASE_ANON_KEY]: Joi.string().min(20).required(),
  [ENV.SUPABASE_SERVICE_ROLE_KEY]: Joi.string().min(20).required(),
  [ENV.SUPABASE_JWT_SECRET]: Joi.string().allow('').default(''),
  [ENV.SUPABASE_STORAGE_BUCKET]: Joi.string().default('sales-tracker'),
  [ENV.SUPABASE_TIMEOUT_MS]: Joi.number().integer().min(1000).default(10_000),
  [ENV.AUTH_REDIRECT_URL]: Joi.string().uri().allow('').default(''),

  // ---------------------------------------------------------------- visit proof
  [ENV.CAPTURE_TOKEN_SECRET]: Joi.string().min(MIN_SECRET_LENGTH).required(),
  [ENV.SIGNED_URL_TTL_SECONDS]: Joi.number().integer().min(30).max(3600).default(600),

  // -------------------------------------------------------------------- swagger
  [ENV.SWAGGER_ENABLED]: Joi.boolean().default(true),
  [ENV.SWAGGER_PATH]: Joi.string().default('docs'),
  [ENV.SWAGGER_USER]: Joi.string().allow('').default(''),
  [ENV.SWAGGER_PASSWORD]: Joi.string().allow('').default(''),

  // -------------------------------------------------------------------- seeding
  // Consumed by `npm run db:seed` only; the API never reads these.
  [ENV.SEED_SUPER_ADMIN_NAME]: Joi.string().allow('').default(''),
  [ENV.SEED_SUPER_ADMIN_EMAIL]: Joi.string().email().allow('').default(''),
  [ENV.SEED_SUPER_ADMIN_PASSWORD]: Joi.string().allow('').default(''),
});

export const envValidationOptions = {
  /** Report every problem at once instead of one per restart. */
  abortEarly: false,
  /** Unknown variables (CI, platform-injected) are allowed through. */
  allowUnknown: true,
};
