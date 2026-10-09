import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import { PhotoUrlDto } from '../visits/dto/visit.dto';
import { EditEntryDto, EntryDto } from './dto/entry.dto';
import { EntrySaveResultDto } from './dto/entry-result.dto';
import { EntriesService } from './entries.service';

@ApiTags(SWAGGER_TAG.ENTRIES)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.ENTRIES)
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Get(ROUTE.ID_PARAM)
  @ApiOperation({
    summary: 'One entry',
    description: 'For the person who logged it, the lead’s owner, or an admin of the project.',
  })
  @ApiOkEnvelope(EntryDto)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<EntryDto> {
    return this.entriesService.findOne(actor, params.id);
  }

  @Get(`${ROUTE.ID_PARAM}/photo`)
  @ApiTags(SWAGGER_TAG.VISITS)
  @ApiOperation({ summary: 'A fresh short-lived link to an entry’s photo' })
  @ApiOkEnvelope(PhotoUrlDto)
  photo(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<PhotoUrlDto> {
    return this.entriesService.photoUrl(actor, params.id);
  }

  @Patch(ROUTE.ID_PARAM)
  @ApiOperation({
    summary: 'Edit an entry’s note or next date (same day, author only)',
    description: [
      'Locked at midnight India time — an entry logged at 11:58 pm can be edited for two minutes. A save after midnight is refused with `409 ENTRY_LOCKED` ("This entry is now locked.").',
      '',
      'Status, photo, GPS and time never change. A status change allows the note only. A new next date moves the lead’s next date only if this is the lead’s latest entry.',
    ].join('\n'),
  })
  @ApiOkEnvelope(EntrySaveResultDto)
  edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: EditEntryDto,
  ): Promise<EntrySaveResultDto> {
    return this.entriesService.edit(actor, params.id, dto);
  }

  @Delete(ROUTE.ID_PARAM)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete an entry (Super Admin)',
    description:
      'Hidden from timelines and counts. If it was the lead’s latest entry, the lead’s status and next date fall back to the previous one. A correct entry must be logged again.',
  })
  async remove(@Param() params: UuidParamDto): Promise<null> {
    await this.entriesService.remove(params.id);
    return null;
  }
}
