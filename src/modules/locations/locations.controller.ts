import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkArrayEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { LocationQueryDto, LocationSuggestionDto } from './dto/location.dto';
import { LocationsService } from './locations.service';

@ApiTags(SWAGGER_TAG.LOCATIONS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.PROJECTS)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get(`${ROUTE.ID_PARAM}/locations`)
  @ApiOperation({
    summary: 'Location suggestions for a project',
    description:
      'Up to 10 matches: names starting with the text first, then the most used. Capitals are ignored. A name not in the list is added when the lead or follow-up using it is saved.',
  })
  @ApiOkArrayEnvelope(LocationSuggestionDto)
  suggest(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: LocationQueryDto,
  ): Promise<LocationSuggestionDto[]> {
    return this.locationsService.suggest(actor, params.id, query.q);
  }
}
