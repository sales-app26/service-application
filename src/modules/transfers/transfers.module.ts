import { Module } from '@nestjs/common';

import { LeadsModule } from '../leads/leads.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [LeadsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
