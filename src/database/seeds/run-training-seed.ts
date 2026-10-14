import { IsNull } from 'typeorm';

import { UserRole } from '../../common/enums';
import { DEFAULT_STEP, normalizePayload } from '../../modules/training/training-rules';
import { dataSource } from '../data-source';
import { TrainingCourse, TrainingItem, User } from '../entities';
import { FROSTIQUE_COURSE, FROSTIQUE_LESSONS } from './training-content';

/**
 * Adds the starting Frostique sales course to the training library, as a draft
 * owned by the first Super Admin. Publish it and attach it to campaigns in the app,
 * then add the YouTube videos and upload the PDFs.
 *
 * Idempotent: does nothing if a course with the same title already exists.
 *
 *   npm run db:seed:training
 */
async function run(): Promise<void> {
  await dataSource.initialize();
  try {
    const courses = dataSource.getRepository(TrainingCourse);
    const existing = await courses.findOne({
      where: { title: FROSTIQUE_COURSE.title, deletedAt: IsNull() },
    });
    if (existing) {
      console.warn(`“${FROSTIQUE_COURSE.title}” is already in the library. Nothing to do.`);
      return;
    }
    const owner = await dataSource.getRepository(User).findOne({
      where: { role: UserRole.SUPER_ADMIN, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
    if (!owner) throw new Error('Create the Super Admin first (npm run db:seed).');

    await dataSource.transaction(async (manager) => {
      const course = await manager.save(
        manager.create(TrainingCourse, {
          ...FROSTIQUE_COURSE,
          published: false,
          createdBy: owner.id,
        }),
      );
      await manager.save(
        FROSTIQUE_LESSONS.map((lesson, index) =>
          manager.create(TrainingItem, {
            courseId: course.id,
            projectId: null,
            kind: lesson.kind,
            step: lesson.step ?? DEFAULT_STEP[lesson.kind],
            title: lesson.title,
            summary: lesson.summary ?? null,
            minutes: lesson.minutes ?? null,
            required: lesson.required ?? true,
            sort: (index + 1) * 10,
            payload: normalizePayload(lesson.kind, lesson.payload) as unknown as Record<
              string,
              unknown
            >,
            createdBy: owner.id,
          }),
        ),
      );
    });
    console.log(
      `Added “${FROSTIQUE_COURSE.title}” (${FROSTIQUE_LESSONS.length} lessons) as a draft. Publish it in Training, then attach it to campaigns.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/training_courses" does not exist/.test(message)) {
    console.error(
      'The training tables aren’t in this database yet. Run `npm run migration:run` first.',
    );
    process.exit(1);
  }
  console.error(message);
  process.exit(1);
});
