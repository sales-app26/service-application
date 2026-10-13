import { Global, Module } from '@nestjs/common';

import { LeaveLookupService } from './leave-lookup.service';

/** "On leave today" for every screen that shows a person. */
@Global()
@Module({
  providers: [LeaveLookupService],
  exports: [LeaveLookupService],
})
export class LeaveLookupModule {}
