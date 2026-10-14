import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  BUSINESS_RULE,
  CONFIG_NAMESPACE,
  ERROR_CODE,
  SQL_TABLE,
  TRAINING_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { TrainingKind } from '../../common/enums';
import {
  BusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { istStartOfDay, istToday, isSameIstDay } from '../../common/utils';
import { TrainingConfig } from '../../config/configuration';
import {
  Project,
  TrainingCertification,
  TrainingItem,
  TrainingProgress,
} from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { CampaignLessonsService } from './campaign-lessons.service';
import {
  AttemptInputDto,
  AttemptResultDto,
  CampaignTrainingDto,
  LearnerLessonDto,
  LessonDoneDto,
  LessonFileDto,
  LessonProgressDto,
  LessonProgressInputDto,
  TrainingBoardDto,
} from './dto/training.dto';
import {
  completionPercent,
  DocumentPayload,
  gradeAnswers,
  learnerContent,
  playlistProgress,
  PlaylistPayload,
  QuizPayload,
  VideoPayload,
} from './training-rules';

const NO_PROGRESS: LessonProgressDto = {
  percent: 0,
  positionSeconds: null,
  bestScore: null,
  attempts: 0,
  completedAt: null,
  watched: {},
};

const toProgressDto = (row: TrainingProgress | undefined): LessonProgressDto =>
  row
    ? {
        percent: row.percent,
        positionSeconds: row.positionSeconds,
        bestScore: row.bestScore,
        attempts: row.attempts,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        watched: row.details?.watched ?? {},
      }
    : NO_PROGRESS;

/**
 * Training as a member takes it: a campaign's lessons with their progress,
 * marking lessons done, quiz and check attempts, lesson files — and the
 * campaign's progress board for its managers.
 */
@Injectable()
export class TrainingService {
  private readonly config: TrainingConfig;

  constructor(
    configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TrainingProgress) private readonly progress: Repository<TrainingProgress>,
    @InjectRepository(TrainingCertification)
    private readonly certifications: Repository<TrainingCertification>,
    private readonly access: ProjectAccessService,
    private readonly lessons: CampaignLessonsService,
    private readonly storage: SupabaseStorageClient,
  ) {
    this.config = configService.getOrThrow<TrainingConfig>(CONFIG_NAMESPACE.TRAINING);
  }

  async campaignTraining(
    actor: AuthenticatedUser,
    projectId: string,
  ): Promise<CampaignTrainingDto> {
    const project = await this.access.assertCanView(actor, projectId);
    const { courses, campaignLessons, all } = await this.lessons.lessonsOf(projectId);
    const progress = await this.lessons.progressFor(
      actor.id,
      all.map((l) => l.id),
    );
    const required = all.filter((l) => l.required);
    const done = required.filter((l) => progress.get(l.id)?.completedAt).length;
    const certificate = await this.certifications.findOne({
      where: { userId: actor.id, projectId },
    });
    const toLearner = (lesson: TrainingItem): LearnerLessonDto => ({
      id: lesson.id,
      courseId: lesson.courseId,
      kind: lesson.kind,
      step: lesson.step,
      title: lesson.title,
      summary: lesson.summary,
      minutes: lesson.minutes,
      required: lesson.required,
      content: learnerContent(lesson.kind, lesson.payload, lesson.filePath !== null),
      progress: toProgressDto(progress.get(lesson.id)),
    });
    return {
      projectId,
      projectName: project.name,
      canManage: await this.access.isAdminOf(actor, projectId),
      certifiedAt: certificate ? certificate.certifiedAt.toISOString() : null,
      requiredCount: required.length,
      doneCount: done,
      percent: completionPercent(done, required.length),
      roleplayEnabled: this.config.anthropicApiKey.length > 0,
      roleplayLeftToday: await this.roleplayLeftToday(actor.id),
      courses: courses.map(({ course, lessons }) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        lessons: lessons.map(toLearner),
      })),
      campaignLessons: campaignLessons.map(toLearner),
    };
  }

  /** Practice pitches the person may still start today (India day). */
  async roleplayLeftToday(userId: string): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ${SQL_TABLE.ROLEPLAY_SESSIONS}
        WHERE user_id = $1 AND started_at >= $2`,
      [userId, istStartOfDay(istToday())],
    )) as Array<{ n: number }>;
    return Math.max(0, this.config.roleplayDailyLimit - (rows[0]?.n ?? 0));
  }

  /** Watching a video, or reading a document or card. Quizzes and pitches have their own routes. */
  async recordProgress(
    actor: AuthenticatedUser,
    lessonId: string,
    dto: LessonProgressInputDto,
  ): Promise<LessonDoneDto> {
    const { lesson, project } = await this.lessons.lessonInCampaign(actor, lessonId, dto.projectId);
    if (lesson.kind === TrainingKind.QUIZ || lesson.kind === TrainingKind.ROLEPLAY) {
      throw new BusinessException(TRAINING_ERROR.WRONG_KIND, ERROR_CODE.VALIDATION_FAILED);
    }
    const row = await this.loadProgress(actor.id, lesson.id);
    if (lesson.kind === TrainingKind.PLAYLIST) {
      return this.recordModule(
        actor,
        row,
        lesson.payload as unknown as PlaylistPayload,
        project,
        dto,
      );
    }
    if (dto.percent !== undefined) row.percent = Math.max(row.percent, dto.percent);
    if (dto.positionSeconds !== undefined) row.positionSeconds = dto.positionSeconds;

    // A video with checks is done by answering them (the attempt route).
    const hasChecks =
      lesson.kind === TrainingKind.VIDEO &&
      ((lesson.payload as unknown as VideoPayload).checks ?? []).length > 0;
    const watched =
      lesson.kind === TrainingKind.VIDEO && row.percent >= BUSINESS_RULE.VIDEO_DONE_PERCENT;
    if (!row.completedAt && !hasChecks && (dto.done === true || watched)) {
      row.completedAt = new Date();
      row.percent = 100;
    }
    await this.progress.save(row);
    const certifiedNow = row.completedAt
      ? await this.lessons.certifyIfComplete(actor.id, actor.name, project)
      : false;
    return { progress: toProgressDto(row), certifiedNow };
  }

  /**
   * One module of a playlist watched (or part of it). The lesson is done when every module
   * is watched to 90%. A playlist YouTube didn't list is marked done by the rep (`done`).
   */
  private async recordModule(
    actor: AuthenticatedUser,
    row: TrainingProgress,
    playlist: PlaylistPayload,
    project: Pick<Project, 'id' | 'name'>,
    dto: LessonProgressInputDto,
  ): Promise<LessonDoneDto> {
    const items = playlist.items ?? [];
    if (items.length === 0) {
      if (dto.done === true && !row.completedAt) {
        row.completedAt = new Date();
        row.percent = 100;
      }
    } else {
      if (!dto.moduleId || !items.some((i) => i.youtubeId === dto.moduleId)) {
        throw new BusinessException(
          TRAINING_ERROR.MODULE_NOT_IN_PLAYLIST,
          ERROR_CODE.VALIDATION_FAILED,
        );
      }
      const watched = { ...(row.details?.watched ?? {}) };
      const seen = dto.done === true ? 100 : (dto.percent ?? 0);
      watched[dto.moduleId] = Math.max(watched[dto.moduleId] ?? 0, seen);
      row.details = { watched };
      const { percent, complete } = playlistProgress(
        items,
        watched,
        BUSINESS_RULE.VIDEO_DONE_PERCENT,
      );
      row.percent = Math.max(row.percent, percent);
      if (complete && !row.completedAt) row.completedAt = new Date();
    }
    await this.progress.save(row);
    const certifiedNow = row.completedAt
      ? await this.lessons.certifyIfComplete(actor.id, actor.name, project)
      : false;
    return { progress: toProgressDto(row), certifiedNow };
  }

  /** Grades a quiz, or the checks after a video. */
  async attempt(
    actor: AuthenticatedUser,
    lessonId: string,
    dto: AttemptInputDto,
  ): Promise<AttemptResultDto> {
    const { lesson, project } = await this.lessons.lessonInCampaign(actor, lessonId, dto.projectId);
    const row = await this.loadProgress(actor.id, lesson.id);
    const now = new Date();
    const triesToday =
      row.lastAttemptAt && isSameIstDay(row.lastAttemptAt, now) ? row.dayAttempts : 0;

    let grade;
    let attemptsLeftToday: number | null = null;
    if (lesson.kind === TrainingKind.QUIZ) {
      const quiz = lesson.payload as unknown as QuizPayload;
      if (!row.completedAt && triesToday >= BUSINESS_RULE.QUIZ_ATTEMPTS_PER_DAY) {
        throw new BusinessException(
          TRAINING_ERROR.ATTEMPTS_TODAY(BUSINESS_RULE.QUIZ_ATTEMPTS_PER_DAY),
          ERROR_CODE.RATE_LIMITED,
        );
      }
      grade = gradeAnswers(quiz.questions, dto.answers, quiz.passPercent);
      attemptsLeftToday = Math.max(0, BUSINESS_RULE.QUIZ_ATTEMPTS_PER_DAY - triesToday - 1);
    } else if (lesson.kind === TrainingKind.VIDEO) {
      const checks = (lesson.payload as unknown as VideoPayload).checks ?? [];
      if (checks.length === 0) {
        throw new BusinessException(TRAINING_ERROR.WRONG_KIND, ERROR_CODE.VALIDATION_FAILED);
      }
      grade = gradeAnswers(checks, dto.answers, 100);
    } else {
      throw new BusinessException(TRAINING_ERROR.WRONG_KIND, ERROR_CODE.VALIDATION_FAILED);
    }

    row.attempts += 1;
    row.dayAttempts = triesToday + 1;
    row.lastAttemptAt = now;
    row.bestScore = Math.max(row.bestScore ?? 0, grade.score);
    if (grade.passed && !row.completedAt) {
      row.completedAt = now;
      row.percent = 100;
    }
    await this.progress.save(row);
    const certifiedNow = grade.passed
      ? await this.lessons.certifyIfComplete(actor.id, actor.name, project)
      : false;
    return { ...grade, progress: toProgressDto(row), attemptsLeftToday, certifiedNow };
  }

  /** A short-lived link to a document lesson's file. */
  async lessonFile(
    actor: AuthenticatedUser,
    lessonId: string,
    projectId: string,
  ): Promise<LessonFileDto> {
    const { lesson } = await this.lessons.lessonInCampaign(actor, lessonId, projectId);
    if (lesson.kind !== TrainingKind.DOCUMENT || !lesson.filePath) {
      throw new NotFoundBusinessException(TRAINING_ERROR.NO_FILE);
    }
    const url = await this.storage.signedUrl(lesson.filePath);
    if (!url) throw new NotFoundBusinessException(TRAINING_ERROR.NO_FILE);
    const payload = lesson.payload as unknown as DocumentPayload;
    return { url, fileName: payload.fileName ?? null, contentType: payload.contentType ?? null };
  }

  /** Every active member of the campaign against its lessons. */
  async board(actor: AuthenticatedUser, projectId: string): Promise<TrainingBoardDto> {
    await this.access.assertAdmin(actor, projectId);
    const { all } = await this.lessons.lessonsOf(projectId);
    const lessonIds = all.map((l) => l.id);
    const required = new Set(all.filter((l) => l.required).map((l) => l.id));
    const quizIds = new Set(all.filter((l) => l.kind === TrainingKind.QUIZ).map((l) => l.id));
    const titleById = new Map(all.map((l) => [l.id, l.title]));

    const members = (await this.dataSource.query(
      `SELECT u.id, u.name, u.role, c.certified_at
         FROM ${SQL_TABLE.PROJECT_MEMBERS} m
         JOIN ${SQL_TABLE.USERS} u ON u.id = m.user_id AND u.is_active AND u.deleted_at IS NULL
         LEFT JOIN ${SQL_TABLE.TRAINING_CERTIFICATIONS} c
           ON c.user_id = u.id AND c.project_id = m.project_id
        WHERE m.project_id = $1 AND m.is_active
        ORDER BY lower(u.name)`,
      [projectId],
    )) as Array<{ id: string; name: string; role: string; certified_at: Date | null }>;
    const memberIds = members.map((m) => m.id);

    const progressRows = (
      memberIds.length && lessonIds.length
        ? await this.dataSource.query(
            `SELECT user_id, item_id, best_score, completed_at, updated_at
             FROM ${SQL_TABLE.TRAINING_PROGRESS}
            WHERE user_id = ANY($1::uuid[]) AND item_id = ANY($2::uuid[])`,
            [memberIds, lessonIds],
          )
        : []
    ) as Array<{
      user_id: string;
      item_id: string;
      best_score: number | null;
      completed_at: Date | null;
      updated_at: Date;
    }>;

    const pitches = (
      memberIds.length
        ? await this.dataSource.query(
            `SELECT s.id, s.user_id, s.item_id, s.score, s.started_at, s.finished_at
             FROM ${SQL_TABLE.ROLEPLAY_SESSIONS} s
            WHERE s.project_id = $1 AND s.user_id = ANY($2::uuid[])
            ORDER BY s.started_at DESC`,
            [projectId, memberIds],
          )
        : []
    ) as Array<{
      id: string;
      user_id: string;
      item_id: string;
      score: number | null;
      started_at: Date;
      finished_at: Date | null;
    }>;

    const nameById = new Map(members.map((m) => [m.id, m.name]));
    const latest = (a: Date | null, b: Date | null): Date | null =>
      !a ? b : !b ? a : a > b ? a : b;

    return {
      lessons: all.map((l) => ({ id: l.id, title: l.title, kind: l.kind, required: l.required })),
      members: members.map((m) => {
        const mine = progressRows.filter((p) => p.user_id === m.id);
        const completed = mine.filter((p) => p.completed_at);
        const doneRequired = completed.filter((p) => required.has(p.item_id)).length;
        const quizScores = mine
          .filter((p) => quizIds.has(p.item_id) && p.best_score !== null)
          .map((p) => p.best_score as number);
        const myPitches = pitches.filter((p) => p.user_id === m.id);
        const scored = myPitches.filter((p) => p.score !== null).map((p) => p.score as number);
        let last: Date | null = null;
        for (const p of mine) last = latest(last, p.updated_at);
        for (const p of myPitches) last = latest(last, p.finished_at ?? p.started_at);
        return {
          userId: m.id,
          name: m.name,
          role: m.role,
          doneCount: doneRequired,
          requiredCount: required.size,
          percent: completionPercent(doneRequired, required.size),
          certifiedAt: m.certified_at ? new Date(m.certified_at).toISOString() : null,
          quizBest: quizScores.length ? Math.max(...quizScores) : null,
          practiceBest: scored.length ? Math.max(...scored) : null,
          practiceCount: myPitches.length,
          lastActivityAt: last ? new Date(last).toISOString() : null,
          completedLessonIds: completed.map((p) => p.item_id),
        };
      }),
      recentPitches: pitches.slice(0, 20).map((p) => ({
        id: p.id,
        userId: p.user_id,
        userName: nameById.get(p.user_id) ?? '',
        lessonTitle: titleById.get(p.item_id) ?? '',
        score: p.score,
        startedAt: new Date(p.started_at).toISOString(),
        finishedAt: p.finished_at ? new Date(p.finished_at).toISOString() : null,
      })),
    };
  }

  private async loadProgress(userId: string, itemId: string): Promise<TrainingProgress> {
    return (
      (await this.progress.findOne({ where: { userId, itemId } })) ??
      this.progress.create({
        userId,
        itemId,
        percent: 0,
        positionSeconds: null,
        bestScore: null,
        attempts: 0,
        dayAttempts: 0,
        lastAttemptAt: null,
        completedAt: null,
        details: {},
      })
    );
  }
}
