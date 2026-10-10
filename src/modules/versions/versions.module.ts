import { Module } from '@nestjs/common';

import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';

/** Release notes. Repositories come from the global DatabaseModule. */
@Module({
  controllers: [VersionsController],
  providers: [VersionsService],
})
export class VersionsModule {}
