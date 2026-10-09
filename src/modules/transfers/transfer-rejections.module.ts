import { Global, Module } from '@nestjs/common';

import { TransferRejectionsService } from './transfer-rejections.service';

@Global()
@Module({
  providers: [TransferRejectionsService],
  exports: [TransferRejectionsService],
})
export class TransferRejectionsModule {}
