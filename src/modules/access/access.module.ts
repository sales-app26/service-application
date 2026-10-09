import { Global, Module } from '@nestjs/common';

import { ProjectAccessService } from './project-access.service';

/** Project scope, used by every feature module. */
@Global()
@Module({
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class AccessModule {}
