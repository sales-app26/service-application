import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import {
  COMMON_ERROR,
  ERROR_CODE,
  LEAVE_ERROR,
  NOTIFICATION_LINK,
  NOTIFICATION_TEXT,
  SQL_TABLE,
  USER_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { NotificationKind, ProjectStatus, UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { formatDaySpan, istToday } from '../../common/utils';
import { User, UserLeave } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { NotificationSenderService } from '../notifications/notification-sender.service';
import { CreateLeaveDto, LeaveDto, ListLeavesQueryDto } from './dto/leave.dto';
import { assertLeaveDates } from './leave-rules';

/**
 * Leave (who is away, and when). Anyone books his own; the Super Admin books
 * anyone's, and a moderator the sales persons he manages (`canManagePerson`).
 * A person's leaves never overlap. Booking one tells each project's backup
 * that he is covering.
 */
@Injectable()
export class LeavesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(UserLeave) private readonly leaves: Repository<UserLeave>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly notifications: NotificationSenderService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateLeaveDto): Promise<LeaveDto> {
    const person = await this.findBookable(actor, dto.userId ?? actor.id);
    if (!person.isActive) {
      throw new BusinessException(LEAVE_ERROR.USER_INACTIVE, ERROR_CODE.UNPROCESSABLE);
    }
    const span = { startsOn: dto.startsOn, endsOn: dto.endsOn };
    assertLeaveDates(span, istToday());

    const leaveId = await this.dataSource.transaction(async (manager) => {
      // One booking per person at a time, so two overlapping leaves cannot both pass the check.
      await manager.query(`SELECT id FROM ${SQL_TABLE.USERS} WHERE id = $1 FOR UPDATE`, [
        person.id,
      ]);
      const overlapping = await manager
        .getRepository(UserLeave)
        .createQueryBuilder('lv')
        .where('lv.user_id = :userId AND lv.cancelled_at IS NULL', { userId: person.id })
        .andWhere('lv.starts_on <= :endsOn AND lv.ends_on >= :startsOn', span)
        .getExists();
      if (overlapping) {
        throw new ConflictBusinessException(LEAVE_ERROR.OVERLAP);
      }

      const saved = await manager.save(
        manager.create(UserLeave, {
          userId: person.id,
          startsOn: span.startsOn,
          endsOn: span.endsOn,
          note: dto.note ?? null,
          createdBy: actor.id,
        }),
      );
      await this.notifyBackups(manager, actor, person, span.startsOn, span.endsOn);
      return saved.id;
    });

    return this.toDto(await this.findOneOrFail(leaveId));
  }

  /**
   * Current and upcoming leaves (ending today or later), soonest first. A
   * sales person sees his own; a moderator his own and those of the people he
   * manages; the Super Admin everyone's.
   */
  async list(actor: AuthenticatedUser, query: ListLeavesQueryDto): Promise<LeaveDto[]> {
    const qb = this.leaves
      .createQueryBuilder('lv')
      .innerJoinAndSelect('lv.user', 'person')
      .innerJoinAndSelect('lv.creator', 'creator')
      .where('lv.cancelled_at IS NULL')
      .andWhere('lv.ends_on >= :today', { today: istToday() });

    if (query.userId && query.userId !== actor.id) {
      await this.assertCanSeeLeavesOf(actor, query.userId);
      qb.andWhere('lv.user_id = :userId', { userId: query.userId });
    } else if (query.userId || actor.role === UserRole.SALES_PERSON) {
      qb.andWhere('lv.user_id = :me', { me: actor.id });
    } else if (actor.role === UserRole.MODERATOR) {
      qb.andWhere(`(lv.user_id = :me OR ${this.access.manageablePersonSql('person', ':me')})`, {
        me: actor.id,
      });
    }

    const rows = await qb
      .orderBy('lv.startsOn', 'ASC')
      .addOrderBy('person.name', 'ASC')
      .addOrderBy('lv.id', 'ASC')
      .getMany();
    return rows.map((row) => this.toDto(row));
  }

  /** Cancels a leave: the person himself, or whoever could have booked it for him. */
  async cancel(actor: AuthenticatedUser, leaveId: string): Promise<void> {
    const leave = await this.leaves.findOne({
      where: { id: leaveId, cancelledAt: IsNull() },
      relations: { user: true },
    });
    const allowed =
      leave !== null &&
      (leave.userId === actor.id ||
        (actor.role !== UserRole.SALES_PERSON &&
          (await this.access.canManagePerson(actor, leave.user))));
    if (!allowed) {
      throw new NotFoundBusinessException(LEAVE_ERROR.NOT_FOUND);
    }

    await this.leaves.update({ id: leave.id, cancelledAt: IsNull() }, { cancelledAt: new Date() });
  }

  // ------------------------------------------------------------------ helpers

  /** The person a leave is booked for, if the caller may book it. */
  private async findBookable(actor: AuthenticatedUser, userId: string): Promise<User> {
    if (userId === actor.id) {
      return this.users.findOneOrFail({ where: { id: actor.id } });
    }
    if (actor.role === UserRole.SALES_PERSON) {
      throw new ForbiddenBusinessException(LEAVE_ERROR.ONLY_SELF);
    }

    const person = await this.users.findOne({ where: { id: userId } });
    if (!person || person.deletedAt) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
    if (!(await this.access.canManagePerson(actor, person))) {
      throw new ForbiddenBusinessException(USER_ERROR.NOT_MANAGEABLE);
    }
    return person;
  }

  /** Someone else's leaves: never for a sales person; for a moderator, only people he manages. */
  private async assertCanSeeLeavesOf(actor: AuthenticatedUser, userId: string): Promise<void> {
    if (actor.role === UserRole.SALES_PERSON) {
      throw new ForbiddenBusinessException(COMMON_ERROR.FORBIDDEN);
    }
    if (this.access.isSuperAdmin(actor)) return;

    const person = await this.users.findOne({ where: { id: userId } });
    if (!person || !(await this.access.canManagePerson(actor, person))) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
  }

  /**
   * Each active backup of the person, in the active projects where he works,
   * learns he is covering — one notification per backup, naming the projects.
   */
  private async notifyBackups(
    manager: EntityManager,
    actor: AuthenticatedUser,
    person: User,
    startsOn: string,
    endsOn: string,
  ): Promise<void> {
    const backups = (await manager.query(
      `SELECT pm.backup_user_id AS user_id, string_agg(p.name, ', ' ORDER BY p.name) AS projects
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = pm.project_id AND p.status = $2
         JOIN ${SQL_TABLE.USERS} b ON b.id = pm.backup_user_id AND b.is_active
         JOIN ${SQL_TABLE.PROJECT_MEMBERS} bm
           ON bm.project_id = pm.project_id AND bm.user_id = pm.backup_user_id AND bm.is_active
        WHERE pm.user_id = $1 AND pm.is_active
        GROUP BY pm.backup_user_id`,
      [person.id, ProjectStatus.ACTIVE],
    )) as Array<{ user_id: string; projects: string }>;

    await this.notifications.send(
      manager,
      actor.id,
      backups.map((backup) => ({
        userId: backup.user_id,
        kind: NotificationKind.LEAVE_COVER,
        title: NOTIFICATION_TEXT.LEAVE_COVER_TITLE(person.name, formatDaySpan(startsOn, endsOn)),
        body: NOTIFICATION_TEXT.LEAVE_COVER_BODY(backup.projects),
        link: NOTIFICATION_LINK.HOME,
      })),
    );
  }

  private findOneOrFail(leaveId: string): Promise<UserLeave> {
    return this.leaves.findOneOrFail({
      where: { id: leaveId },
      relations: { user: true, creator: true },
    });
  }

  private toDto(leave: UserLeave): LeaveDto {
    return {
      id: leave.id,
      user: { id: leave.user.id, name: leave.user.name },
      startsOn: leave.startsOn,
      endsOn: leave.endsOn,
      note: leave.note,
      createdBy: { id: leave.creator.id, name: leave.creator.name },
      createdAt: leave.createdAt,
    };
  }
}
