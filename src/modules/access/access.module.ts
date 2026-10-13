import { Global, Module } from '@nestjs/common';

import { CoverageService } from './coverage.service';
import { ProjectAccessService } from './project-access.service';

/** Project scope and leave cover, used by every feature module. */
@Global()
@Module({
  providers: [ProjectAccessService, CoverageService],
  exports: [ProjectAccessService, CoverageService],
})
export class AccessModule {}
