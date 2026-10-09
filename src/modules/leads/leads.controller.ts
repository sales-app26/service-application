import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';

import {
  BUSINESS_RULE,
  ROUTE,
  SUCCESS_MESSAGE,
  SWAGGER_SECURITY,
  SWAGGER_TAG,
  UPLOAD_FIELD,
} from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { PaginatedResponseDto, UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import { ChangeStatusDto, EntryDto, ListEntriesQueryDto, LogFollowUpDto } from './dto/entry.dto';
import { EntrySaveResultDto } from './dto/entry-result.dto';
import {
  CreateLeadDto,
  LeadDetailDto,
  LeadSummaryDto,
  ListLeadsQueryDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { ImportLeadsDto, ImportResultDto } from './dto/import.dto';
import { EntriesService } from './entries.service';
import { LeadsImportService } from './leads-import.service';
import { LeadsService } from './leads.service';

/** Multer ceiling for the raw camera upload; the phone compresses first (VP-7). */
export const PHOTO_UPLOAD = FileInterceptor(UPLOAD_FIELD.PHOTO, {
  limits: { fileSize: BUSINESS_RULE.VISIT_PHOTO_MAX_BYTES, files: 1 },
});

/** Swagger only: the form fields plus the photo part. */
class CreateLeadFormDto extends CreateLeadDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Door-to-door: the live photo.',
  })
  photo?: unknown;
}

class LogFollowUpFormDto extends LogFollowUpDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Door-to-door: the live photo.',
  })
  photo?: unknown;
}

/** The CSV for a bulk import: one file part, never a photo. */
const IMPORT_UPLOAD = FileInterceptor(UPLOAD_FIELD.FILE, {
  limits: { fileSize: BUSINESS_RULE.IMPORT_MAX_BYTES, files: 1 },
});

class ImportLeadsFormDto extends ImportLeadsDto {
  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'The CSV file.' })
  file?: unknown;
}

const DOOR_TO_DOOR_NOTE = [
  '**Door-to-door projects** need, as `multipart/form-data`: `photo` (one live camera photo), `latitude`, `longitude`, `gpsAccuracyM` read at capture, and the `captureToken` from `POST /visits/capture-token` (at most 10 minutes old). Missing any → `422 VISIT_PROOF_REQUIRED`. The server stamps coordinates, date, time and name onto the photo and sets the visit time itself.',
  '',
  '**Online projects** take JSON; photo and GPS are not stored.',
  '',
  '`clientRequestId` makes the save idempotent: a double tap or retry returns the first result.',
].join('\n');

@ApiTags(SWAGGER_TAG.LEADS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly entriesService: EntriesService,
    private readonly importService: LeadsImportService,
  ) {}

  @Post(`${ROUTE.PROJECTS}/:id/${ROUTE.LEADS}/import`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IMPORT_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: ImportLeadsFormDto })
  @ResponseMessage(SUCCESS_MESSAGE.LEADS_IMPORTED)
  @ApiOperation({
    summary: 'Bulk import leads from a CSV and assign them',
    description: [
      '`multipart/form-data`: `file` (CSV, up to 1,000 rows and 1 MB), and optionally `defaultLocation`, `ownerIds` (comma-separated member ids) and `dryRun`.',
      '',
      'Columns (first row, any order, case-insensitive): **name** and **phone** are required; `business_name`, `location`, `notes` and `owner_email` are optional. Rows with an `owner_email` go to that member; the rest are shared evenly, in file order, among `ownerIds`. Rows with no `location` use `defaultLocation`.',
      '',
      'Imported leads start as New with no follow-up and no visit photo. Rows that cannot be imported (bad phone, unknown owner, a number already a lead here or repeated in the file) are skipped and listed; the others go in. `dryRun=true` returns the same report and changes nothing.',
    ].join('\n'),
  })
  @ApiOkEnvelope(ImportResultDto)
  importLeads(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: ImportLeadsDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ImportResultDto> {
    return this.importService.import(actor, params.id, file, dto);
  }

  @Post(`${ROUTE.PROJECTS}/:id/${ROUTE.LEADS}`)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @UseInterceptors(PHOTO_UPLOAD)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: CreateLeadFormDto })
  @ResponseMessage(SUCCESS_MESSAGE.LEAD_CREATED)
  @ApiOperation({
    summary: 'Add a lead with its first follow-up',
    description: [
      'Name, phone and location are required. The phone may not already be a lead in this project:',
      '- yours → `409 DUPLICATE_LEAD_OWN` with `details.leadId`;',
      '- someone else’s → `409 DUPLICATE_LEAD_OTHER`, naming only the owner.',
      '',
      DOOR_TO_DOOR_NOTE,
    ].join('\n'),
  })
  @ApiCreatedEnvelope(LeadDetailDto)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: CreateLeadDto,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<LeadDetailDto> {
    return this.leadsService.create(actor, params.id, dto, photo);
  }

  @Get(`${ROUTE.PROJECTS}/:id/${ROUTE.LEADS}`)
  @ApiOperation({
    summary: 'List leads in a project',
    description:
      'Sales persons get only their own leads. Admins get all, can filter by owner, and see `ownerTag` when an owner is deactivated or removed. Search matches name, business name or phone.',
  })
  @ApiPaginatedEnvelope(LeadSummaryDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ListLeadsQueryDto,
  ): Promise<PaginatedResponseDto<LeadSummaryDto>> {
    return this.leadsService.list(actor, params.id, query);
  }

  @Get(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}`)
  @ApiOperation({
    summary: 'Lead detail with recent history',
    description: '`permissions` says which actions the caller has, so the screen shows only those.',
  })
  @ApiOkEnvelope(LeadDetailDto)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<LeadDetailDto> {
    return this.leadsService.findDetail(actor, params.id);
  }

  @Get(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/${ROUTE.ENTRIES}`)
  @ApiTags(SWAGGER_TAG.ENTRIES)
  @ApiOperation({ summary: 'A lead’s full history, newest first' })
  @ApiPaginatedEnvelope(EntryDto)
  entries(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ListEntriesQueryDto,
  ): Promise<PaginatedResponseDto<EntryDto>> {
    return this.leadsService.listEntries(actor, params.id, query);
  }

  @Patch(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Edit a lead (owner only)',
    description:
      'Name, business name, phone, notes and location, at any time. A new phone is re-checked for duplicates.',
  })
  @ApiOkEnvelope(LeadDetailDto)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateLeadDto,
  ): Promise<LeadDetailDto> {
    return this.leadsService.update(actor, params.id, dto);
  }

  @Delete(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete a lead (Super Admin)',
    description:
      'Soft delete: hidden everywhere, its phone free to add again, its pending transfer rejected, and a conversion no longer counts toward the target.',
  })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.leadsService.remove(actor, params.id);
    return null;
  }

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/follow-ups`)
  @ApiTags(SWAGGER_TAG.ENTRIES)
  @Roles(UserRole.SALES_PERSON, UserRole.MODERATOR)
  @UseInterceptors(PHOTO_UPLOAD)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: LogFollowUpFormDto })
  @ResponseMessage(SUCCESS_MESSAGE.FOLLOW_UP_LOGGED)
  @ApiOperation({
    summary: 'Log a follow-up (owner only)',
    description: [
      'Status cannot go back to New. A Converted lead can be followed up but stays Converted. Next date: required for Follow-up scheduled, cleared for Not interested / Converted / Lost, never in the past, at most a year ahead.',
      '',
      'Refused with `409 PROJECT_CLOSED` if the project closed while the form was open, and `409 LEAD_TRANSFERRED` ("This lead now belongs to …") if the lead was transferred meanwhile.',
      '',
      DOOR_TO_DOOR_NOTE,
    ].join('\n'),
  })
  @ApiCreatedEnvelope(EntrySaveResultDto)
  logFollowUp(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: LogFollowUpDto,
    @UploadedFile() photo?: Express.Multer.File,
  ): Promise<EntrySaveResultDto> {
    return this.entriesService.logFollowUp(actor, params.id, dto, photo);
  }

  @Post(`${ROUTE.LEADS}/${ROUTE.ID_PARAM}/status`)
  @ApiTags(SWAGGER_TAG.ENTRIES)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.STATUS_CHANGED)
  @ApiOperation({
    summary: 'Change a lead’s status by hand',
    description:
      'The owner or an admin, with a reason. Recorded in the history as a status change. Only an admin can move a lead away from Converted ("Ask your moderator to change this."); doing so removes the conversion credit. No photo is asked.',
  })
  @ApiOkEnvelope(EntrySaveResultDto)
  changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: ChangeStatusDto,
  ): Promise<EntrySaveResultDto> {
    return this.entriesService.changeStatus(actor, params.id, dto);
  }
}
