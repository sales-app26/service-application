import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
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
  AttemptInputDto,
  AttemptResultDto,
  CampaignTrainingDto,
  LessonDoneDto,
  LessonFileDto,
  LessonProgressInputDto,
  ProjectQueryDto,
  RoleplaySessionDto,
  SendTurnDto,
  TrainingBoardDto,
} from './dto/training.dto';
import { RoleplayService } from './roleplay.service';
import { TrainingService } from './training.service';

const CAMPAIGN = `${ROUTE.PROJECTS}/${ROUTE.ID_PARAM}/${ROUTE.TRAINING}`;
const ITEM = `${ROUTE.TRAINING}/${ROUTE.ITEMS}/${ROUTE.ID_PARAM}`;
const PITCH = `${ROUTE.ROLEPLAY}/${ROUTE.ID_PARAM}`;

/** Taking training: lessons, progress, quizzes, practice pitches — and the manager's board. */
@ApiTags(SWAGGER_TAG.TRAINING)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller()
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly roleplay: RoleplayService,
  ) {}

  @Get(CAMPAIGN)
  @ApiOperation({
    summary: 'A campaign’s training, with my progress',
    description:
      'Any member, or the Super Admin. Its library courses in order, then lessons only this campaign has. No quiz answers, no hidden role-play instructions.',
  })
  @ApiOkEnvelope(CampaignTrainingDto)
  campaign(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<CampaignTrainingDto> {
    return this.training.campaignTraining(actor, params.id);
  }

  @Get(`${CAMPAIGN}/board`)
  @Roles(UserRole.SUPER_ADMIN, UserRole.MODERATOR)
  @ApiOperation({ summary: 'Every member’s training progress in a campaign (its admins)' })
  @ApiOkEnvelope(TrainingBoardDto)
  board(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<TrainingBoardDto> {
    return this.training.board(actor, params.id);
  }

  @Post(`${ITEM}/progress`)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Watching a video, or reading a document or card',
    description:
      'A video is done at 90% watched, or when its checks are answered right if it has any. A document or card is done with `done: true`.',
  })
  @ApiOkEnvelope(LessonDoneDto)
  progress(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: LessonProgressInputDto,
  ): Promise<LessonDoneDto> {
    return this.training.recordProgress(actor, params.id, dto);
  }

  @Post(`${ITEM}/attempts`)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer a quiz, or the checks after a video',
    description:
      'Graded here; the right answers and explanations come back only now. A quiz allows 3 tries a day until passed.',
  })
  @ApiOkEnvelope(AttemptResultDto)
  attempt(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: AttemptInputDto,
  ): Promise<AttemptResultDto> {
    return this.training.attempt(actor, params.id, dto);
  }

  @Get(`${ITEM}/file`)
  @ApiOperation({ summary: 'A short-lived link to a document lesson’s file' })
  @ApiOkEnvelope(LessonFileDto)
  file(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ProjectQueryDto,
  ): Promise<LessonFileDto> {
    return this.training.lessonFile(actor, params.id, query.projectId);
  }

  // ---------------------------------------------------------------- practice pitches

  @Post(`${ITEM}/${ROUTE.ROLEPLAY}`)
  @ApiOperation({
    summary: 'Start a practice pitch with the AI shop owner',
    description: 'A few a day per person (ROLEPLAY_DAILY_LIMIT). The owner speaks first.',
  })
  @ApiCreatedEnvelope(RoleplaySessionDto)
  startPitch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: ProjectQueryDto,
  ): Promise<RoleplaySessionDto> {
    return this.roleplay.start(actor, params.id, dto.projectId);
  }

  @Get(`${ITEM}/${ROUTE.ROLEPLAY}`)
  @ApiOperation({ summary: 'My practice pitches for this lesson, newest first' })
  @ApiOkArrayEnvelope(RoleplaySessionDto)
  myPitches(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Query() query: ProjectQueryDto,
  ): Promise<RoleplaySessionDto[]> {
    return this.roleplay.mine(actor, params.id, query.projectId);
  }

  @Get(PITCH)
  @ApiOperation({ summary: 'A practice pitch: its rep, or an admin of its campaign' })
  @ApiOkEnvelope(RoleplaySessionDto)
  pitch(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<RoleplaySessionDto> {
    return this.roleplay.get(actor, params.id);
  }

  @Post(`${PITCH}/turns`)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say something to the owner; the owner answers' })
  @ApiOkEnvelope(RoleplaySessionDto)
  turn(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
    @Body() dto: SendTurnDto,
  ): Promise<RoleplaySessionDto> {
    return this.roleplay.turn(actor, params.id, dto.message);
  }

  @Post(`${PITCH}/finish`)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Finish a practice pitch and get the coach’s score',
    description: 'A score at or above the lesson’s pass mark completes the lesson.',
  })
  @ApiOkEnvelope(RoleplaySessionDto)
  finish(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UuidParamDto,
  ): Promise<RoleplaySessionDto> {
    return this.roleplay.finish(actor, params.id);
  }
}
