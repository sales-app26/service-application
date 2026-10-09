import { Module } from '@nestjs/common';

import { CaptureTokenService } from './capture-token.service';
import { VisitProofService } from './visit-proof.service';
import { VisitsController } from './visits.controller';

@Module({
  controllers: [VisitsController],
  providers: [CaptureTokenService, VisitProofService],
  exports: [VisitProofService],
})
export class VisitsModule {}
