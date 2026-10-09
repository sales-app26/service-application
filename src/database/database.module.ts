import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

import { CONFIG_NAMESPACE } from '../common/constants';
import { AppConfig, DatabaseConfig } from '../config/configuration';
import { ALL_ENTITIES } from './entities';
import { buildTypeOrmOptions } from './typeorm-options.factory';

/**
 * The single database connection.
 *
 * Global, and registers every repository once: the seven tables are small and
 * nearly every feature reads several of them (a follow-up touches the project,
 * the lead, the location and the transfer table in one transaction).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const database = configService.getOrThrow<DatabaseConfig>(CONFIG_NAMESPACE.DATABASE);
        const app = configService.getOrThrow<AppConfig>(CONFIG_NAMESPACE.APP);

        return {
          ...buildTypeOrmOptions(database, app),
          autoLoadEntities: false,
          retryAttempts: app.isProduction ? 5 : 1,
          retryDelay: 3_000,
        } as TypeOrmModuleOptions;
      },
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
