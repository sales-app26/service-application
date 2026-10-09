import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';

import {
  AUTO_REJECT_REASON,
  ERROR_CODE,
  PROJECT_ERROR,
  STORAGE_FOLDER,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { ProjectStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
} from '../../common/exceptions/business.exception';
import { escapeLike, istToday } from '../../common/utils';
import { Project, ProjectMember } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { ImageService } from '../media/image.service';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { TransferRejectionsService } from '../transfers/transfer-rejections.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDto,
  UpdateProjectDto,
} from './dto/project.dto';

interface UploadedImage {
  buffer: Buffer;
}

interface ProjectRowStats {
  memberCount: number;
  leadCount: number;
  everHadLead: boolean;
}

/**
 * Projects (PRD §5.3). Only the Super Admin creates, edits, closes and reopens
 * them; nothing is ever deleted. Closing makes a project read-only and
 * rejects its pending transfers; reopening brings members and targets back as
 * they were.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
    private readonly access: ProjectAccessService,
    private readonly images: ImageService,
    private readonly storage: SupabaseStorageClient,
    private readonly transferRejections: TransferRejectionsService,
  ) {}

  // -------------------------------------------------------------------- reads

  async list(
    actor: AuthenticatedUser,
    query: ListProjectsQueryDto,
  ): Promise<PaginatedResponseDto<ProjectDto>> {
    const qb = this.projects.createQueryBuilder('p');
    await this.applyScope(qb, actor);

    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if (query.type) qb.andWhere('p.type = :type', { type: query.type });
    if (query.search) {
      qb.andWhere('lower(p.name) LIKE :term', {
        term: `%${escapeLike(query.search.toLowerCase())}%`,
      });
    }

    const [rows, total] = await qb
      .orderBy('p.status', 'ASC')
      .addOrderBy('p.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    return PaginatedResponseDto.from(
      [await this.toDtos(rows, actor), total],
      query.page,
      query.limit,
    );
  }

  /** "Join a project": active projects a moderator is not yet in (PRD §6). */
  async joinable(actor: AuthenticatedUser): Promise<ProjectDto[]> {
    const rows = await this.projects
      .createQueryBuilder('p')
      .where('p.status = :status', { status: ProjectStatus.ACTIVE })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                      WHERE pm.project_id = p.id AND pm.user_id = :userId AND pm.is_active)`,
        { userId: actor.id },
      )
      .orderBy('p.name', 'ASC')
      .getMany();

    return this.toDtos(rows, actor);
  }

  async findOne(actor: AuthenticatedUser, projectId: string): Promise<ProjectDto> {
    const project = await this.access.assertCanView(actor, projectId);
    const [dto] = await this.toDtos([project], actor);
    return dto;
  }

  // ------------------------------------------------------------------- writes

  async create(
    actor: AuthenticatedUser,
    dto: CreateProjectDto,
    image?: UploadedImage,
  ): Promise<ProjectDto> {
    this.assertDateOrder(dto.startDate, dto.endDate ?? null);

    const warnings = await this.nameWarnings(dto.name);
    const id = randomUUID();
    const imagePath = image ? await this.storeImage(id, image) : null;

    try {
      const project = await this.projects.save(
        this.projects.create({
          id,
          name: dto.name,
          description: dto.description ?? null,
          imagePath,
          type: dto.type,
          status: ProjectStatus.ACTIVE,
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
          createdBy: actor.id,
        }),
      );
      const [result] = await this.toDtos([project], actor);
      return { ...result, ...(warnings.length ? { warnings } : {}) };
    } catch (error) {
      if (imagePath) await this.storage.removeObjects([imagePath]);
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    const project = await this.access.findProjectOrFail(projectId);
    const warnings: string[] = [];

    if (dto.type !== undefined && dto.type !== project.type) {
      // The type decides the visit-proof rule, so it freezes with the first lead.
      if ((await this.stats([project.id])).get(project.id)?.everHadLead) {
        throw new ConflictBusinessException(PROJECT_ERROR.TYPE_LOCKED);
      }
      project.type = dto.type;
    }

    if (dto.name !== undefined && dto.name !== project.name) {
      warnings.push(...(await this.nameWarnings(dto.name, project.id)));
      project.name = dto.name;
    }
    if (dto.description !== undefined) project.description = dto.description;
    if (dto.startDate !== undefined) project.startDate = dto.startDate;
    if (dto.endDate !== undefined) project.endDate = dto.endDate;

    this.assertDateOrder(project.startDate, project.endDate);

    const [result] = await this.toDtos([await this.projects.save(project)], actor);
    return { ...result, ...(warnings.length ? { warnings } : {}) };
  }

  async setImage(
    actor: AuthenticatedUser,
    projectId: string,
    image: UploadedImage,
  ): Promise<ProjectDto> {
    const project = await this.access.findProjectOrFail(projectId);
    const previous = project.imagePath;

    project.imagePath = await this.storeImage(project.id, image);
    try {
      await this.projects.save(project);
    } catch (error) {
      await this.storage.removeObjects([project.imagePath]);
      throw error;
    }
    if (previous) await this.storage.removeObjects([previous]);

    const [result] = await this.toDtos([project], actor);
    return result;
  }

  async removeImage(actor: AuthenticatedUser, projectId: string): Promise<ProjectDto> {
    const project = await this.access.findProjectOrFail(projectId);
    if (!project.imagePath) {
      throw new BusinessException(PROJECT_ERROR.NO_IMAGE, ERROR_CODE.NOT_FOUND);
    }

    const previous = project.imagePath;
    project.imagePath = null;
    await this.projects.save(project);
    await this.storage.removeObjects([previous]);

    const [result] = await this.toDtos([project], actor);
    return result;
  }

  /**
   * PRD §5.3: read-only from now on; pending transfers rejected; leads drop
   * off every Due today list (the list only shows active projects). Data and
   * photos stay viewable.
   */
  async close(actor: AuthenticatedUser, projectId: string): Promise<ProjectDto> {
    const project = await this.access.findProjectOrFail(projectId);
    if (project.status === ProjectStatus.CLOSED) {
      throw new ConflictBusinessException(PROJECT_ERROR.ALREADY_CLOSED);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Project,
        { id: project.id, status: ProjectStatus.ACTIVE },
        { status: ProjectStatus.CLOSED, closedAt: new Date() },
      );
      await this.transferRejections.rejectPending(
        manager,
        { projectId: project.id },
        actor.id,
        AUTO_REJECT_REASON.PROJECT_CLOSED,
      );
    });

    return this.findOne(actor, project.id);
  }

  /** Members and targets return as they were; auto-rejected transfers do not. */
  async reopen(actor: AuthenticatedUser, projectId: string): Promise<ProjectDto> {
    const project = await this.access.findProjectOrFail(projectId);
    if (project.status === ProjectStatus.ACTIVE) {
      throw new ConflictBusinessException(PROJECT_ERROR.ALREADY_ACTIVE);
    }

    project.status = ProjectStatus.ACTIVE;
    project.closedAt = null;
    const [result] = await this.toDtos([await this.projects.save(project)], actor);
    return result;
  }

  // ------------------------------------------------------------------ helpers

  private async applyScope(
    qb: SelectQueryBuilder<Project>,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (this.access.isSuperAdmin(actor)) return;

    qb.andWhere(
      `EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                WHERE pm.project_id = p.id AND pm.user_id = :scopeUserId AND pm.is_active)`,
      { scopeUserId: actor.id },
    );
  }

  private assertDateOrder(startDate: string, endDate: string | null): void {
    if (endDate && endDate < startDate) {
      throw new BusinessException(PROJECT_ERROR.END_BEFORE_START, ERROR_CODE.VALIDATION_FAILED);
    }
  }

  /** Two projects may share a name, with a warning (Assumption 9). */
  private async nameWarnings(name: string, excludingId?: string): Promise<string[]> {
    const qb = this.projects
      .createQueryBuilder('p')
      .where('lower(p.name) = lower(:name)', { name });
    if (excludingId) qb.andWhere('p.id <> :excludingId', { excludingId });
    return (await qb.getCount()) > 0 ? [PROJECT_ERROR.NAME_EXISTS_WARNING] : [];
  }

  private async storeImage(projectId: string, image: UploadedImage): Promise<string> {
    const processed = await this.images.processProjectImage(image.buffer);
    const path = `${STORAGE_FOLDER.PROJECTS}/${projectId}/${randomUUID()}.jpg`;
    await this.storage.upload(path, processed.buffer, processed.contentType);
    return path;
  }

  private async stats(projectIds: string[]): Promise<Map<string, ProjectRowStats>> {
    const result = new Map<string, ProjectRowStats>();
    if (projectIds.length === 0) return result;

    const rows = (await this.dataSource.query(
      `SELECT p.id,
              (SELECT count(*) FROM ${SQL_TABLE.PROJECT_MEMBERS} pm WHERE pm.project_id = p.id AND pm.is_active)::int AS member_count,
              (SELECT count(*) FROM ${SQL_TABLE.LEADS} l WHERE l.project_id = p.id AND l.deleted_at IS NULL)::int AS lead_count,
              EXISTS (SELECT 1 FROM ${SQL_TABLE.LEADS} l WHERE l.project_id = p.id) AS ever_had_lead
         FROM ${SQL_TABLE.PROJECTS} p
        WHERE p.id = ANY($1::uuid[])`,
      [projectIds],
    )) as Array<{ id: string; member_count: number; lead_count: number; ever_had_lead: boolean }>;

    for (const row of rows) {
      result.set(row.id, {
        memberCount: row.member_count,
        leadCount: row.lead_count,
        everHadLead: row.ever_had_lead,
      });
    }
    return result;
  }

  private async toDtos(projects: Project[], actor: AuthenticatedUser): Promise<ProjectDto[]> {
    const ids = projects.map((project) => project.id);
    const [stats, urls, myMemberships] = await Promise.all([
      this.stats(ids),
      this.storage.signedUrls(projects.map((project) => project.imagePath ?? '').filter(Boolean)),
      actor.role === UserRole.SUPER_ADMIN || ids.length === 0
        ? Promise.resolve([] as ProjectMember[])
        : this.members
            .createQueryBuilder('m')
            .where('m.user_id = :userId AND m.is_active AND m.project_id IN (:...ids)', {
              userId: actor.id,
              ids,
            })
            .getMany(),
    ]);

    const today = istToday();
    const mine = new Map(myMemberships.map((membership) => [membership.projectId, membership]));

    return projects.map((project) => {
      const stat = stats.get(project.id);
      const membership = mine.get(project.id);
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        imageUrl: project.imagePath ? (urls.get(project.imagePath) ?? null) : null,
        type: project.type,
        status: project.status,
        startDate: project.startDate,
        endDate: project.endDate,
        closedAt: project.closedAt,
        createdAt: project.createdAt,
        pastEndDate:
          project.status === ProjectStatus.ACTIVE &&
          project.endDate !== null &&
          project.endDate < today,
        typeLocked: stat?.everHadLead ?? false,
        memberCount: stat?.memberCount ?? 0,
        leadCount: stat?.leadCount ?? 0,
        ...(membership
          ? { myTargetCount: membership.targetCount, myTargetPeriod: membership.targetPeriod }
          : {}),
      };
    });
  }
}
