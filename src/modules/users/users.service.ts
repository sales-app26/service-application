import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';

import {
  AUTO_REJECT_REASON,
  ERROR_CODE,
  LEAD_ERROR,
  SQL_TABLE,
  USER_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { UserRole } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ForbiddenBusinessException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { blankToNull, escapeLike, normaliseIndianMobile } from '../../common/utils';
import { ProjectMember, User } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import {
  SupabaseAuthClient,
  SupabaseCallError,
  SupabaseFailure,
} from '../supabase/supabase-auth.client';
import { TransferRejectionsService } from '../transfers/transfer-rejections.service';
import {
  ChangeEmailDto,
  ChangeRoleDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
  UserDto,
} from './dto/user.dto';

/**
 * Moderators and sales persons (PRD §5.2).
 *
 * Accounts are created by an admin, never by sign-up. The Supabase login and
 * the `users` row are created together; if the row fails to save, the login
 * is deleted again so no half-made account is left behind. Users are
 * deactivated and reactivated; a Super Admin can also delete one, which
 * anonymises the row (history stays) and removes the login.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: ProjectAccessService,
    private readonly authClient: SupabaseAuthClient,
    private readonly transferRejections: TransferRejectionsService,
  ) {}

  // -------------------------------------------------------------------- reads

  async list(
    actor: AuthenticatedUser,
    query: ListUsersQueryDto,
  ): Promise<PaginatedResponseDto<UserDto>> {
    const qb = this.users.createQueryBuilder('u').where('u.deleted_at IS NULL');

    // A moderator works with sales persons: he needs to see all of them to add
    // one to his project, but may only manage some (canManage below).
    if (actor.role === UserRole.MODERATOR) {
      qb.andWhere('u.role = :salesRole', { salesRole: UserRole.SALES_PERSON });
    } else if (query.role) {
      qb.andWhere('u.role = :role', { role: query.role });
    }

    if (query.isActive !== undefined) {
      qb.andWhere('u.is_active = :isActive', { isActive: query.isActive });
    }

    if (query.projectId) {
      if (!this.access.isSuperAdmin(actor)) {
        await this.access.assertAdmin(actor, query.projectId);
      }
      qb.andWhere(
        `EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
                  WHERE pm.user_id = u.id AND pm.project_id = :projectId AND pm.is_active)`,
        { projectId: query.projectId },
      );
    }

    if (query.manageableOnly && actor.role === UserRole.MODERATOR) {
      qb.andWhere(
        new Brackets((inner) =>
          inner.where('u.created_by = :actorId').orWhere(this.sharesProjectSql('u.id')),
        ),
        { actorId: actor.id },
      );
    }

    if (query.search) {
      const term = `%${escapeLike(query.search.toLowerCase())}%`;
      qb.andWhere(
        new Brackets((inner) =>
          inner
            .where('lower(u.name) LIKE :term')
            .orWhere('u.email LIKE :term')
            .orWhere("coalesce(u.phone, '') LIKE :term"),
        ),
        { term },
      );
    }

    const [rows, total] = await qb
      .addSelect('lower(u.name)', 'sort_name')
      .orderBy('u.isActive', 'DESC')
      .addOrderBy('sort_name', 'ASC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    const manageable = await this.manageableIds(actor, rows);
    const outside = this.access.isSuperAdmin(actor)
      ? new Set<string>()
      : await this.access.withProjectsOutside(actor.id, [...manageable]);
    return PaginatedResponseDto.from(
      [rows.map((row) => UserDto.from(row, manageable.has(row.id), !outside.has(row.id))), total],
      query.page,
      query.limit,
    );
  }

  async findOne(actor: AuthenticatedUser, userId: string): Promise<UserDto> {
    const user = await this.findOrFail(userId);

    if (
      actor.role === UserRole.MODERATOR &&
      user.role !== UserRole.SALES_PERSON &&
      user.id !== actor.id
    ) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }

    const canManage = await this.canManage(actor, user);
    return UserDto.from(user, canManage, canManage && (await this.coversAccount(actor, user.id)));
  }

  // ------------------------------------------------------------------- writes

  async create(actor: AuthenticatedUser, dto: CreateUserDto): Promise<UserDto> {
    if (dto.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenBusinessException(USER_ERROR.CANNOT_CREATE_SUPER_ADMIN);
    }
    if (actor.role === UserRole.MODERATOR && dto.role !== UserRole.SALES_PERSON) {
      throw new ForbiddenBusinessException(USER_ERROR.MODERATOR_CREATES_SALES_ONLY);
    }

    const phone = this.normalisePhone(dto.phone);
    await this.assertEmailFree(dto.email);

    let authUserId: string;
    try {
      ({ id: authUserId } = await this.authClient.inviteUser(dto.email, dto.name));
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.EMAIL_EXISTS) {
        throw new ConflictBusinessException(USER_ERROR.EMAIL_IN_AUTH);
      }
      throw SupabaseAuthClient.toBusinessException(error);
    }

    try {
      const saved = await this.users.save(
        this.users.create({
          id: authUserId,
          name: dto.name,
          email: dto.email,
          phone,
          role: dto.role,
          isActive: true,
          createdBy: actor.id,
        }),
      );
      return UserDto.from(saved, true);
    } catch (error) {
      // Two admins creating the same email at once, or a database outage:
      // either way the login must not outlive the row it was made for.
      await this.authClient.deleteUserAsAdmin(authUserId);
      throw error;
    }
  }

  async update(actor: AuthenticatedUser, userId: string, dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.findManageableOrFail(actor, userId);

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.phone !== undefined) user.phone = this.normalisePhone(dto.phone);

    return UserDto.from(await this.users.save(user), true);
  }

  /**
   * PRD §5.2: leads stay in the person's name and show "Owner inactive" to
   * admins until reassigned; any pending transfer they asked for or would
   * receive is rejected with "User deactivated".
   */
  async deactivate(actor: AuthenticatedUser, userId: string): Promise<UserDto> {
    const user = await this.findManageableOrFail(actor, userId, {
      allowSelfAsSuperAdmin: true,
      account: true,
    });

    if (!user.isActive) {
      throw new ConflictBusinessException(USER_ERROR.ALREADY_INACTIVE);
    }
    if (user.role === UserRole.SUPER_ADMIN && !(await this.anotherActiveSuperAdmin(user.id))) {
      throw new BusinessException(USER_ERROR.LAST_SUPER_ADMIN, ERROR_CODE.CONFLICT);
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: user.id }, { isActive: false });
      await this.transferRejections.rejectPending(
        manager,
        { userId: user.id },
        actor.id,
        AUTO_REJECT_REASON.USER_DEACTIVATED,
      );
    });

    user.isActive = false;
    return UserDto.from(user, true);
  }

  async reactivate(actor: AuthenticatedUser, userId: string): Promise<UserDto> {
    const user = await this.findManageableOrFail(actor, userId, { account: true });

    if (user.isActive) {
      throw new ConflictBusinessException(USER_ERROR.ALREADY_ACTIVE);
    }

    user.isActive = true;
    return UserDto.from(await this.users.save(user), true);
  }

  /** Super Admin only. History stays under the same person (Assumption 10). */
  async changeRole(actor: AuthenticatedUser, userId: string, dto: ChangeRoleDto): Promise<UserDto> {
    const user = await this.findLiveOrFail(userId);

    if (user.role === dto.role) {
      throw new ConflictBusinessException(USER_ERROR.SAME_ROLE);
    }
    if (
      user.role === UserRole.SUPER_ADMIN &&
      user.isActive &&
      !(await this.anotherActiveSuperAdmin(user.id))
    ) {
      throw new BusinessException(USER_ERROR.LAST_SUPER_ADMIN_ROLE, ERROR_CODE.CONFLICT);
    }

    user.role = dto.role;
    const saved = await this.users.save(user);
    this.logger.log(`Role of ${user.id} changed to ${dto.role} by ${actor.id}`);
    return UserDto.from(saved, true);
  }

  /** Super Admin only. The person signs in with the new email from then on. */
  async changeEmail(
    actor: AuthenticatedUser,
    userId: string,
    dto: ChangeEmailDto,
  ): Promise<UserDto> {
    const user = await this.findLiveOrFail(userId);

    if (user.email === dto.email) {
      throw new ConflictBusinessException(USER_ERROR.SAME_EMAIL);
    }
    await this.assertEmailFree(dto.email);

    try {
      await this.authClient.updateUserAsAdmin(user.id, { email: dto.email });
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.EMAIL_EXISTS) {
        throw new ConflictBusinessException(USER_ERROR.EMAIL_IN_AUTH);
      }
      throw SupabaseAuthClient.toBusinessException(error);
    }

    user.email = dto.email;
    const saved = await this.users.save(user);
    this.logger.log(`Email of ${user.id} changed by ${actor.id}`);
    return UserDto.from(saved, true);
  }

  /** A reset link the admin shares by hand: for people who can't find, or never got, the email. */
  async resetLink(actor: AuthenticatedUser, userId: string): Promise<{ link: string }> {
    // The link signs whoever opens it in as this person: account-wide, like deactivation.
    const user = await this.findManageableOrFail(actor, userId, { account: true });
    if (!user.isActive) throw new ConflictBusinessException(USER_ERROR.RESET_LINK_INACTIVE);
    try {
      const link = await this.authClient.createRecoveryLink(user.email);
      this.logger.log(`Reset link for ${user.id} created by ${actor.id}`);
      return { link };
    } catch (error) {
      throw SupabaseAuthClient.toBusinessException(error);
    }
  }

  /**
   * Emails the person a reset link (Brevo). Unlike the public "forgot password", a
   * failure is reported to the admin. Makes any earlier reset link stop working.
   */
  async sendResetEmail(actor: AuthenticatedUser, userId: string): Promise<{ email: string }> {
    const user = await this.findManageableOrFail(actor, userId);
    if (!user.isActive) throw new ConflictBusinessException(USER_ERROR.RESET_LINK_INACTIVE);
    try {
      await this.authClient.sendRecoveryEmail(user.email, user.name);
      this.logger.log(`Reset email for ${user.id} sent by ${actor.id}`);
      return { email: user.email };
    } catch (error) {
      throw SupabaseAuthClient.toBusinessException(error);
    }
  }

  /**
   * Super Admin only. Their live leads (in every project) go to `transferToId`, as
   * approved transfers; pending transfers involving them are rejected; their
   * memberships end. The row stays for the history they logged, anonymised to
   * "Deleted user" with a placeholder email (so the real one can be reused), and
   * the Supabase login is removed.
   */
  async remove(
    actor: AuthenticatedUser,
    userId: string,
    transferToId: string | undefined,
  ): Promise<{ leadsMoved: number }> {
    const user = await this.findOrFail(userId);
    if (user.deletedAt) throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    if (user.id === actor.id) throw new ForbiddenBusinessException(USER_ERROR.DELETE_SELF);
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenBusinessException(USER_ERROR.DELETE_SUPER_ADMIN);
    }

    const leadsMoved = await this.dataSource.transaction(async (manager) => {
      const leads = (await manager.query(
        `SELECT id, project_id FROM ${SQL_TABLE.LEADS}
          WHERE owner_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [user.id],
      )) as Array<{ id: string; project_id: string }>;

      await this.transferRejections.rejectPending(
        manager,
        { userId: user.id },
        actor.id,
        AUTO_REJECT_REASON.USER_DELETED,
      );

      if (leads.length > 0) {
        if (!transferToId) throw new BusinessException(USER_ERROR.DELETE_NEEDS_RECIPIENT);
        const to = await manager.findOne(User, { where: { id: transferToId } });
        if (
          !to ||
          to.id === user.id ||
          !to.isActive ||
          to.deletedAt ||
          to.role === UserRole.SUPER_ADMIN
        ) {
          throw new BusinessException(USER_ERROR.DELETE_RECIPIENT_INVALID);
        }

        // The new owner joins (or rejoins) every project the leads are in.
        const projectIds = [...new Set(leads.map((lead) => lead.project_id))];
        await manager.query(
          `INSERT INTO ${SQL_TABLE.PROJECT_MEMBERS} AS pm (project_id, user_id, assigned_by)
           SELECT unnest($1::uuid[]), $2, $3
           ON CONFLICT (project_id, user_id)
           DO UPDATE SET is_active = true, removed_at = NULL
           WHERE NOT pm.is_active`,
          [projectIds, to.id, actor.id],
        );

        const leadIds = leads.map((lead) => lead.id);
        await manager.query(
          `INSERT INTO ${SQL_TABLE.LEAD_TRANSFERS}
             (lead_id, from_user_id, to_user_id, reason, status, requested_by, decided_by, decided_at)
           SELECT unnest($1::uuid[]), $2, $3, $4, 'approved', $5, $5, now()`,
          [leadIds, user.id, to.id, AUTO_REJECT_REASON.USER_DELETED, actor.id],
        );
        await manager.query(
          `UPDATE ${SQL_TABLE.LEADS} SET owner_id = $2 WHERE id = ANY($1::uuid[])`,
          [leadIds, to.id],
        );
      }

      await manager.query(
        `UPDATE ${SQL_TABLE.PROJECT_MEMBERS} SET is_active = false, removed_at = now()
          WHERE user_id = $1 AND is_active`,
        [user.id],
      );
      await manager.update(
        User,
        { id: user.id },
        {
          name: USER_ERROR.DELETED_NAME,
          email: `deleted-${user.id}@deleted.invalid`,
          phone: null,
          isActive: false,
          deletedAt: new Date(),
        },
      );
      return leads.length;
    });

    // After the commit: the row already can't sign in, so a failure here only leaves
    // an orphaned login, which is logged.
    await this.authClient.deleteUserAsAdmin(user.id);
    this.logger.log(`User ${user.id} deleted by ${actor.id}; ${leadsMoved} leads moved`);
    return { leadsMoved };
  }

  // ------------------------------------------------------------------ helpers

  async findOrFail(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
    return user;
  }

  /** As findOrFail, but a deleted (anonymised) person is not found: nothing may change them. */
  private async findLiveOrFail(userId: string): Promise<User> {
    const user = await this.findOrFail(userId);
    if (user.deletedAt) {
      throw new NotFoundBusinessException(USER_ERROR.NOT_FOUND);
    }
    return user;
  }

  /** A moderator's account-wide reach: none of the person's projects is outside his own. */
  private async coversAccount(actor: AuthenticatedUser, userId: string): Promise<boolean> {
    if (this.access.isSuperAdmin(actor)) return true;
    return !(await this.access.withProjectsOutside(actor.id, [userId])).has(userId);
  }

  /**
   * Super Admin: anyone (himself only where the caller says so). Moderator:
   * a sales person he created or shares an active project with (BRD §2); for
   * account-wide actions (`account`), only one who works in none of the
   * projects he isn't in. Deleted people are never found.
   */
  private async findManageableOrFail(
    actor: AuthenticatedUser,
    userId: string,
    options: { allowSelfAsSuperAdmin?: boolean; account?: boolean } = {},
  ): Promise<User> {
    const user = await this.findLiveOrFail(userId);

    if (
      user.id === actor.id &&
      !(options.allowSelfAsSuperAdmin && this.access.isSuperAdmin(actor))
    ) {
      throw new ForbiddenBusinessException(USER_ERROR.NOT_MANAGEABLE);
    }
    if (!(await this.canManage(actor, user))) {
      throw new ForbiddenBusinessException(USER_ERROR.NOT_MANAGEABLE);
    }
    if (options.account && !(await this.coversAccount(actor, user.id))) {
      throw new ForbiddenBusinessException(USER_ERROR.ACCOUNT_OUTSIDE_SCOPE);
    }
    return user;
  }

  private async canManage(actor: AuthenticatedUser, user: User): Promise<boolean> {
    if (this.access.isSuperAdmin(actor)) return true;
    if (actor.role !== UserRole.MODERATOR || user.role !== UserRole.SALES_PERSON) return false;
    return user.createdBy === actor.id || (await this.access.shareActiveProject(actor.id, user.id));
  }

  /** `canManage` for a page of users in one query rather than one per row. */
  private async manageableIds(actor: AuthenticatedUser, rows: User[]): Promise<Set<string>> {
    if (this.access.isSuperAdmin(actor)) {
      return new Set(rows.map((row) => row.id));
    }
    if (actor.role !== UserRole.MODERATOR) {
      return new Set();
    }

    const candidates = rows.filter((row) => row.role === UserRole.SALES_PERSON);
    const result = new Set(
      candidates.filter((row) => row.createdBy === actor.id).map((row) => row.id),
    );
    const remaining = candidates.filter((row) => !result.has(row.id)).map((row) => row.id);

    if (remaining.length > 0) {
      const shared = await this.dataSource
        .getRepository(ProjectMember)
        .createQueryBuilder('b')
        .select('DISTINCT b.user_id', 'userId')
        .innerJoin(
          ProjectMember,
          'a',
          'a.project_id = b.project_id AND a.user_id = :actorId AND a.is_active',
          { actorId: actor.id },
        )
        .where('b.is_active AND b.user_id IN (:...remaining)', { remaining })
        .getRawMany<{ userId: string }>();
      shared.forEach((row) => result.add(row.userId));
    }

    return result;
  }

  private sharesProjectSql(userColumn: string): string {
    return `EXISTS (SELECT 1 FROM ${SQL_TABLE.PROJECT_MEMBERS} a
                      JOIN ${SQL_TABLE.PROJECT_MEMBERS} b ON b.project_id = a.project_id AND b.is_active
                     WHERE a.user_id = :actorId AND a.is_active AND b.user_id = ${userColumn})`;
  }

  /**
   * PRD §5.2: an active owner gets "already exists"; a deactivated one gets
   * an offer to reactivate, with the id to do it.
   */
  private async assertEmailFree(email: string): Promise<void> {
    const existing = await this.users.findOne({ where: { email } });
    if (!existing) return;

    if (existing.isActive) {
      throw new ConflictBusinessException(USER_ERROR.EMAIL_EXISTS);
    }
    throw new BusinessException(
      USER_ERROR.EMAIL_EXISTS_DEACTIVATED,
      ERROR_CODE.USER_DEACTIVATED_EXISTS,
      {
        userId: existing.id,
        name: existing.name,
        role: existing.role,
      },
    );
  }

  private async anotherActiveSuperAdmin(excludingUserId: string): Promise<boolean> {
    const count = await this.users
      .createQueryBuilder('u')
      .where('u.role = :role AND u.is_active AND u.id <> :id', {
        role: UserRole.SUPER_ADMIN,
        id: excludingUserId,
      })
      .getCount();
    return count > 0;
  }

  /** Blank clears; anything else must be a 10-digit Indian mobile (Assumption 1). */
  private normalisePhone(raw: string | null | undefined): string | null {
    const value = blankToNull(raw ?? null);
    if (value === null) return null;

    const phone = normaliseIndianMobile(value);
    if (!phone) {
      throw new BusinessException(LEAD_ERROR.INVALID_PHONE, ERROR_CODE.VALIDATION_FAILED);
    }
    return phone;
  }
}
