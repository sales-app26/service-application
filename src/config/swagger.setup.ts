import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';

import {
  ApiErrorResponseDto,
  ApiResponseDto,
  PaginatedResponseDto,
  PaginationMetaDto,
  ValidationErrorDetailDto,
} from '../common/dto';
import {
  HTTP_HEADER,
  SWAGGER_SECURITY,
  SWAGGER_TAG,
  SWAGGER_TAG_DESCRIPTION,
} from '../common/constants';
import { AppConfig, SwaggerConfig } from './configuration';

const logger = new Logger('Swagger');

/** The handful of rules a client integrator has to know before reading any endpoint. */
const overview = `
API for the **Pronttera Sales**: leads and follow-ups logged against projects, door-to-door visits
proven with a live photo and GPS, and conversion targets per sales person.

### Response format
\`\`\`json
{ "success": true, "statusCode": 200, "message": "...", "data": {}, "timestamp": "...", "path": "..." }
\`\`\`
Failures use the same shape with \`success: false\`, a stable \`errorCode\`, field-level \`errors\`
for validation, and \`details\` when the screen can act on the failure (e.g. a link to the
existing lead). List endpoints put \`{ items, meta }\` in \`data\`.

### Authentication
\`POST /auth/login\` returns a Supabase access token. Send it as \`Authorization: Bearer <token>\`.
Every request re-checks that the account is active, so a deactivated user is refused on their
next action.

### Rules that shape the API
- **Roles:** Super Admin (everything), Moderator (only projects he is a member of),
  Sales Person (only his own leads).
- **Time is the server's and India's.** Entry times come from the server; "today", weeks
  (Monday–Sunday) and months are Asia/Kolkata.
- **Idempotent saves.** Every new entry carries a \`clientRequestId\` (UUID). A retry with the same
  id returns the first result instead of saving twice.
- **Door-to-door follow-ups** need \`photo\` (multipart), \`latitude\`, \`longitude\`,
  \`gpsAccuracyM\` and a \`captureToken\` from \`POST /visits/capture-token\` issued at most
  10 minutes earlier.
- **Nothing is hard-deleted** except by the Super Admin, and then only softly.
`;

/**
 * Mounts Swagger UI and the OpenAPI JSON. Outside development the docs sit
 * behind HTTP basic auth when credentials are configured.
 */
export const setupSwagger = (
  app: INestApplication,
  swagger: SwaggerConfig,
  appSettings: AppConfig,
): void => {
  if (!swagger.enabled) {
    logger.log('Swagger is disabled for this environment.');
    return;
  }

  if (!appSettings.isDevelopment) {
    applyDocsBasicAuth(app, swagger);
  }

  const builder = new DocumentBuilder()
    .setTitle(appSettings.name)
    .setDescription(overview)
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Supabase access token from POST /auth/login.',
      },
      SWAGGER_SECURITY.BEARER,
    )
    .addGlobalParameters({
      name: HTTP_HEADER.REQUEST_ID,
      in: 'header',
      required: false,
      description: 'Optional correlation id echoed back on errors.',
      schema: { type: 'string' },
    });

  for (const tag of Object.values(SWAGGER_TAG)) {
    builder.addTag(tag, SWAGGER_TAG_DESCRIPTION[tag] ?? '');
  }

  const document = SwaggerModule.createDocument(app, builder.build(), {
    extraModels: [
      ApiResponseDto,
      ApiErrorResponseDto,
      ValidationErrorDetailDto,
      PaginatedResponseDto,
      PaginationMetaDto,
    ],
    deepScanRoutes: true,
  });

  SwaggerModule.setup(swagger.path, app, document, {
    jsonDocumentUrl: `${swagger.path}/json`,
    customSiteTitle: appSettings.name,
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
      tagsSorter: 'alpha',
    },
  });

  logger.log(`Swagger UI available at /${swagger.path}`);
};

const applyDocsBasicAuth = (app: INestApplication, swagger: SwaggerConfig): void => {
  if (!swagger.user || !swagger.password) {
    logger.warn(
      'Swagger is enabled outside development without SWAGGER_USER/SWAGGER_PASSWORD — the docs are publicly readable.',
    );
    return;
  }

  const expected = `Basic ${Buffer.from(`${swagger.user}:${swagger.password}`).toString('base64')}`;

  app.use(
    [`/${swagger.path}`, `/${swagger.path}/*splat`],
    (request: Request, response: Response, next: NextFunction) => {
      if (request.headers.authorization === expected) {
        next();
        return;
      }
      response.setHeader('WWW-Authenticate', 'Basic realm="API documentation"');
      response.status(401).send('Authentication required.');
    },
  );
};
