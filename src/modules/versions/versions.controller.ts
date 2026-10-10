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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  BUSINESS_RULE,
  ROUTE,
  SWAGGER_SECURITY,
  SWAGGER_TAG,
  UPLOAD_FIELD,
} from '../../common/constants';
import {
  ApiCreatedEnvelope,
  ApiOkArrayEnvelope,
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  AppVersionDto,
  CreateVersionDto,
  LatestVersionDto,
  UpdateVersionDto,
  VersionHistoryItemDto,
  VersionViewsDto,
} from './dto/version.dto';
import { VersionsService } from './versions.service';

/** Multer ceiling; the service refuses an oversized or wrong-type file with a readable message. */
const NOTE_UPLOAD = FileInterceptor(UPLOAD_FIELD.FILE, {
  limits: { fileSize: BUSINESS_RULE.RELEASE_NOTE_MAX_BYTES + 1, files: 1 },
});

const MULTIPART_BODY = {
  schema: {
    type: 'object',
    properties: {
      [UPLOAD_FIELD.FILE]: {
        type: 'string',
        format: 'binary',
        description: 'The note as a .md file.',
      },
      version: { type: 'string', example: '1.1.0' },
      title: { type: 'string', example: 'Faster lead import' },
      tags: { type: 'string', example: 'Leads,Transfers' },
      notes: { type: 'string', description: 'Markdown, if no file is sent.' },
      releasedAt: { type: 'string', format: 'date-time' },
      isPublished: { type: 'boolean' },
      notify: { type: 'boolean' },
    },
  },
} as const;

/**
 * Release notes.
 *
 * Reading is open to every signed-in role — whatever changed, somebody in the
 * field is the one looking at the screen it changed. Writing is the Super
 * Admin's. Static segments (`latest`, `admin`) are declared before `:id`.
 */
@ApiTags(SWAGGER_TAG.VERSIONS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.VERSIONS)
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Get('latest')
  @ApiOperation({
    summary: 'The current release, and whether this user has seen its note',
    description: 'Null until a release has been published.',
  })
  @ApiOkEnvelope(LatestVersionDto)
  latest(@CurrentUser() actor: AuthenticatedUser): Promise<LatestVersionDto | null> {
    return this.versionsService.latestFor(actor.id);
  }

  @Get()
  @ApiOperation({ summary: 'Published releases, newest first' })
  @ApiOkArrayEnvelope(VersionHistoryItemDto)
  history(@CurrentUser() actor: AuthenticatedUser): Promise<VersionHistoryItemDto[]> {
    return this.versionsService.historyFor(actor.id);
  }

  @Post(`${ROUTE.ID_PARAM}/seen`)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Record that this user has read the note',
    description: 'Idempotent: dismissing the same dialog twice writes one row.',
  })
  markSeen(@CurrentUser() actor: AuthenticatedUser, @Param() params: UuidParamDto): Promise<void> {
    return this.versionsService.markSeen(params.id, actor.id);
  }

  // ------------------------------------------------------------------ manage

  @Get('admin')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Every release, drafts included, with read counts' })
  @ApiOkArrayEnvelope(AppVersionDto)
  listAll(): Promise<AppVersionDto[]> {
    return this.versionsService.listAll();
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(NOTE_UPLOAD)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody(MULTIPART_BODY)
  @ApiOperation({
    summary: 'Add a release',
    description:
      'Upload the note as a .md file (field `file`, at most 512 KB) or send the markdown as `notes`. A file wins if both are sent.',
  })
  @ApiCreatedEnvelope(AppVersionDto)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateVersionDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AppVersionDto> {
    return this.versionsService.create(actor, dto, file);
  }

  @Patch(ROUTE.ID_PARAM)
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(NOTE_UPLOAD)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody(MULTIPART_BODY)
  @ApiOperation({ summary: 'Edit a release, replace its note, publish or unpublish it' })
  @ApiOkEnvelope(AppVersionDto)
  update(
    @Param() params: UuidParamDto,
    @Body() dto: UpdateVersionDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AppVersionDto> {
    return this.versionsService.update(params.id, dto, file);
  }

  @Delete(ROUTE.ID_PARAM)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a release and its read log',
    description: 'If it is live, the previous published release becomes the newest again.',
  })
  remove(@Param() params: UuidParamDto): Promise<void> {
    return this.versionsService.remove(params.id);
  }

  @Get(`${ROUTE.ID_PARAM}/views`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Who has read this release note',
    description:
      'Everyone who dismissed the dialog, and how many active users are still to see it.',
  })
  @ApiOkEnvelope(VersionViewsDto)
  views(@Param() params: UuidParamDto): Promise<VersionViewsDto> {
    return this.versionsService.viewsFor(params.id);
  }
}
