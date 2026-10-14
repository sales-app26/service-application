import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { CONFIG_NAMESPACE, ERROR_CODE, SQL_TABLE, TRAINING_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { TrainingKind } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { istStartOfDay, istToday } from '../../common/utils';
import { TrainingConfig } from '../../config/configuration';
import {
  RoleplaySession,
  RoleplayTurn,
  TrainingItem,
  TrainingProgress,
} from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { CampaignLessonsService } from './campaign-lessons.service';
import { RoleplaySessionDto } from './dto/training.dto';
import { RoleplayCoachClient } from './roleplay-coach.client';
import { RoleplayPayload } from './training-rules';

/**
 * Practice pitches with an AI shop owner: start one (a few a day), talk, finish
 * for a score. The best score counts toward the campaign's training like a quiz.
 */
@Injectable()
export class RoleplayService {
  private readonly config: TrainingConfig;

  constructor(
    configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RoleplaySession) private readonly sessions: Repository<RoleplaySession>,
    @InjectRepository(TrainingItem) private readonly items: Repository<TrainingItem>,
    @InjectRepository(TrainingProgress) private readonly progress: Repository<TrainingProgress>,
    private readonly access: ProjectAccessService,
    private readonly lessons: CampaignLessonsService,
    private readonly coach: RoleplayCoachClient,
  ) {
    this.config = configService.getOrThrow<TrainingConfig>(CONFIG_NAMESPACE.TRAINING);
  }

  async start(
    actor: AuthenticatedUser,
    lessonId: string,
    projectId: string,
  ): Promise<RoleplaySessionDto> {
    const { lesson } = await this.lessons.lessonInCampaign(actor, lessonId, projectId);
    if (lesson.kind !== TrainingKind.ROLEPLAY) {
      throw new BusinessException(TRAINING_ERROR.WRONG_KIND, ERROR_CODE.VALIDATION_FAILED);
    }
    if (!this.coach.enabled) {
      throw new BusinessException(TRAINING_ERROR.ROLEPLAY_OFF, ERROR_CODE.UNPROCESSABLE);
    }
    if ((await this.startedToday(actor.id)) >= this.config.roleplayDailyLimit) {
      throw new BusinessException(
        TRAINING_ERROR.ROLEPLAY_DAILY_LIMIT(this.config.roleplayDailyLimit),
        ERROR_CODE.RATE_LIMITED,
      );
    }
    const scenario = lesson.payload as unknown as RoleplayPayload;
    const opener = scenario.opener ?? (await this.coach.ownerReply(scenario, []));
    const session = await this.sessions.save(
      this.sessions.create({
        userId: actor.id,
        itemId: lesson.id,
        projectId,
        transcript: [{ role: 'owner', text: opener, at: new Date().toISOString() }],
        repTurns: 0,
        startedAt: new Date(),
      }),
    );
    return this.toDto(session, lesson, actor.name, false);
  }

  async turn(
    actor: AuthenticatedUser,
    sessionId: string,
    message: string,
  ): Promise<RoleplaySessionDto> {
    const { session, lesson } = await this.ownOpenSession(actor, sessionId);
    if (session.repTurns >= this.config.roleplayMaxTurns) {
      throw new BusinessException(
        TRAINING_ERROR.ROLEPLAY_TOO_LONG(this.config.roleplayMaxTurns),
        ERROR_CODE.UNPROCESSABLE,
      );
    }
    const scenario = lesson.payload as unknown as RoleplayPayload;
    const turns: RoleplayTurn[] = [
      ...session.transcript,
      { role: 'rep', text: message, at: new Date().toISOString() },
    ];
    // Nothing is saved until the owner has answered, so a failed call can be retried.
    const reply = await this.coach.ownerReply(scenario, turns);
    turns.push({ role: 'owner', text: reply, at: new Date().toISOString() });
    session.transcript = turns;
    session.repTurns += 1;
    await this.sessions.save(session);
    return this.toDto(session, lesson, actor.name, false);
  }

  async finish(actor: AuthenticatedUser, sessionId: string): Promise<RoleplaySessionDto> {
    const { session, lesson } = await this.ownOpenSession(actor, sessionId);
    if (session.repTurns === 0) {
      throw new BusinessException(TRAINING_ERROR.ROLEPLAY_EMPTY, ERROR_CODE.VALIDATION_FAILED);
    }
    const scenario = lesson.payload as unknown as RoleplayPayload;
    const result = await this.coach.score(scenario, session.transcript);
    const now = new Date();
    session.score = result.score;
    session.feedback = {
      summary: result.summary,
      strengths: result.strengths,
      improvements: result.improvements,
      criteria: result.criteria,
    };
    session.finishedAt = now;

    const passed = result.score >= scenario.passScore;
    await this.dataSource.transaction(async (manager) => {
      await manager.save(session);
      const repo = manager.getRepository(TrainingProgress);
      const row =
        (await repo.findOne({ where: { userId: actor.id, itemId: lesson.id } })) ??
        repo.create({
          userId: actor.id,
          itemId: lesson.id,
          percent: 0,
          attempts: 0,
          dayAttempts: 0,
        });
      row.attempts += 1;
      row.lastAttemptAt = now;
      row.bestScore = Math.max(row.bestScore ?? 0, result.score);
      if (passed && !row.completedAt) {
        row.completedAt = now;
        row.percent = 100;
      }
      await repo.save(row);
    });

    const project = await this.access.findProjectOrFail(session.projectId);
    const certifiedNow = passed
      ? await this.lessons.certifyIfComplete(actor.id, actor.name, project)
      : false;
    return this.toDto(session, lesson, actor.name, certifiedNow);
  }

  /** A pitch: its rep, or an admin of its campaign. */
  async get(actor: AuthenticatedUser, sessionId: string): Promise<RoleplaySessionDto> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundBusinessException(TRAINING_ERROR.ROLEPLAY_NOT_FOUND);
    if (session.userId !== actor.id && !(await this.access.isAdminOf(actor, session.projectId))) {
      throw new NotFoundBusinessException(TRAINING_ERROR.ROLEPLAY_NOT_FOUND);
    }
    const lesson = await this.items.findOneByOrFail({ id: session.itemId });
    const rows = (await this.dataSource.query(`SELECT name FROM ${SQL_TABLE.USERS} WHERE id = $1`, [
      session.userId,
    ])) as Array<{ name: string }>;
    return this.toDto(session, lesson, rows[0]?.name ?? '', false);
  }

  /** The caller's own pitches for one lesson in one campaign, newest first. */
  async mine(
    actor: AuthenticatedUser,
    lessonId: string,
    projectId: string,
  ): Promise<RoleplaySessionDto[]> {
    const { lesson } = await this.lessons.lessonInCampaign(actor, lessonId, projectId);
    const rows = await this.sessions.find({
      where: { userId: actor.id, itemId: lesson.id, projectId },
      order: { startedAt: 'DESC' },
      take: 20,
    });
    return rows.map((s) => this.toDto(s, lesson, actor.name, false));
  }

  private async startedToday(userId: string): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ${SQL_TABLE.ROLEPLAY_SESSIONS}
        WHERE user_id = $1 AND started_at >= $2`,
      [userId, istStartOfDay(istToday())],
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** The caller's own pitch, still open, and its lesson (which must still exist). */
  private async ownOpenSession(
    actor: AuthenticatedUser,
    sessionId: string,
  ): Promise<{ session: RoleplaySession; lesson: TrainingItem }> {
    const session = await this.sessions.findOne({ where: { id: sessionId, userId: actor.id } });
    if (!session) throw new NotFoundBusinessException(TRAINING_ERROR.ROLEPLAY_NOT_FOUND);
    if (session.finishedAt) throw new ConflictBusinessException(TRAINING_ERROR.ROLEPLAY_FINISHED);
    const { lesson } = await this.lessons.lessonInCampaign(
      actor,
      session.itemId,
      session.projectId,
    );
    return { session, lesson };
  }

  private toDto(
    session: RoleplaySession,
    lesson: TrainingItem,
    userName: string,
    certifiedNow: boolean,
  ): RoleplaySessionDto {
    const scenario = lesson.payload as unknown as RoleplayPayload;
    return {
      id: session.id,
      itemId: session.itemId,
      projectId: session.projectId,
      userId: session.userId,
      userName,
      lessonTitle: lesson.title,
      persona: { ...scenario.persona },
      turns: session.transcript,
      repTurns: session.repTurns,
      maxTurns: this.config.roleplayMaxTurns,
      finished: session.finishedAt !== null,
      score: session.score,
      passScore: scenario.passScore,
      passed: session.score === null ? null : session.score >= scenario.passScore,
      feedback: session.feedback,
      startedAt: session.startedAt.toISOString(),
      finishedAt: session.finishedAt ? session.finishedAt.toISOString() : null,
      certifiedNow,
    };
  }
}
