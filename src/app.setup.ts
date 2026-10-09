import { VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

import { AppConfig } from './config/configuration';

/**
 * Everything about the HTTP layer that is not a module: security headers,
 * body limits, CORS, the `/api/v1` prefix. Shared by `main.ts` and the e2e
 * harness so the tests exercise the app exactly as it is deployed.
 */
export const configureApp = (app: NestExpressApplication, appConfig: AppConfig): void => {
  app.use(
    helmet({
      // Swagger UI needs inline styles and scripts; the API itself serves JSON.
      contentSecurityPolicy: appConfig.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  // Photos arrive as multipart and are limited by multer per route; JSON stays small.
  app.use(json({ limit: appConfig.bodyLimit }));
  app.use(urlencoded({ extended: true, limit: appConfig.bodyLimit }));

  // Behind a proxy the client IP arrives in X-Forwarded-For; without this the
  // rate limiter would throttle the proxy, not the caller.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion.replace(/^v/iu, ''),
  });

  app.enableShutdownHooks();
};
