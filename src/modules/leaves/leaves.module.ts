import { Module } from '@nestjs/common';

import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';

/** Booking and cancelling leave. "On leave today" for other screens is `LeaveLookupModule`. */
@Module({
  controllers: [LeavesController],
  providers: [LeavesService],
})
export class LeavesModule {}
