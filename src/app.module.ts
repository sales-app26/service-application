import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CONFIG_NAMESPACE } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AppConfig, configurations } from './config/configuration';
import { envValidationOptions, envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { HealthModule } from './modules/health/health.module';
import { LeadsModule } from './modules/leads/leads.module';
import { MediaModule } from './modules/media/media.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { TransferRejectionsModule } from './modules/transfers/transfer-rejections.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { UsersModule } from './modules/users/users.module';
import { VersionsModule } from './modules/versions/versions.module';

const MILLISECONDS_PER_SECOND = 1_000;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configurations,
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,
      // ENV_FILE (the :prod scripts point it at .env.prod) comes first, because
      // the first file to define a key is the one that counts.
      envFilePath: [
        ...(process.env.ENV_FILE ? [process.env.ENV_FILE] : []),
        '.env.local',
        `.env.${process.env.NODE_ENV ?? 'development'}`,
        '.env',
      ],
      expandVariables: true,
    }),

    DatabaseModule,

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const app = configService.getOrThrow<AppConfig>(CONFIG_NAMESPACE.APP);
        return {
          throttlers: [
            { ttl: app.throttleTtlSeconds * MILLISECONDS_PER_SECOND, limit: app.throttleLimit },
          ],
        };
      },
    }),

    HealthModule,

    // Cross-cutting, @Global: Supabase Auth/Storage, project scope, and the
    // transfer auto-reject that users, projects and leads all trigger.
    SupabaseModule,
    AccessModule,
    TransferRejectionsModule,
    MediaModule,

    AuthModule,
    UsersModule,
    ProjectsModule,
    LeadsModule,
    TransfersModule,
    ReportsModule,
    VersionsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: (): ValidationPipe =>
        new ValidationPipe({
          // Strip anything not declared on the DTO rather than passing it on.
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
          stopAtFirstError: false,
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Logging wraps the response wrapper so it reports true duration.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // Guard order is declaration order:
    //   1. Throttle before doing any work.
    //   2. Authenticate — every route is protected unless it opts out with
    //      @Public(), and a deactivated account is refused here.
    //   3. Check the route's @Roles. Project scope is checked by the services.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
