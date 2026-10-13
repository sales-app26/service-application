import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { CONFIG_NAMESPACE } from './common/constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { plainValidationException } from './common/validators/validation-messages';
import { AppConfig, configurations } from './config/configuration';
import { envValidationOptions, envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AccessModule } from './modules/access/access.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './modules/auth/guards/auth.guard';
import { CommentsModule } from './modules/comments/comments.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { LeadsModule } from './modules/leads/leads.module';
import { LeaveLookupModule } from './modules/leaves/leave-lookup.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationSenderModule } from './modules/notifications/notification-sender.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ReportsModule } from './modules/reports/reports.module';
import { MailModule } from './modules/mail/mail.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { TeamModule } from './modules/team/team.module';
import { TemplatesModule } from './modules/templates/templates.module';
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

    // Cross-cutting, @Global: Supabase Auth/Storage, project scope and leave
    // cover, the transfer auto-reject that users, projects and leads all
    // trigger, "on leave today", and writing notifications.
    MailModule,
    SupabaseModule,
    AccessModule,
    TransferRejectionsModule,
    LeaveLookupModule,
    NotificationSenderModule,
    MediaModule,
    GeoModule,

    AuthModule,
    UsersModule,
    ProjectsModule,
    LeadsModule,
    TransfersModule,
    ReportsModule,
    VersionsModule,
    LeavesModule,
    CommentsModule,
    NotificationsModule,
    TeamModule,
    TemplatesModule,
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
          // Field messages in plain words ("must be a date", not "must be a valid ISO 8601 date string").
          exceptionFactory: plainValidationException,
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
