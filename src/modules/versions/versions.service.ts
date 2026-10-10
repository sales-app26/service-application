import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { BUSINESS_RULE, DB_CONSTRAINT, ERROR_CODE, VERSION_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import {
  BusinessException,
  ConflictBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { isUniqueViolation } from '../../common/utils';
import { AppVersion, AppVersionView, User } from '../../database/entities';
import {
  AppVersionDto,
  CreateVersionDto,
  LatestVersionDto,
  UpdateVersionDto,
  VERSION_PATTERN,
  VersionHistoryItemDto,
  VersionViewsDto,
} from './dto/version.dto';

const MARKDOWN_EXTENSION = /\.(md|markdown|txt)$/i;
/** Enough history to read back through; a tracker does not ship that often. */
const HISTORY_LIMIT = 50;
/** `sort_order` is an integer column: 2000 * 1_000_000 stays under 2^31. */
const MAX_MAJOR = 2000;

interface UploadedNote {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * Release notes. The super admin writes one per version; every signed-in user
 * is shown the newest published one once, and can read the rest back.
 */
@Injectable()
export class VersionsService {
  constructor(
    @InjectRepository(AppVersion) private readonly versions: Repository<AppVersion>,
    @InjectRepository(AppVersionView) private readonly views: Repository<AppVersionView>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  // ----------------------------------------------------------------- helpers

  /** `1.2.3` → 1_002_003, so ordering is the database's job. */
  sortOrderFor(version: string): number {
    if (!VERSION_PATTERN.test(version)) {
      throw new BusinessException(VERSION_ERROR.BAD_FORMAT, ERROR_CODE.VALIDATION_FAILED);
    }
    const [major, minor, patch] = version.split('.').map(Number);
    if (minor > 999 || patch > 999) {
      throw new BusinessException(VERSION_ERROR.PART_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    if (major >= MAX_MAJOR) {
      throw new BusinessException(VERSION_ERROR.MAJOR_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    return major * 1_000_000 + minor * 1_000 + patch;
  }

  private readNote(file: UploadedNote): string {
    if (!MARKDOWN_EXTENSION.test(file.originalname)) {
      throw new BusinessException(VERSION_ERROR.FILE_TYPE, ERROR_CODE.VALIDATION_FAILED);
    }
    if (file.size > BUSINESS_RULE.RELEASE_NOTE_MAX_BYTES) {
      throw new BusinessException(VERSION_ERROR.FILE_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    const notes = file.buffer.toString('utf8').trim();
    if (!notes) throw new BusinessException(VERSION_ERROR.FILE_EMPTY, ERROR_CODE.VALIDATION_FAILED);
    return notes;
  }

  private async find(id: string): Promise<AppVersion> {
    const version = await this.versions.findOne({ where: { id } });
    if (!version) throw new NotFoundBusinessException(VERSION_ERROR.NOT_FOUND);
    return version;
  }

  private toDto(v: AppVersion, seenCount = 0): AppVersionDto {
    return {
      id: v.id,
      version: v.version,
      title: v.title,
      tags: v.tags ?? [],
      notes: v.notes,
      releasedAt: v.releasedAt,
      isPublished: v.isPublished,
      notify: v.notify,
      seenCount,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  /** Read counts for a set of versions, in one query. */
  private async seenCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.views
      .createQueryBuilder('v')
      .select('v.versionId', 'versionId')
      .addSelect('COUNT(*)', 'count')
      .where({ versionId: In(ids) })
      .groupBy('v.versionId')
      .getRawMany<{ versionId: string; count: string }>();
    return new Map(rows.map((row) => [row.versionId, Number(row.count)]));
  }

  // ------------------------------------------------------------------- admin

  /** Every release, drafts included, newest version first. */
  async listAll(): Promise<AppVersionDto[]> {
    const rows = await this.versions.find({ order: { sortOrder: 'DESC' } });
    const counts = await this.seenCounts(rows.map((row) => row.id));
    return rows.map((row) => this.toDto(row, counts.get(row.id) ?? 0));
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateVersionDto,
    file: UploadedNote | undefined,
  ): Promise<AppVersionDto> {
    const sortOrder = this.sortOrderFor(dto.version);
    if (await this.versions.exists({ where: { version: dto.version } })) {
      throw new ConflictBusinessException(VERSION_ERROR.EXISTS(dto.version));
    }

    // A file wins over pasted text, as the form says.
    const notes = file ? this.readNote(file) : (dto.notes?.trim() ?? '');
    if (!notes)
      throw new BusinessException(VERSION_ERROR.NOTE_REQUIRED, ERROR_CODE.VALIDATION_FAILED);

    try {
      const saved = await this.versions.save(
        this.versions.create({
          id: randomUUID(),
          version: dto.version,
          sortOrder,
          title: dto.title ?? null,
          tags: dto.tags ?? [],
          notes,
          releasedAt: dto.releasedAt ? new Date(dto.releasedAt) : new Date(),
          isPublished: dto.isPublished ?? false,
          notify: dto.notify ?? true,
          createdBy: actor.id,
        }),
      );
      return this.toDto(saved);
    } catch (error) {
      if (isUniqueViolation(error, DB_CONSTRAINT.APP_VERSIONS_VERSION)) {
        throw new ConflictBusinessException(VERSION_ERROR.EXISTS(dto.version));
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateVersionDto,
    file: UploadedNote | undefined,
  ): Promise<AppVersionDto> {
    const version = await this.find(id);

    if (dto.version !== undefined && dto.version !== version.version) {
      const sortOrder = this.sortOrderFor(dto.version);
      if (await this.versions.exists({ where: { version: dto.version } })) {
        throw new ConflictBusinessException(VERSION_ERROR.EXISTS(dto.version));
      }
      version.version = dto.version;
      version.sortOrder = sortOrder;
    }

    if (file) {
      version.notes = this.readNote(file);
    } else if (dto.notes !== undefined) {
      const notes = dto.notes.trim();
      if (!notes)
        throw new BusinessException(VERSION_ERROR.NOTE_EMPTY, ERROR_CODE.VALIDATION_FAILED);
      version.notes = notes;
    }

    if (dto.title !== undefined) version.title = dto.title;
    if (dto.tags !== undefined) version.tags = dto.tags;
    if (dto.releasedAt !== undefined) version.releasedAt = new Date(dto.releasedAt);
    if (dto.isPublished !== undefined) version.isPublished = dto.isPublished;
    if (dto.notify !== undefined) version.notify = dto.notify;

    try {
      const saved = await this.versions.save(version);
      const counts = await this.seenCounts([saved.id]);
      return this.toDto(saved, counts.get(saved.id) ?? 0);
    } catch (error) {
      if (isUniqueViolation(error, DB_CONSTRAINT.APP_VERSIONS_VERSION)) {
        throw new ConflictBusinessException(VERSION_ERROR.EXISTS(version.version));
      }
      throw error;
    }
  }

  /** Deletes the release; its read log goes with it (cascade). */
  async remove(id: string): Promise<void> {
    await this.find(id);
    await this.versions.delete(id);
  }

  /**
   * The read log for one release: who has been shown it, and how many active
   * users still haven't.
   */
  async viewsFor(id: string): Promise<VersionViewsDto> {
    await this.find(id);

    const rows = await this.views.find({
      where: { versionId: id },
      relations: { user: true },
      order: { seenAt: 'DESC' },
    });

    const pending = await this.users
      .createQueryBuilder('u')
      .where('u.isActive = true')
      .andWhere(
        (qb) =>
          `NOT EXISTS ${qb
            .subQuery()
            .select('1')
            .from(AppVersionView, 'v')
            .where('v.user_id = u.id')
            .andWhere('v.version_id = :id')
            .getQuery()}`,
      )
      .setParameter('id', id)
      .getCount();

    return {
      seen: rows
        .filter((row) => row.user)
        .map((row) => ({
          userId: row.userId,
          name: row.user.name,
          email: row.user.email,
          role: row.user.role,
          seenAt: row.seenAt,
        })),
      pending,
    };
  }

  // --------------------------------------------------------- every signed-in user

  /**
   * The newest published release and whether this user has been shown it. The
   * portal raises its dialog on `notify && !seen`; otherwise it only displays
   * the number.
   */
  async latestFor(userId: string): Promise<LatestVersionDto | null> {
    const latest = await this.versions.findOne({
      where: { isPublished: true },
      order: { sortOrder: 'DESC' },
    });
    if (!latest) return null;

    const seen = await this.views.exists({ where: { versionId: latest.id, userId } });
    return {
      id: latest.id,
      version: latest.version,
      title: latest.title,
      tags: latest.tags ?? [],
      notes: latest.notes,
      releasedAt: latest.releasedAt,
      seen,
      notify: latest.notify,
    };
  }

  /** Published releases, newest first, each flagged with whether this user read it. */
  async historyFor(userId: string): Promise<VersionHistoryItemDto[]> {
    const rows = await this.versions.find({
      where: { isPublished: true },
      order: { sortOrder: 'DESC' },
      take: HISTORY_LIMIT,
    });
    if (rows.length === 0) return [];

    const seen = await this.views.find({
      where: { userId, versionId: In(rows.map((row) => row.id)) },
      select: { versionId: true },
    });
    const seenIds = new Set(seen.map((row) => row.versionId));

    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      tags: row.tags ?? [],
      notes: row.notes,
      releasedAt: row.releasedAt,
      seen: seenIds.has(row.id),
    }));
  }

  /**
   * Records that this user has been shown this release. Idempotent: the dialog
   * can be dismissed from two tabs, and the unique (version, user) index turns
   * the second write into a no-op rather than a duplicate row.
   */
  async markSeen(id: string, userId: string): Promise<void> {
    // A draft is invisible to everyone but the super admin, so it is not found here.
    const published = await this.versions.exists({ where: { id, isPublished: true } });
    if (!published) throw new NotFoundBusinessException(VERSION_ERROR.NOT_FOUND);

    await this.views
      .createQueryBuilder()
      .insert()
      .values({ id: randomUUID(), versionId: id, userId, seenAt: new Date() })
      .orIgnore()
      .execute();
  }
}
