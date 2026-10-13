import { Module } from '@nestjs/common';

import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

/** Plan prices and offers. The service is exported for the deal checks on leads. */
@Module({
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
