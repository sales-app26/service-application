import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';

import {
  NOTIFICATION_LINK,
  NOTIFICATION_TEXT,
  SQL_TABLE,
  TRAINING_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { NotificationKind } from '../../common/enums';
import { NotFoundBusinessException } from '../../common/exceptions/business.exception';
import {
  Project,
  ProjectCourse,
  TrainingCertification,
  TrainingCourse,
  TrainingItem,
  TrainingProgress,
} from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { NotificationSenderService } from '../notifications/notification-sender.service';

/** A campaign's training: its published library courses, in order, then its own lessons. */
export interface CampaignLessons {
  courses: Array<{ course: TrainingCourse; lessons: TrainingItem[] }>;
  campaignLessons: TrainingItem[];
  /** Every lesson above, in the order a rep meets them. */
  all: TrainingItem[];
}

const byOrder = (a: TrainingItem, b: TrainingItem): number =>
  a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime();

/**
 * Which lessons belong to a campaign, whether one does, and when a person has
 * finished them. Shared by the learner screens, the manager's board and the
 * practice pitches, so "part of this campaign" and "certified" mean one thing.
 */
@Injectable()
export class CampaignLessonsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(TrainingItem) private readonly items: Repository<TrainingItem>,
    @InjectRepository(TrainingCourse) private readonly courses: Repository<TrainingCourse>,
    @InjectRepository(ProjectCourse) private readonly projectCourses: Repository<ProjectCourse>,
    @InjectRepository(TrainingProgress) private readonly progress: Repository<TrainingProgress>,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationSenderService,
  ) {}

  async lessonsOf(projectId: string): Promise<CampaignLessons> {
    const links = await this.projectCourses.find({
      where: { projectId },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    const courseIds = links.map((l) => l.courseId);
    const courseRows = courseIds.length
      ? await this.courses.find({
          where: { id: In(courseIds), published: true, deletedAt: IsNull() },
        })
      : [];
    const courseById = new Map(courseRows.map((c) => [c.id, c]));
    const liveCourseIds = courseIds.filter((id) => courseById.has(id));

    const lessonRows = await this.items
      .createQueryBuilder('i')
      .where('i.deleted_at IS NULL')
      .andWhere(
        liveCourseIds.length
          ? '(i.project_id = :projectId OR i.course_id IN (:...courseIds))'
          : 'i.project_id = :projectId',
        { projectId, courseIds: liveCourseIds },
      )
      .getMany();

    const courses = liveCourseIds.map((id) => ({
      course: courseById.get(id) as TrainingCourse,
      lessons: lessonRows.filter((l) => l.courseId === id).sort(byOrder),
    }));
    const campaignLessons = lessonRows.filter((l) => l.projectId === projectId).sort(byOrder);
    return {
      courses,
      campaignLessons,
      all: [...courses.flatMap((c) => c.lessons), ...campaignLessons],
    };
  }

  /**
   * The lesson, if the caller can see the campaign and the lesson is part of its
   * training. Anything else reads as "not found".
   */
  async lessonInCampaign(
    actor: AuthenticatedUser,
    lessonId: string,
    projectId: string,
  ): Promise<{ lesson: TrainingItem; project: Project }> {
    const project = await this.access.assertCanView(actor, projectId);
    const lesson = await this.items.findOne({ where: { id: lessonId, deletedAt: IsNull() } });
    if (!lesson) throw new NotFoundBusinessException(TRAINING_ERROR.LESSON_NOT_FOUND);
    if (lesson.projectId === projectId) return { lesson, project };
    if (lesson.courseId) {
      const linked = await this.dataSource.query(
        `SELECT 1 FROM ${SQL_TABLE.PROJECT_COURSES} pc
           JOIN ${SQL_TABLE.TRAINING_COURSES} c ON c.id = pc.course_id
          WHERE pc.project_id = $1 AND pc.course_id = $2 AND c.published AND c.deleted_at IS NULL`,
        [projectId, lesson.courseId],
      );
      if ((linked as unknown[]).length > 0) return { lesson, project };
    }
    throw new NotFoundBusinessException(TRAINING_ERROR.NOT_IN_CAMPAIGN);
  }

  async progressFor(userId: string, lessonIds: string[]): Promise<Map<string, TrainingProgress>> {
    if (lessonIds.length === 0) return new Map();
    const rows = await this.progress.find({ where: { userId, itemId: In(lessonIds) } });
    return new Map(rows.map((r) => [r.itemId, r]));
  }

  /**
   * Records the certificate the first time every required lesson of the campaign
   * is done, and tells the campaign's managers. TRUE only on that first time.
   */
  async certifyIfComplete(
    userId: string,
    userName: string,
    project: Pick<Project, 'id' | 'name'>,
    manager?: EntityManager,
  ): Promise<boolean> {
    const { all } = await this.lessonsOf(project.id);
    const required = all.filter((l) => l.required);
    if (required.length === 0) return false;
    const progress = await this.progressFor(
      userId,
      required.map((l) => l.id),
    );
    if (required.some((l) => !progress.get(l.id)?.completedAt)) return false;

    const db = manager ?? this.dataSource.manager;
    const inserted = (await db
      .createQueryBuilder()
      .insert()
      .into(TrainingCertification)
      .values({ userId, projectId: project.id })
      .orIgnore()
      .returning(['user_id'])
      .execute()) as { raw: unknown[] };
    if (inserted.raw.length === 0) return false;

    const admins = await this.notifications.projectAdminIds(project.id, manager);
    await this.notifications.send(
      manager ?? null,
      userId,
      admins.map((adminId) => ({
        userId: adminId,
        kind: NotificationKind.TRAINING,
        title: NOTIFICATION_TEXT.CERTIFIED_TITLE(userName, project.name),
        link: NOTIFICATION_LINK.TRAINING_PROGRESS(project.id),
      })),
    );
    return true;
  }
}
