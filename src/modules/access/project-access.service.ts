import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  SQL_TABLE,
  COMMON_ERROR,
  ERROR_CODE,
  LEAD_ERROR,
  PROJECT_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { ProjectStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { Project, ProjectMember } from '../../database/entities';

/**
 * Who may see and act in which project (BRD §2).
 *
 *  - **Super Admin** — every project.
 *  - **Moderator** — only projects with an active `project_members` row; in
 *    those he is an admin.
 *  - **Sales person** — only projects with an active row, and inside them
 *    only his own leads (applied by the lead queries).
 *
 * Every service goes through here rather than re-deriving scope, so "a
 * moderator sees no data from projects he is not assigned to, including in
 * exports" (PRD §9) has one implementation to get right.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
  ) {}

  isSuperAdmin(user: Pick<AuthenticatedUser, 'role'>): boolean {
    return user.role === UserRole.SUPER_ADMIN;
  }

  /** Active project ids for a member. */
  async activeProjectIds(userId: string, manager?: EntityManager): Promise<string[]> {
    const repository = manager ? manager.getRepository(ProjectMember) : this.members;
    const rows = await repository.find({
      select: { projectId: true },
      where: { userId, isActive: true },
    });
    return rows.map((row) => row.projectId);
  }

  /**
   * The projects a caller's lists and numbers are limited to, or `undefined`
   * for no limit (Super Admin). An empty array means "none" and must match
   * nothing — never treat it as "everything".
   */
  async scopeProjectIds(user: AuthenticatedUser): Promise<string[] | undefined> {
    return this.isSuperAdmin(user) ? undefined : this.activeProjectIds(user.id);
  }

  async activeMembership(
    projectId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<ProjectMember | null> {
    const repository = manager ? manager.getRepository(ProjectMember) : this.members;
    return repository.findOne({ where: { projectId, userId, isActive: true } });
  }

  async isActiveMember(
    projectId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    return (await this.activeMembership(projectId, userId, manager)) !== null;
  }

  /** TRUE when both people are active members of at least one common project. */
  async shareActiveProject(userA: string, userB: string): Promise<boolean> {
    const count = await this.members
      .createQueryBuilder('a')
      .innerJoin(
        ProjectMember,
        'b',
        'b.project_id = a.project_id AND b.user_id = :userB AND b.is_active',
        { userB },
      )
      .where('a.user_id = :userA AND a.is_active', { userA })
      .getCount();
    return count > 0;
  }

  async findProjectOrFail(projectId: string, manager?: EntityManager): Promise<Project> {
    const repository = manager ? manager.getRepository(Project) : this.projects;
    const project = await repository.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundBusinessException(PROJECT_ERROR.NOT_FOUND);
    }
    return project;
  }

  /** TRUE for the Super Admin, or a moderator who is an active member. */
  async isAdminOf(
    user: AuthenticatedUser,
    projectId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    if (this.isSuperAdmin(user)) return true;
    if (user.role !== UserRole.MODERATOR) return false;
    return this.isActiveMember(projectId, user.id, manager);
  }

  /**
   * The project, if the caller may see it. A non-member gets 404 rather than
   * 403 so project ids do not confirm their own existence.
   */
  async assertCanView(
    user: AuthenticatedUser,
    projectId: string,
    manager?: EntityManager,
  ): Promise<Project> {
    const project = await this.findProjectOrFail(projectId, manager);
    if (this.isSuperAdmin(user) || (await this.isActiveMember(projectId, user.id, manager))) {
      return project;
    }
    throw new NotFoundBusinessException(PROJECT_ERROR.NOT_FOUND);
  }

  /** The project, if the caller administers it (Super Admin or member moderator). */
  async assertAdmin(
    user: AuthenticatedUser,
    projectId: string,
    manager?: EntityManager,
  ): Promise<Project> {
    const project = await this.assertCanView(user, projectId, manager);
    if (!this.isSuperAdmin(user) && user.role !== UserRole.MODERATOR) {
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }
    return project;
  }

  /**
   * The project, if the caller may log work in it: an active member who is a
   * sales person or moderator. The Super Admin supervises and does not log
   * leads (BRD §2).
   */
  async assertWorker(
    user: AuthenticatedUser,
    projectId: string,
    manager?: EntityManager,
  ): Promise<Project> {
    const project = await this.findProjectOrFail(projectId, manager);
    if (this.isSuperAdmin(user)) {
      throw new ForbiddenBusinessException(LEAD_ERROR.ADMINS_CANNOT_ADD);
    }
    if (!(await this.isActiveMember(projectId, user.id, manager))) {
      throw new NotFoundBusinessException(PROJECT_ERROR.NOT_FOUND);
    }
    return project;
  }

  /** Closed projects are read-only (DB Design §3). */
  assertWritable(project: Pick<Project, 'status'>): void {
    if (project.status === ProjectStatus.CLOSED) {
      throw new BusinessException(PROJECT_ERROR.CLOSED, ERROR_CODE.PROJECT_CLOSED);
    }
  }

  /**
   * Inside a write transaction: holds a share lock on the project row until
   * commit and re-checks it is open.
   *
   * Closing takes a row lock on the same row, so a follow-up and a close
   * cannot interleave — the save either commits before the close, or waits
   * and is refused with "This project is closed." (PRD §5.6).
   */
  async lockOpenProject(manager: EntityManager, projectId: string): Promise<void> {
    const rows = (await manager.query(
      `SELECT status FROM ${SQL_TABLE.PROJECTS} WHERE id = $1 FOR SHARE`,
      [projectId],
    )) as Array<{ status: ProjectStatus }>;

    if (rows.length === 0) {
      throw new NotFoundBusinessException(PROJECT_ERROR.NOT_FOUND);
    }
    this.assertWritable(rows[0]);
  }
}
