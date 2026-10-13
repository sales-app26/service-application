import { Global, Module } from '@nestjs/common';

import { GeoController } from './geo.controller';
import { GeoLookupLimiter } from './lookup-limiter';
import { ReverseGeocoder } from './reverse-geocoder.service';

/** Place names from OpenStreetMap, for visit proof and the lead form. */
@Global()
@Module({
  controllers: [GeoController],
  providers: [ReverseGeocoder, GeoLookupLimiter],
  exports: [ReverseGeocoder],
})
export class GeoModule {}
