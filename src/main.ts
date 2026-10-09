import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { CONFIG_NAMESPACE } from './common/constants';
import { AppConfig, SwaggerConfig } from './config/configuration';
import { setupSwagger } from './config/swagger.setup';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['log', 'warn', 'error']
        : ['log', 'warn', 'error', 'debug', 'verbose'],
    bufferLogs: true,
    // Parsers are registered by configureApp with the configured limit.
    bodyParser: false,
  });

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>(CONFIG_NAMESPACE.APP);
  const swaggerConfig = configService.getOrThrow<SwaggerConfig>(CONFIG_NAMESPACE.SWAGGER);

  configureApp(app, appConfig);
  setupSwagger(app, swaggerConfig, appConfig);

  await app.listen(appConfig.port);

  const baseUrl = await app.getUrl();
  logger.log(`${appConfig.name} listening on ${baseUrl}`);
  logger.log(`Environment: ${appConfig.nodeEnv}`);
  logger.log(`API base path: /${appConfig.apiPrefix}/${appConfig.apiVersion}`);
  if (swaggerConfig.enabled) {
    logger.log(`API documentation: ${baseUrl}/${swaggerConfig.path}`);
  }
}

void bootstrap();
