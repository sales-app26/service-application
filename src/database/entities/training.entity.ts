import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { TrainingKind, TrainingStep } from '../../common/enums';

/**
 * A course in the training library (`09_training.sql`), built once by the sales
 * head and attached to any number of campaigns. Drafts are invisible to reps.
 */
@Entity({ name: TABLE.TRAINING_COURSES })
export class TrainingCourse {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** @example Frostique: core sales training */
  @Column({ name: 'title', type: PG_TYPE.TEXT })
  title: string;

  @Column({ name: 'description', type: PG_TYPE.TEXT, nullable: true })
  description: string | null;

  @Column({ name: 'published', type: PG_TYPE.BOOLEAN, default: false })
  published: boolean;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}

/**
 * One lesson. It belongs to a library course, or to one campaign only — exactly
 * one of `courseId` / `projectId`. `payload` holds what its kind needs; its shape
 * is checked by `training-rules.ts`, never trusted as stored.
 */
@Entity({ name: TABLE.TRAINING_ITEMS })
export class TrainingItem {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'course_id', type: PG_TYPE.UUID, nullable: true })
  courseId: string | null;

  @Column({ name: 'project_id', type: PG_TYPE.UUID, nullable: true })
  projectId: string | null;

  @Column({ name: 'step', type: PG_TYPE.TEXT })
  step: TrainingStep;

  @Column({ name: 'kind', type: PG_TYPE.TEXT })
  kind: TrainingKind;

  @Column({ name: 'title', type: PG_TYPE.TEXT })
  title: string;

  @Column({ name: 'summary', type: PG_TYPE.TEXT, nullable: true })
  summary: string | null;

  /** Lower first. */
  @Column({ name: 'sort', type: PG_TYPE.INTEGER, default: 0 })
  sort: number;

  /** Counts toward the campaign certificate. */
  @Column({ name: 'required', type: PG_TYPE.BOOLEAN, default: true })
  required: boolean;

  @Column({ name: 'minutes', type: PG_TYPE.SMALLINT, nullable: true })
  minutes: number | null;

  @Column({ name: 'payload', type: PG_TYPE.JSONB, default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  /** A document's file in the private bucket; served through a signed URL. */
  @Column({ name: 'file_path', type: PG_TYPE.TEXT, nullable: true })
  filePath: string | null;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}

/** A library course a campaign uses, in order. */
@Entity({ name: TABLE.PROJECT_COURSES })
export class ProjectCourse {
  @PrimaryColumn({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @PrimaryColumn({ name: 'course_id', type: PG_TYPE.UUID })
  courseId: string;

  @Column({ name: 'sort', type: PG_TYPE.INTEGER, default: 0 })
  sort: number;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;
}

/** How far one person has got with one lesson. */
@Entity({ name: TABLE.TRAINING_PROGRESS })
export class TrainingProgress {
  @PrimaryColumn({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @PrimaryColumn({ name: 'item_id', type: PG_TYPE.UUID })
  itemId: string;

  @Column({ name: 'percent', type: PG_TYPE.SMALLINT, default: 0 })
  percent: number;

  /** Where a video was left, to resume. */
  @Column({ name: 'position_seconds', type: PG_TYPE.INTEGER, nullable: true })
  positionSeconds: number | null;

  /** Best quiz, check or practice-pitch score, 0–100. */
  @Column({ name: 'best_score', type: PG_TYPE.SMALLINT, nullable: true })
  bestScore: number | null;

  @Column({ name: 'attempts', type: PG_TYPE.INTEGER, default: 0 })
  attempts: number;

  /** Tries made on the India day of `lastAttemptAt`. */
  @Column({ name: 'day_attempts', type: PG_TYPE.SMALLINT, default: 0 })
  dayAttempts: number;

  @Column({ name: 'last_attempt_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  lastAttemptAt: Date | null;

  @Column({ name: 'completed_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  completedAt: Date | null;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;
}

/** One turn of a practice pitch, as stored. */
export interface RoleplayTurn {
  role: 'rep' | 'owner';
  text: string;
  at: string;
}

/** The coach's scorecard for a finished practice pitch. */
export interface RoleplayFeedback {
  summary: string;
  strengths: string[];
  improvements: string[];
  criteria: Array<{ criterion: string; met: boolean; note: string }>;
}

/** One practice pitch with the AI shop owner. */
@Entity({ name: TABLE.ROLEPLAY_SESSIONS })
export class RoleplaySession {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @Column({ name: 'item_id', type: PG_TYPE.UUID })
  itemId: string;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @Column({ name: 'transcript', type: PG_TYPE.JSONB, default: () => "'[]'::jsonb" })
  transcript: RoleplayTurn[];

  @Column({ name: 'rep_turns', type: PG_TYPE.SMALLINT, default: 0 })
  repTurns: number;

  @Column({ name: 'score', type: PG_TYPE.SMALLINT, nullable: true })
  score: number | null;

  @Column({ name: 'feedback', type: PG_TYPE.JSONB, nullable: true })
  feedback: RoleplayFeedback | null;

  @Column({ name: 'started_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  startedAt: Date;

  @Column({ name: 'finished_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  finishedAt: Date | null;
}

/** The day a person finished every required lesson of a campaign. */
@Entity({ name: TABLE.TRAINING_CERTIFICATIONS })
export class TrainingCertification {
  @PrimaryColumn({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @PrimaryColumn({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @Column({ name: 'certified_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  certifiedAt: Date;
}
