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
  Put,
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
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
  Roles,
} from '../../common/decorators';
import { UuidParamDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  CourseDetailDto,
  CourseDto,
  CreateCourseDto,
  CreateLessonDto,
  LessonDto,
  SetCampaignCoursesDto,
  UpdateCourseDto,
  UpdateLessonDto,
} from './dto/training.dto';
import { TrainingLibraryService, UploadedLessonFile } from './training-library.service';

const COURSES = `${ROUTE.TRAINING}/${ROUTE.COURSES}`;
const ITEMS = `${ROUTE.TRAINING}/${ROUTE.ITEMS}`;
const CAMPAIGN = `${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/${ROUTE.TRAINING}`;

/** Multer ceiling; the service applies the 20 MB rule with a clear message. */
const FILE_UPLOAD = FileInterceptor(UPLOAD_FIELD.FILE, {
  limits: { fileSize: BUSINESS_RULE.LESSON_FILE_MAX_BYTES + 1, files: 1 },
});

const FILE_SCHEMA = {
  schema: {
    type: 'object',
    required: [UPLOAD_FIELD.FILE],
    properties: { [UPLOAD_FIELD.FILE]: { type: 'string', format: 'binary' } },
  },
};

/** Building training: the library (Super Admin) and each campaign's own lessons (its admins). */
@ApiTags(SWAGGER_TAG.TRAINING)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class TrainingLibraryController {
  constructor(private readonly library: TrainingLibraryService) {}

  // ---------------------------------------------------------------- courses

  @Get(COURSES)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'Courses in the training library',
    description:
      'The Super Admin sees drafts too; a sales manager sees published courses, to attach them.',
  })
  @ApiOkArrayEnvelope(CourseDto)
  listCourses(@CurrentUser() actor: AuthenticatedUser): Promise<CourseDto[]> {
    return this.library.listCourses(actor);
  }

  @Post(COURSES)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.COURSE_SAVED)
  @ApiOperation({ summary: 'Add a course to the library (Super Admin)' })
  @ApiCreatedEnvelope(CourseDto)
  createCourse(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateCourseDto,
  ): Promise<CourseDto> {
    return this.library.createCourse(actor, dto);
  }

  @Get(`${COURSES}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({
    summary: 'A course with every lesson in full',
    description:
      'Answers and hidden role-play instructions included. A draft only for the Super Admin.',
  })
  @ApiOkEnvelope(CourseDetailDto)
  getCourse(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<CourseDetailDto> {
    return this.library.getCourse(actor, params.id);
  }

  @Patch(`${COURSES}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.COURSE_SAVED)
  @ApiOperation({ summary: 'Rename, describe, publish or unpublish a course (Super Admin)' })
  @ApiOkEnvelope(CourseDto)
  updateCourse(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateCourseDto,
  ): Promise<CourseDto> {
    return this.library.updateCourse(actor, params.id, dto);
  }

  @Delete(`${COURSES}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Remove a course (Super Admin)',
    description: 'Hidden and detached from every campaign. Progress and certificates stay.',
  })
  async removeCourse(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.library.removeCourse(actor, params.id);
    return null;
  }

  @Post(`${COURSES}/${ROUTE.ID_PARAM}/${ROUTE.ITEMS}`)
  @Roles(UserRole.SUPER_ADMIN)
  @ResponseMessage(SUCCESS_MESSAGE.LESSON_SAVED)
  @ApiOperation({ summary: 'Add a lesson to a course (Super Admin)' })
  @ApiCreatedEnvelope(LessonDto)
  addCourseLesson(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: CreateLessonDto,
  ): Promise<LessonDto> {
    return this.library.addCourseLesson(actor, params.id, dto);
  }

  // ---------------------------------------------------------------- lessons

  @Get(`${ITEMS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'A lesson in full, to edit' })
  @ApiOkEnvelope(LessonDto)
  getLesson(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<LessonDto> {
    return this.library.getLesson(actor, params.id);
  }

  @Patch(`${ITEMS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.LESSON_SAVED)
  @ApiOperation({
    summary: 'Edit a lesson',
    description: 'A library lesson: the Super Admin. A campaign lesson: the campaign’s admins.',
  })
  @ApiOkEnvelope(LessonDto)
  updateLesson(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateLessonDto,
  ): Promise<LessonDto> {
    return this.library.updateLesson(actor, params.id, dto);
  }

  @Delete(`${ITEMS}/${ROUTE.ID_PARAM}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'Remove a lesson' })
  async removeLesson(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<null> {
    await this.library.removeLesson(actor, params.id);
    return null;
  }

  @Post(`${ITEMS}/${ROUTE.ID_PARAM}/file`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @UseInterceptors(FILE_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_SCHEMA)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.LESSON_FILE_SAVED)
  @ApiOperation({
    summary: 'Upload a document lesson’s file',
    description:
      'PDF, JPG, PNG or WebP, at most 20 MB, kept in the private bucket. Replaces any earlier file.',
  })
  @ApiOkEnvelope(LessonDto)
  uploadFile(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @UploadedFile() file?: UploadedLessonFile,
  ): Promise<LessonDto> {
    return this.library.uploadLessonFile(actor, params.id, file);
  }

  // ---------------------------------------------------------------- one campaign

  @Get(`${CAMPAIGN}/${ROUTE.COURSES}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'The library courses a campaign uses, in order (its admins)' })
  @ApiOkArrayEnvelope(CourseDto)
  campaignCourses(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<CourseDto[]> {
    return this.library.campaignCourses(actor, params.id);
  }

  @Put(`${CAMPAIGN}/${ROUTE.COURSES}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.CAMPAIGN_COURSES_SAVED)
  @ApiOperation({
    summary: 'Choose the library courses a campaign uses (its admins)',
    description: 'Replaces the list. Only published courses.',
  })
  @ApiOkArrayEnvelope(CourseDto)
  setCampaignCourses(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: SetCampaignCoursesDto,
  ): Promise<CourseDto[]> {
    return this.library.setCampaignCourses(actor, params.id, dto.courseIds);
  }

  @Get(`${CAMPAIGN}/${ROUTE.ITEMS}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'A campaign’s own lessons, in full (its admins)' })
  @ApiOkArrayEnvelope(LessonDto)
  campaignLessons(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<LessonDto[]> {
    return this.library.campaignOwnLessons(actor, params.id);
  }

  @Post(`${CAMPAIGN}/${ROUTE.ITEMS}`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ResponseMessage(SUCCESS_MESSAGE.LESSON_SAVED)
  @ApiOperation({
    summary: 'Add a lesson only this campaign has (its admins)',
    description: 'A city briefing, a local offer, a manager’s welcome video…',
  })
  @ApiCreatedEnvelope(LessonDto)
  addCampaignLesson(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: CreateLessonDto,
  ): Promise<LessonDto> {
    return this.library.addCampaignLesson(actor, params.id, dto);
  }
}
