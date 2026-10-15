import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';

import {
  BUSINESS_RULE,
  COMMON_ERROR,
  ERROR_CODE,
  MIME_TYPE,
  SQL_TABLE,
  STORAGE_FOLDER,
  TRAINING_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { TrainingKind, UserRole } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { ProjectCourse, TrainingCourse, TrainingItem } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import {
  CourseDetailDto,
  CourseDto,
  CreateCourseDto,
  CreateLessonDto,
  LessonDto,
  UpdateCourseDto,
  UpdateLessonDto,
} from './dto/training.dto';
import {
  DEFAULT_STEP,
  mergePlaylistOrder,
  normalizePayload,
  PlaylistItem,
  PlaylistPayload,
} from './training-rules';
import { YoutubePlaylistClient } from './youtube-playlist.client';

/** A file as multer hands it over. */
export interface UploadedLessonFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const FILE_EXTENSION: Record<string, string> = {
  [MIME_TYPE.PDF]: 'pdf',
  [MIME_TYPE.JPEG]: 'jpg',
  [MIME_TYPE.PNG]: 'png',
  [MIME_TYPE.WEBP]: 'webp',
};

/**
 * The training library (courses and their lessons, the sales head's), campaign-only
 * lessons (a campaign's admins'), lesson files in storage, and which courses each
 * campaign uses.
 */
@Injectable()
export class TrainingLibraryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TrainingCourse) private readonly courses: Repository<TrainingCourse>,
    @InjectRepository(TrainingItem) private readonly items: Repository<TrainingItem>,
    private readonly access: ProjectAccessService,
    private readonly storage: SupabaseStorageClient,
    private readonly playlists: YoutubePlaylistClient,
  ) {}

  // ---------------------------------------------------------------- courses

  /** The Super Admin sees drafts too; a sales manager sees published courses to attach. */
  async listCourses(actor: AuthenticatedUser): Promise<CourseDto[]> {
    const rows = await this.courses.find({
      where: this.access.isSuperAdmin(actor)
        ? { deletedAt: IsNull() }
        : { deletedAt: IsNull(), published: true },
      order: { title: 'ASC' },
    });
    return this.toCourseDtos(rows);
  }

  async createCourse(actor: AuthenticatedUser, dto: CreateCourseDto): Promise<CourseDto> {
    const saved = await this.courses.save(
      this.courses.create({
        title: dto.title,
        description: dto.description ?? null,
        published: dto.published ?? false,
        createdBy: actor.id,
      }),
    );
    const [result] = await this.toCourseDtos([
      await this.courses.findOneByOrFail({ id: saved.id }),
    ]);
    return result;
  }

  async getCourse(actor: AuthenticatedUser, courseId: string): Promise<CourseDetailDto> {
    const course = await this.findCourse(courseId);
    if (!this.access.isSuperAdmin(actor) && !course.published) {
      throw new NotFoundBusinessException(TRAINING_ERROR.COURSE_NOT_FOUND);
    }
    const lessons = await this.items.find({
      where: { courseId, deletedAt: IsNull() },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    const [dto] = await this.toCourseDtos([course]);
    return { course: dto, lessons: lessons.map(toLessonDto) };
  }

  async updateCourse(
    actor: AuthenticatedUser,
    courseId: string,
    dto: UpdateCourseDto,
  ): Promise<CourseDto> {
    if (dto.title === undefined && dto.description === undefined && dto.published === undefined) {
      throw new BusinessException(TRAINING_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }
    const course = await this.findCourse(courseId);
    await this.courses.update(
      { id: course.id },
      {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.published !== undefined ? { published: dto.published } : {}),
      },
    );
    const [result] = await this.toCourseDtos([
      await this.courses.findOneByOrFail({ id: course.id }),
    ]);
    return result;
  }

  /** Hides the course and detaches it from every campaign; progress already made stays. */
  async removeCourse(actor: AuthenticatedUser, courseId: string): Promise<void> {
    const course = await this.findCourse(courseId);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(TrainingCourse, { id: course.id }, { deletedAt: new Date() });
      await manager.delete(ProjectCourse, { courseId: course.id });
    });
  }

  // ---------------------------------------------------------------- lessons

  async addCourseLesson(
    actor: AuthenticatedUser,
    courseId: string,
    dto: CreateLessonDto,
  ): Promise<LessonDto> {
    const course = await this.findCourse(courseId);
    return this.createLesson(actor, dto, { courseId: course.id, projectId: null });
  }

  async addCampaignLesson(
    actor: AuthenticatedUser,
    projectId: string,
    dto: CreateLessonDto,
  ): Promise<LessonDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);
    return this.createLesson(actor, dto, { courseId: null, projectId: project.id });
  }

  /** The full lesson, answers included: the Super Admin, or an admin of its campaign. */
  async getLesson(actor: AuthenticatedUser, lessonId: string): Promise<LessonDto> {
    return toLessonDto(await this.findEditable(actor, lessonId, false));
  }

  async updateLesson(
    actor: AuthenticatedUser,
    lessonId: string,
    dto: UpdateLessonDto,
  ): Promise<LessonDto> {
    const changes = Object.values(dto).filter((v) => v !== undefined);
    if (changes.length === 0) {
      throw new BusinessException(TRAINING_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }
    const lesson = await this.findEditable(actor, lessonId, true);
    const payload =
      dto.payload !== undefined
        ? await this.withModules(
            lesson.kind,
            normalizePayload(lesson.kind, dto.payload, lesson.payload),
            dto.payload,
            lesson.payload,
          )
        : undefined;
    if (dto.step !== undefined) lesson.step = dto.step;
    if (dto.title !== undefined) lesson.title = dto.title;
    if (dto.summary !== undefined) lesson.summary = dto.summary;
    if (dto.sort !== undefined) lesson.sort = dto.sort;
    if (dto.required !== undefined) lesson.required = dto.required;
    if (dto.minutes !== undefined) lesson.minutes = dto.minutes;
    if (payload !== undefined) lesson.payload = payload as unknown as Record<string, unknown>;
    await this.items.save(lesson);
    return toLessonDto(await this.items.findOneByOrFail({ id: lesson.id }));
  }

  /** Hides the lesson; its file stays in storage only until this returns. */
  async removeLesson(actor: AuthenticatedUser, lessonId: string): Promise<void> {
    const lesson = await this.findEditable(actor, lessonId, true);
    await this.items.update({ id: lesson.id }, { deletedAt: new Date() });
    if (lesson.filePath) await this.storage.removeObjects([lesson.filePath]);
  }

  /** Sets or replaces a document lesson's PDF or image. */
  async uploadLessonFile(
    actor: AuthenticatedUser,
    lessonId: string,
    file: UploadedLessonFile | undefined,
  ): Promise<LessonDto> {
    const lesson = await this.findEditable(actor, lessonId, true);
    if (lesson.kind !== TrainingKind.DOCUMENT) {
      throw new BusinessException(TRAINING_ERROR.WRONG_KIND, ERROR_CODE.VALIDATION_FAILED);
    }
    if (!file || file.size === 0) {
      throw new BusinessException(TRAINING_ERROR.FILE_REQUIRED, ERROR_CODE.VALIDATION_FAILED);
    }
    const extension = FILE_EXTENSION[file.mimetype];
    if (!extension) {
      throw new BusinessException(TRAINING_ERROR.FILE_TYPE, ERROR_CODE.VALIDATION_FAILED);
    }
    if (file.size > BUSINESS_RULE.LESSON_FILE_MAX_BYTES) {
      throw new BusinessException(TRAINING_ERROR.FILE_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }

    const path = `${STORAGE_FOLDER.TRAINING}/${lesson.id}/${randomUUID()}.${extension}`;
    await this.storage.upload(path, file.buffer, file.mimetype);
    const fileName = cleanFileName(file.originalname, extension);
    try {
      await this.items.save({
        ...lesson,
        filePath: path,
        payload: { ...lesson.payload, fileName, contentType: file.mimetype, sizeBytes: file.size },
      });
    } catch (error) {
      await this.storage.removeObjects([path]);
      throw error;
    }
    if (lesson.filePath) await this.storage.removeObjects([lesson.filePath]);
    return toLessonDto(await this.items.findOneByOrFail({ id: lesson.id }));
  }

  // ---------------------------------------------------------------- campaigns

  /** Replaces the list of library courses a campaign uses, in order. */
  async setCampaignCourses(
    actor: AuthenticatedUser,
    projectId: string,
    courseIds: string[],
  ): Promise<CourseDto[]> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);
    const unique = [...new Set(courseIds)];
    if (unique.length > BUSINESS_RULE.CAMPAIGN_COURSES_MAX) {
      throw new BusinessException(TRAINING_ERROR.TOO_MANY_COURSES, ERROR_CODE.VALIDATION_FAILED);
    }
    const rows = unique.length
      ? await this.courses.find({ where: { id: In(unique), deletedAt: IsNull() } })
      : [];
    const byId = new Map(rows.map((c) => [c.id, c]));
    for (const id of unique) {
      const course = byId.get(id);
      if (!course) throw new NotFoundBusinessException(TRAINING_ERROR.COURSE_NOT_FOUND);
      if (!course.published) {
        throw new BusinessException(
          TRAINING_ERROR.COURSE_UNPUBLISHED(course.title),
          ERROR_CODE.VALIDATION_FAILED,
        );
      }
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProjectCourse, { projectId });
      if (unique.length) {
        await manager.insert(
          ProjectCourse,
          unique.map((courseId, sort) => ({ projectId, courseId, sort, createdBy: actor.id })),
        );
      }
    });
    return this.toCourseDtos(unique.map((id) => byId.get(id) as TrainingCourse));
  }

  /** The library courses a campaign uses, in order (drafts included for the Super Admin). */
  async campaignCourses(actor: AuthenticatedUser, projectId: string): Promise<CourseDto[]> {
    await this.access.assertAdmin(actor, projectId);
    const rows = (await this.dataSource.query(
      `SELECT pc.course_id AS id FROM ${SQL_TABLE.PROJECT_COURSES} pc
         JOIN ${SQL_TABLE.TRAINING_COURSES} c ON c.id = pc.course_id AND c.deleted_at IS NULL
        WHERE pc.project_id = $1 ORDER BY pc.sort, pc.created_at`,
      [projectId],
    )) as Array<{ id: string }>;
    if (rows.length === 0) return [];
    const courses = await this.courses.find({ where: { id: In(rows.map((r) => r.id)) } });
    const byId = new Map(courses.map((c) => [c.id, c]));
    return this.toCourseDtos(rows.map((r) => byId.get(r.id) as TrainingCourse));
  }

  /** A campaign's own lessons, in full, for its admins to edit. */
  async campaignOwnLessons(actor: AuthenticatedUser, projectId: string): Promise<LessonDto[]> {
    await this.access.assertAdmin(actor, projectId);
    const rows = await this.items.find({
      where: { projectId, deletedAt: IsNull() },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    return rows.map(toLessonDto);
  }

  // ---------------------------------------------------------------- helpers

  private async createLesson(
    actor: AuthenticatedUser,
    dto: CreateLessonDto,
    owner: { courseId: string | null; projectId: string | null },
  ): Promise<LessonDto> {
    const payload = await this.withModules(
      dto.kind,
      normalizePayload(dto.kind, dto.payload),
      dto.payload,
      null,
    );
    const saved = await this.items.save(
      this.items.create({
        ...owner,
        kind: dto.kind,
        step: dto.step ?? DEFAULT_STEP[dto.kind],
        title: dto.title,
        summary: dto.summary ?? null,
        sort: dto.sort ?? 0,
        required: dto.required ?? true,
        minutes: dto.minutes ?? null,
        payload: payload as unknown as Record<string, unknown>,
        createdBy: actor.id,
      }),
    );
    return toLessonDto(await this.items.findOneByOrFail({ id: saved.id }));
  }

  /**
   * A playlist lesson's modules, read from YouTube when its link is new or the admin asks to
   * refresh (`refresh: true`); otherwise the order and titles the admin set. A refresh keeps the
   * admin's order and adds new videos at the end. Other kinds pass through unchanged.
   */
  private async withModules<T>(
    kind: TrainingKind,
    payload: T,
    raw: Record<string, unknown>,
    current: Record<string, unknown> | null,
  ): Promise<T> {
    if (kind !== TrainingKind.PLAYLIST) return payload;
    const next = payload as unknown as PlaylistPayload;
    const before = current as unknown as PlaylistPayload | null;
    const samePlaylist = before?.playlistId === next.playlistId;
    if (next.items.length > 0 && samePlaylist && raw.refresh !== true) return payload;
    const listed = await this.playlists.list(next.playlistId);
    const arranged = next.items.length > 0 ? next.items : (before?.items ?? []);
    let items: PlaylistItem[] = [];
    if (listed) items = samePlaylist ? mergePlaylistOrder(arranged, listed.items) : listed.items;
    else if (samePlaylist) items = arranged;
    return { ...next, items: items.slice(0, BUSINESS_RULE.PLAYLIST_MAX_ITEMS) } as unknown as T;
  }

  private async findCourse(courseId: string): Promise<TrainingCourse> {
    const course = await this.courses.findOne({ where: { id: courseId, deletedAt: IsNull() } });
    if (!course) throw new NotFoundBusinessException(TRAINING_ERROR.COURSE_NOT_FOUND);
    return course;
  }

  /**
   * A live lesson the caller may change: a library lesson only by the Super Admin,
   * a campaign lesson by that campaign's admins (and only while it is open, when
   * `writing`). Anyone else gets 404 or 403 the way templates do.
   */
  private async findEditable(
    actor: AuthenticatedUser,
    lessonId: string,
    writing: boolean,
  ): Promise<TrainingItem> {
    const lesson = await this.items.findOne({ where: { id: lessonId, deletedAt: IsNull() } });
    if (!lesson) throw new NotFoundBusinessException(TRAINING_ERROR.LESSON_NOT_FOUND);
    if (lesson.courseId) {
      if (this.access.isSuperAdmin(actor)) return lesson;
      if (actor.role === UserRole.MODERATOR && !writing) return lesson;
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }
    try {
      await this.access.assertCanView(actor, lesson.projectId as string);
    } catch {
      throw new NotFoundBusinessException(TRAINING_ERROR.LESSON_NOT_FOUND);
    }
    const project = await this.access.assertAdmin(actor, lesson.projectId as string);
    if (writing) this.access.assertWritable(project);
    return lesson;
  }

  private async toCourseDtos(rows: TrainingCourse[]): Promise<CourseDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const counts = (await this.dataSource.query(
      `SELECT c.id,
              (SELECT count(*)::int FROM ${SQL_TABLE.TRAINING_ITEMS} i
                WHERE i.course_id = c.id AND i.deleted_at IS NULL) AS lessons,
              (SELECT count(*)::int FROM ${SQL_TABLE.PROJECT_COURSES} pc
                WHERE pc.course_id = c.id) AS campaigns
         FROM ${SQL_TABLE.TRAINING_COURSES} c WHERE c.id = ANY($1::uuid[])`,
      [ids],
    )) as Array<{ id: string; lessons: number; campaigns: number }>;
    const byId = new Map(counts.map((c) => [c.id, c]));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      published: r.published,
      lessonCount: byId.get(r.id)?.lessons ?? 0,
      campaignCount: byId.get(r.id)?.campaigns ?? 0,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}

export const toLessonDto = (row: TrainingItem): LessonDto => ({
  id: row.id,
  courseId: row.courseId,
  projectId: row.projectId,
  step: row.step,
  kind: row.kind,
  title: row.title,
  summary: row.summary,
  sort: row.sort,
  required: row.required,
  minutes: row.minutes,
  payload: row.payload,
  hasFile: row.filePath !== null,
});

/** The uploaded name, shortened and with the right extension, for the "Open" button. */
const cleanFileName = (name: string, extension: string): string => {
  const base = name
    .replace(/\.[^.]+$/u, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, BUSINESS_RULE.LESSON_FILE_NAME_MAX_LENGTH - extension.length - 1);
  return `${base || 'document'}.${extension}`;
};
