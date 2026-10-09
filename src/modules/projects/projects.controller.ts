import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

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
  ApiOkArrayEnvelope,
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
import {
  AddMemberDto,
  ListMembersQueryDto,
  MemberDto,
  MemberParamsDto,
  SetTargetDto,
} from './dto/member.dto';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { MembersService } from './members.service';
import { ProjectsService } from './projects.service';

/** Multer ceiling; the service applies the 2 MB project-image rule with a clear message. */
const IMAGE_UPLOAD = FileInterceptor(UPLOAD_FIELD.IMAGE, {
  limits: { fileSize: BUSINESS_RULE.VISIT_PHOTO_MAX_BYTES, files: 1 },
});

const IMAGE_SCHEMA = {
  schema: {
    type: 'object',
    properties: { [UPLOAD_FIELD.IMAGE]: { type: 'string', format: 'binary' } },
    required: [UPLOAD_FIELD.IMAGE],
  },
};

@ApiTags(SWAGGER_TAG.PROJECTS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.PROJECTS)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly membersService: MembersService,
  ) {}

  // ------------------------------------------------------------------ projects

  @Get()
  @ApiOperation({
    summary: 'List projects',
    description:
      'Super Admin: all. Moderators and sales persons: the projects they are members of.',
  })
  @ApiPaginatedEnvelope(ProjectDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListProjectsQueryDto,
  ): Promise<PaginatedResponseDto<ProjectDto>> {
    return this.projectsService.list(actor, query);
  }

  @Get('joinable')
  @Roles(UserRole.MODERATOR)
  @ApiOperation({ summary: 'Active projects a moderator can assign to himself' })
  @ApiOkArrayEnvelope(ProjectDto)
  joinable(@CurrentUser() actor: AuthenticatedUser): Promise<ProjectDto[]> {
    return this.projectsService.joinable(actor);
  }

  @Get(ROUTE.ID_PARAM)
  @ApiOperation({ summary: 'Get one project' })
  @ApiOkEnvelope(ProjectDto)
  findOne(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<ProjectDto> {
    return this.projectsService.findOne(actor, params.id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Create a project',
    description:
      'JSON, or multipart with an optional `image` (JPG/PNG, at most 2 MB). A name another project already uses is allowed and returned with a warning.',
  })
  @ApiCreatedEnvelope(ProjectDto)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
    @UploadedFile() image?: Express.Multer.File,
  ): Promise<ProjectDto> {
    return this.projectsService.create(actor, dto, image);
  }

  @Patch(ROUTE.ID_PARAM)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Edit a project',
    description: 'The type is locked once the project has its first lead.',
  })
  @ApiOkEnvelope(ProjectDto)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projectsService.update(actor, params.id, dto);
  }

  @Post(`${ROUTE.ID_PARAM}/image`)
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(IMAGE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(IMAGE_SCHEMA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or replace the project image',
    description: 'JPG or PNG, at most 2 MB.',
  })
  @ApiOkEnvelope(ProjectDto)
  setImage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @UploadedFile(new ParseFilePipe({ fileIsRequired: true })) image: Express.Multer.File,
  ): Promise<ProjectDto> {
    return this.projectsService.setImage(actor, params.id, image);
  }

  @Delete(`${ROUTE.ID_PARAM}/image`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove the project image' })
  @ApiOkEnvelope(ProjectDto)
  removeImage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<ProjectDto> {
    return this.projectsService.removeImage(actor, params.id);
  }

  @Post(`${ROUTE.ID_PARAM}/close`)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.PROJECT_CLOSED)
  @ApiOperation({
    summary: 'Close a project',
    description:
      'Read-only from now on: no new leads, follow-ups, status changes or transfers. Pending transfers are rejected. Its leads leave every Due today list. All data and photos stay viewable.',
  })
  @ApiOkEnvelope(ProjectDto)
  close(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<ProjectDto> {
    return this.projectsService.close(actor, params.id);
  }

  @Post(`${ROUTE.ID_PARAM}/reopen`)
  @Roles(UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.PROJECT_REOPENED)
  @ApiOperation({
    summary: 'Reopen a closed project',
    description:
      'Members and targets return as they were. Auto-rejected transfers are not restored.',
  })
  @ApiOkEnvelope(ProjectDto)
  reopen(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<ProjectDto> {
    return this.projectsService.reopen(actor, params.id);
  }

  // ------------------------------------------------------------------- members

  @Get(`${ROUTE.ID_PARAM}/members`)
  @ApiTags(SWAGGER_TAG.MEMBERS)
  @ApiOperation({
    summary: 'List project members',
    description:
      'Admins see contact details, targets and (optionally) removed members. Other members see active members’ names and roles — enough to pick a transfer recipient.',
  })
  @ApiOkArrayEnvelope(MemberDto)
  members(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ListMembersQueryDto,
  ): Promise<MemberDto[]> {
    return this.membersService.list(actor, params.id, query.includeRemoved ?? false);
  }

  @Post(`${ROUTE.ID_PARAM}/members`)
  @ApiTags(SWAGGER_TAG.MEMBERS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.MEMBER_ADDED)
  @ApiOperation({
    summary: 'Add a member',
    description:
      'Super Admin adds moderators and sales persons; a moderator adds sales persons to his projects. A person removed earlier is reactivated with their previous target. Deactivated users cannot be added.',
  })
  @ApiCreatedEnvelope(MemberDto)
  addMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: AddMemberDto,
  ): Promise<MemberDto> {
    return this.membersService.add(actor, params.id, dto);
  }

  @Post(`${ROUTE.ID_PARAM}/join`)
  @ApiTags(SWAGGER_TAG.MEMBERS)
  @Roles(UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.JOINED_PROJECT)
  @ApiOperation({
    summary: 'Assign a project to myself (moderator)',
    description: 'Active projects only. No approval needed.',
  })
  @ApiCreatedEnvelope(MemberDto)
  join(@CurrentUser() actor: AuthenticatedUser, @Param() params: UuidParamDto): Promise<MemberDto> {
    return this.membersService.join(actor, params.id);
  }

  @Delete(`${ROUTE.ID_PARAM}/members/:userId`)
  @ApiTags(SWAGGER_TAG.MEMBERS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.MEMBER_REMOVED)
  @ApiOperation({
    summary: 'Remove a member',
    description:
      'History stays. Their leads are tagged "Owner removed" for reassignment, and their pending transfers here are rejected. A moderator can remove sales persons and himself, not another moderator.',
  })
  @ApiOkEnvelope(MemberDto)
  removeMember(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: MemberParamsDto,
  ): Promise<MemberDto> {
    return this.membersService.remove(actor, params.id, params.userId);
  }

  @Patch(`${ROUTE.ID_PARAM}/members/:userId/target`)
  @ApiTags(SWAGGER_TAG.MEMBERS)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.TARGET_UPDATED)
  @ApiOperation({
    summary: 'Set or clear a member’s target',
    description:
      'Converted leads per week (Mon–Sun) or calendar month, India time. Replaces the old target; progress uses the new one at once.',
  })
  @ApiOkEnvelope(MemberDto)
  setTarget(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: MemberParamsDto,
    @Body() dto: SetTargetDto,
  ): Promise<MemberDto> {
    return this.membersService.setTarget(actor, params.id, params.userId, dto);
  }
}
