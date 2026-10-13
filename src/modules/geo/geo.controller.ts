import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { BUSINESS_RULE, ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators';
import { PlaceNameDto, ReverseQueryDto } from './dto/geo.dto';
import { GeoLookupLimiter } from './lookup-limiter';
import { ReverseGeocoder } from './reverse-geocoder.service';

@ApiTags(SWAGGER_TAG.GEO)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.GEO)
export class GeoController {
  constructor(
    private readonly geocoder: ReverseGeocoder,
    private readonly limiter: GeoLookupLimiter,
  ) {}

  @Get('reverse')
  @ApiOperation({
    summary: 'The area a position is in',
    description: [
      'For "Use my location" on the lead form and the camera’s "Near …" line. Any signed-in person.',
      'Answers `null` when no name is known or the lookup did not finish within a few seconds — never an error for that.',
      `At most ${BUSINESS_RULE.GEO_LOOKUPS_PER_MINUTE} lookups per person per minute → \`429 RATE_LIMITED\`.`,
      'Place data © OpenStreetMap contributors (ODbL); show the attribution next to it.',
    ].join('\n\n'),
  })
  @ApiOkEnvelope(PlaceNameDto)
  reverse(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ReverseQueryDto,
  ): Promise<PlaceNameDto | null> {
    this.limiter.take(actor.id);
    return this.geocoder.reverse(query.lat, query.lng);
  }
}
