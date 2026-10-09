import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  AUTO_REJECT_REASON,
  ERROR_CODE,
  MEMBER_ERROR,
  PROJECT_ERROR,
  USER_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { ProjectStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { ProjectMember, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { TransferRejectionsService } from '../transfers/transfer-rejections.service';
import { AddMemberDto, MemberDto, SetTargetDto } from './dto/member.dto';

/**
 * Who works in a project, and their target (PRD §5.4).
 *
 * Membership rows are never deleted: removing someone flips `is_active` and
 * keeps their history, and adding them back reactivates the same row with
 * the target they had.
 */
@Injectable()
export class MembersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly transferRejections: TransferRejectionsService,
  ) {}

  /**
   * Admins see everyone with contact details and targets. A member sees the
   * active members' names and roles only — enough to pick a transfer recipient.
   */
  async list(
    actor: AuthenticatedUser,
    projectId: string,
    includeRemoved = false,
  ): Promise<MemberDto[]> {
    await this.access.assertCanView(actor, projectId);
    const isAdmin = await this.access.isAdminOf(actor, projectId);

    const rows = await this.members.find({
      where: { projectId, ...(isAdmin && includeRemoved ? {} : { isActive: true }) },
      relations: { user: true },
    });

    return rows
      .sort(
        (a, b) => Number(b.isActive) - Number(a.isActive) || a.user.name.localeCompare(b.user.name),
      )
      .map((row) => this.toDto(row, isAdmin));
  }

  async add(actor: AuthenticatedUser, projectId: string, dto: AddMemberDto): Promise<MemberDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    if (project.status === ProjectStatus.CLOSED) {
      throw new BusinessException(PROJECT_ERROR.CLOSED, ERROR_CODE.PROJECT_CLOSED);
    }
    this.assertTargetPair(dto.targetCount ?? null, dto.targetPeriod ?? null);

    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
    if (!user.isActive) {
      throw new BusinessException(MEMBER_ERROR.USER_INACTIVE, ERROR_CODE.UNPROCESSABLE);
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BusinessException(MEMBER_ERROR.SUPER_ADMIN_NOT_MEMBER, ERROR_CODE.UNPROCESSABLE);
    }
    if (actor.role === UserRole.MODERATOR && user.role !== UserRole.SALES_PERSON) {
      throw new ForbiddenBusinessException(MEMBER_ERROR.MODERATOR_ADDS_SALES_ONLY);
    }

    const membership = await this.upsertMembership(projectId, user.id, actor.id, {
      targetCount: dto.targetCount,
      targetPeriod: dto.targetPeriod,
    });
    return this.toDto({ ...membership, user }, true);
  }

  /** A moderator assigns an active project to himself, no approval needed (Assumption 2). */
  async join(actor: AuthenticatedUser, projectId: string): Promise<MemberDto> {
    const project = await this.access.findProjectOrFail(projectId);
    if (project.status === ProjectStatus.CLOSED) {
      throw new BusinessException(MEMBER_ERROR.SELF_ASSIGN_CLOSED, ERROR_CODE.PROJECT_CLOSED);
    }

    const user = await this.users.findOneOrFail({ where: { id: actor.id } });
    const membership = await this.upsertMembership(projectId, actor.id, actor.id, {});
    return this.toDto({ ...membership, user }, true);
  }

  /**
   * Leads stay in the person's name, tagged "Owner removed" for admins to
   * reassign; their pending transfers in this project are rejected. A
   * moderator may remove sales persons and himself, not another moderator.
   */
  async remove(actor: AuthenticatedUser, projectId: string, userId: string): Promise<MemberDto> {
    await this.access.assertAdmin(actor, projectId);
    const membership = await this.findActiveOrFail(projectId, userId);

    if (
      actor.role === UserRole.MODERATOR &&
      membership.user.role !== UserRole.SALES_PERSON &&
      membership.userId !== actor.id
    ) {
      throw new ForbiddenBusinessException(MEMBER_ERROR.MODERATOR_REMOVES_SALES_ONLY);
    }

    const removedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.update(ProjectMember, { id: membership.id }, { isActive: false, removedAt });
      await this.transferRejections.rejectPending(
        manager,
        { userId, projectId },
        actor.id,
        AUTO_REJECT_REASON.MEMBER_REMOVED,
      );
    });

    return this.toDto({ ...membership, isActive: false, removedAt }, true);
  }

  /**
   * Replaces the target; there is no history (BRD §6). Progress is measured
   * against the new number at once. A moderator sets targets for sales
   * persons in his project and for himself (Assumption on PRD §5.4).
   */
  async setTarget(
    actor: AuthenticatedUser,
    projectId: string,
    userId: string,
    dto: SetTargetDto,
  ): Promise<MemberDto> {
    await this.access.assertAdmin(actor, projectId);
    this.assertTargetPair(dto.targetCount, dto.targetPeriod);
    const membership = await this.findActiveOrFail(projectId, userId);

    if (
      actor.role === UserRole.MODERATOR &&
      membership.user.role !== UserRole.SALES_PERSON &&
      membership.userId !== actor.id
    ) {
      throw new ForbiddenBusinessException(MEMBER_ERROR.TARGET_NOT_ALLOWED);
    }

    membership.targetCount = dto.targetCount;
    membership.targetPeriod = dto.targetPeriod;
    await this.members.update(
      { id: membership.id },
      { targetCount: dto.targetCount, targetPeriod: dto.targetPeriod },
    );
    return this.toDto(membership, true);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Adds, or reactivates the earlier row. A reactivated row keeps its target
   * unless the caller sends a new one.
   */
  private async upsertMembership(
    projectId: string,
    userId: string,
    assignedBy: string,
    target: Pick<AddMemberDto, 'targetCount' | 'targetPeriod'>,
  ): Promise<ProjectMember> {
    const existing = await this.members.findOne({ where: { projectId, userId } });
    const hasTarget = target.targetCount !== undefined && target.targetPeriod !== undefined;

    if (existing?.isActive) {
      throw new ConflictBusinessException(
        assignedBy === userId ? MEMBER_ERROR.ALREADY_ASSIGNED : MEMBER_ERROR.ALREADY_MEMBER,
      );
    }

    if (existing) {
      existing.isActive = true;
      existing.removedAt = null;
      existing.assignedBy = assignedBy;
      existing.joinedAt = new Date();
      if (hasTarget) {
        existing.targetCount = target.targetCount!;
        existing.targetPeriod = target.targetPeriod!;
      }
      return this.members.save(existing);
    }

    return this.members.save(
      this.members.create({
        projectId,
        userId,
        assignedBy,
        isActive: true,
        targetCount: hasTarget ? target.targetCount! : null,
        targetPeriod: hasTarget ? target.targetPeriod! : null,
      }),
    );
  }

  private async findActiveOrFail(projectId: string, userId: string): Promise<ProjectMember> {
    const membership = await this.members.findOne({
      where: { projectId, userId, isActive: true },
      relations: { user: true },
    });
    if (!membership) {
      throw new NotFoundBusinessException(MEMBER_ERROR.NOT_MEMBER);
    }
    return membership;
  }

  private assertTargetPair(count: number | null, period: string | null): void {
    if ((count === null) !== (period === null)) {
      throw new BusinessException(MEMBER_ERROR.TARGET_PAIR, ERROR_CODE.VALIDATION_FAILED);
    }
  }

  private toDto(row: ProjectMember, isAdmin: boolean): MemberDto {
    return {
      userId: row.userId,
      name: row.user.name,
      role: row.user.role,
      userIsActive: row.user.isActive,
      isActive: row.isActive,
      joinedAt: row.joinedAt,
      ...(isAdmin
        ? {
            email: row.user.email,
            phone: row.user.phone,
            targetCount: row.targetCount,
            targetPeriod: row.targetPeriod,
            removedAt: row.removedAt,
          }
        : {}),
    };
  }
}
