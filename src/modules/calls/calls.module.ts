import { Module } from '@nestjs/common';

import { CallRecordingService } from './call-recording.service';

@Module({
  providers: [CallRecordingService],
  exports: [CallRecordingService],
})
export class CallsModule {}
