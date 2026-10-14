import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { TrainingKind, TrainingStep } from '../../../common/enums';
import { trimString, trimToNull } from '../../../common/utils';

const FREE_OBJECT = { type: 'object', additionalProperties: true } as const;

// ------------------------------------------------------------------ library: courses

export class CourseDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: 'Frostique: core sales training' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ description: 'Drafts are invisible to reps and can’t be attached to a campaign.' })
  published: boolean;

  @ApiProperty({ example: 18 })
  lessonCount: number;

  @ApiProperty({ example: 3, description: 'Campaigns using this course.' })
  campaignCount: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class CreateCourseDto {
  @ApiProperty({ maxLength: BUSINESS_RULE.COURSE_TITLE_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.COURSE_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.DESCRIPTION_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.COURSE_TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.COURSE_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.DESCRIPTION_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

// ------------------------------------------------------------------ lessons (admin view)

export class LessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  courseId: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Set for a campaign-only lesson.',
  })
  projectId: string | null;

  @ApiProperty({ enum: TrainingStep })
  step: TrainingStep;

  @ApiProperty({ enum: TrainingKind })
  kind: TrainingKind;

  @ApiProperty({ example: 'The 25-minute visit' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  summary: string | null;

  @ApiProperty()
  sort: number;

  @ApiProperty()
  required: boolean;

  @ApiProperty({ nullable: true, type: Number })
  minutes: number | null;

  @ApiProperty({
    ...FREE_OBJECT,
    description: 'Everything the kind needs, answers and hidden role-play instructions included.',
  })
  payload: Record<string, unknown>;

  @ApiProperty({ description: 'A document with an uploaded file.' })
  hasFile: boolean;
}

export class CourseDetailDto {
  @ApiProperty({ type: CourseDto })
  course: CourseDto;

  @ApiProperty({ type: [LessonDto] })
  lessons: LessonDto[];
}

export class CreateLessonDto {
  @ApiProperty({ enum: TrainingKind })
  @IsEnum(TrainingKind)
  kind: TrainingKind;

  @ApiPropertyOptional({
    enum: TrainingStep,
    description: 'Defaults by kind: video → watch, card → field…',
  })
  @IsOptional()
  @IsEnum(TrainingStep)
  step?: TrainingStep;

  @ApiProperty({ maxLength: BUSINESS_RULE.LESSON_TITLE_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.LESSON_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.LESSON_SUMMARY_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.LESSON_SUMMARY_MAX_LENGTH)
  summary?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: BUSINESS_RULE.LESSON_SORT_MAX, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.LESSON_SORT_MAX)
  sort?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: BUSINESS_RULE.LESSON_MINUTES_MAX, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BUSINESS_RULE.LESSON_MINUTES_MAX)
  minutes?: number | null;

  @ApiProperty({
    ...FREE_OBJECT,
    description:
      'video `{url, startSeconds?, endSeconds?, checks?}` · document `{link?, note?}` (upload the file after) · card `{markdown}` · quiz `{passPercent?, questions:[{text, options, answer, explanation?}]}` · roleplay `{persona:{name, shop, city, about}, brief, ownerInstructions, opener?, language: en|hinglish, rubric:[…], passScore?}`',
  })
  @IsObject()
  payload: Record<string, unknown>;
}

export class UpdateLessonDto {
  @ApiPropertyOptional({ enum: TrainingStep })
  @IsOptional()
  @IsEnum(TrainingStep)
  step?: TrainingStep;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.LESSON_TITLE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.LESSON_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.LESSON_SUMMARY_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.LESSON_SUMMARY_MAX_LENGTH)
  summary?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: BUSINESS_RULE.LESSON_SORT_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUSINESS_RULE.LESSON_SORT_MAX)
  sort?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: BUSINESS_RULE.LESSON_MINUTES_MAX, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BUSINESS_RULE.LESSON_MINUTES_MAX)
  minutes?: number | null;

  @ApiPropertyOptional({ ...FREE_OBJECT, description: 'The whole payload for the lesson’s kind.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class SetCampaignCoursesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'In the order the campaign shows them. Empty clears.',
  })
  @IsArray()
  @ArrayMaxSize(BUSINESS_RULE.CAMPAIGN_COURSES_MAX)
  @IsUUID('4', { each: true })
  courseIds: string[];
}

// ------------------------------------------------------------------ the learner's view

export class LessonProgressDto {
  @ApiProperty({ example: 100 })
  percent: number;

  @ApiProperty({ nullable: true, type: Number })
  positionSeconds: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Best quiz, check or practice score.' })
  bestScore: number | null;

  @ApiProperty()
  attempts: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  completedAt: string | null;
}

export class LearnerLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  courseId: string | null;

  @ApiProperty({ enum: TrainingKind })
  kind: TrainingKind;

  @ApiProperty({ enum: TrainingStep })
  step: TrainingStep;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String })
  summary: string | null;

  @ApiProperty({ nullable: true, type: Number })
  minutes: number | null;

  @ApiProperty()
  required: boolean;

  @ApiProperty({ ...FREE_OBJECT, description: 'What the kind needs to show it — no answers.' })
  content: Record<string, unknown>;

  @ApiProperty({ type: LessonProgressDto })
  progress: LessonProgressDto;
}

export class LearnerCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [LearnerLessonDto] })
  lessons: LearnerLessonDto[];
}

export class CampaignTrainingDto {
  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty({ example: 'Pune Retail Drive' })
  projectName: string;

  @ApiProperty({ description: 'The caller may change this campaign’s training.' })
  canManage: boolean;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  certifiedAt: string | null;

  @ApiProperty({ example: 14 })
  requiredCount: number;

  @ApiProperty({ example: 9 })
  doneCount: number;

  @ApiProperty({ example: 64 })
  percent: number;

  @ApiProperty({ description: 'Practice pitches with an AI owner are switched on.' })
  roleplayEnabled: boolean;

  @ApiProperty({ example: 4 })
  roleplayLeftToday: number;

  @ApiProperty({ type: [LearnerCourseDto] })
  courses: LearnerCourseDto[];

  @ApiProperty({ type: [LearnerLessonDto], description: 'Lessons only this campaign has.' })
  campaignLessons: LearnerLessonDto[];
}

export class LessonProgressInputDto {
  @ApiProperty({ format: 'uuid', description: 'The campaign the lesson is taken in.' })
  @IsUUID('4')
  projectId: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description: 'A video: how much has been watched.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percent?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'A video: where to resume.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 3600)
  positionSeconds?: number;

  @ApiPropertyOptional({ description: 'Mark a document, card or check-free video done.' })
  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

export class AttemptInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  projectId: string;

  @ApiProperty({ type: [Number], description: 'The chosen option’s index, in question order.' })
  @IsArray()
  @ArrayMaxSize(BUSINESS_RULE.QUIZ_MAX_QUESTIONS)
  @IsInt({ each: true })
  @Min(0, { each: true })
  answers: number[];
}

export class GradedAnswerDto {
  @ApiProperty()
  questionId: string;

  @ApiProperty()
  correct: boolean;

  @ApiProperty({ description: 'The right option’s index.' })
  answer: number;

  @ApiProperty({ nullable: true, type: String })
  explanation: string | null;
}

export class AttemptResultDto {
  @ApiProperty({ example: 85 })
  score: number;

  @ApiProperty()
  passed: boolean;

  @ApiProperty({ type: [GradedAnswerDto] })
  results: GradedAnswerDto[];

  @ApiProperty({ type: LessonProgressDto })
  progress: LessonProgressDto;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Quiz tries left today; null for video checks.',
  })
  attemptsLeftToday: number | null;

  @ApiProperty({ description: 'This attempt finished the campaign’s training.' })
  certifiedNow: boolean;
}

export class LessonDoneDto {
  @ApiProperty({ type: LessonProgressDto })
  progress: LessonProgressDto;

  @ApiProperty({ description: 'This finished the campaign’s training.' })
  certifiedNow: boolean;
}

export class LessonFileDto {
  @ApiProperty({ description: 'A short-lived link to the file.' })
  url: string;

  @ApiProperty({ nullable: true, type: String })
  fileName: string | null;

  @ApiProperty({ nullable: true, type: String })
  contentType: string | null;
}

export class ProjectQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  projectId: string;
}

// ------------------------------------------------------------------ practice pitches

export class RoleplayTurnDto {
  @ApiProperty({ enum: ['rep', 'owner'] })
  role: 'rep' | 'owner';

  @ApiProperty()
  text: string;

  @ApiProperty({ format: 'date-time' })
  at: string;
}

export class RoleplayCriterionDto {
  @ApiProperty()
  criterion: string;

  @ApiProperty()
  met: boolean;

  @ApiProperty()
  note: string;
}

export class RoleplayFeedbackDto {
  @ApiProperty()
  summary: string;

  @ApiProperty({ type: [String] })
  strengths: string[];

  @ApiProperty({ type: [String] })
  improvements: string[];

  @ApiProperty({ type: [RoleplayCriterionDto] })
  criteria: RoleplayCriterionDto[];
}

export class RoleplaySessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  itemId: string;

  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  userName: string;

  @ApiProperty({ example: 'Pitch Ravi: single bakery, Pune' })
  lessonTitle: string;

  @ApiProperty({ ...FREE_OBJECT, description: 'The owner: name, shop, city, about.' })
  persona: Record<string, unknown>;

  @ApiProperty({ type: [RoleplayTurnDto] })
  turns: RoleplayTurnDto[];

  @ApiProperty()
  repTurns: number;

  @ApiProperty({ description: 'Messages a rep may send in one pitch.' })
  maxTurns: number;

  @ApiProperty()
  finished: boolean;

  @ApiProperty({ nullable: true, type: Number })
  score: number | null;

  @ApiProperty()
  passScore: number;

  @ApiProperty({ nullable: true, type: Boolean })
  passed: boolean | null;

  @ApiProperty({ type: RoleplayFeedbackDto, nullable: true })
  feedback: RoleplayFeedbackDto | null;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  finishedAt: string | null;

  @ApiProperty({ description: 'Finishing this pitch finished the campaign’s training.' })
  certifiedNow: boolean;
}

export class SendTurnDto {
  @ApiProperty({ maxLength: BUSINESS_RULE.ROLEPLAY_MESSAGE_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.ROLEPLAY_MESSAGE_MAX_LENGTH)
  message: string;
}

// ------------------------------------------------------------------ the manager's board

export class MemberTrainingDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 'sales_person' })
  role: string;

  @ApiProperty()
  doneCount: number;

  @ApiProperty()
  requiredCount: number;

  @ApiProperty()
  percent: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  certifiedAt: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Best score across the campaign’s quizzes.',
  })
  quizBest: number | null;

  @ApiProperty({ nullable: true, type: Number })
  practiceBest: number | null;

  @ApiProperty()
  practiceCount: number;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  lastActivityAt: string | null;

  @ApiProperty({ type: [String], format: 'uuid' })
  completedLessonIds: string[];
}

export class BoardLessonDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: TrainingKind })
  kind: TrainingKind;

  @ApiProperty()
  required: boolean;
}

export class PitchSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  userName: string;

  @ApiProperty()
  lessonTitle: string;

  @ApiProperty({ nullable: true, type: Number })
  score: number | null;

  @ApiProperty({ format: 'date-time' })
  startedAt: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  finishedAt: string | null;
}

export class TrainingBoardDto {
  @ApiProperty({ type: [BoardLessonDto] })
  lessons: BoardLessonDto[];

  @ApiProperty({ type: [MemberTrainingDto] })
  members: MemberTrainingDto[];

  @ApiProperty({
    type: [PitchSummaryDto],
    description: 'The latest practice pitches, newest first.',
  })
  recentPitches: PitchSummaryDto[];
}
