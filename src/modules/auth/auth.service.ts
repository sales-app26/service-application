import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AUTH_ERROR, ERROR_CODE, LEAD_ERROR, SUCCESS_MESSAGE } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { UserRole } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { blankToNull, normaliseIndianMobile } from '../../common/utils';
import { ProjectMember, User } from '../../database/entities';
import {
  SupabaseAuthClient,
  SupabaseCallError,
  SupabaseFailure,
  SupabaseSession,
} from '../supabase/supabase-auth.client';
import {
  ChangePasswordDto,
  LoginDto,
  MeDto,
  SessionDto,
  SetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Email-and-password sign-in through Supabase Auth (PRD §5.1).
 *
 * The app talks only to this API, never to Supabase directly, so the API can
 * add what Supabase cannot know: whether the account is active here, and the
 * one generic message for a wrong email or password.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProjectMember) private readonly members: Repository<ProjectMember>,
    private readonly authClient: SupabaseAuthClient,
    private readonly tokenVerifier: TokenVerifierService,
  ) {}

  async login(dto: LoginDto): Promise<SessionDto> {
    let session: SupabaseSession;
    try {
      session = await this.authClient.signInWithPassword(dto.email, dto.password);
    } catch (error) {
      throw this.signInFailure(error);
    }

    // The password was right, so naming the deactivation leaks nothing.
    return this.toSession(session);
  }

  async refresh(refreshToken: string): Promise<SessionDto> {
    let session: SupabaseSession;
    try {
      session = await this.authClient.refresh(refreshToken);
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.REJECTED) {
        throw new BusinessException(AUTH_ERROR.INVALID_REFRESH_TOKEN, ERROR_CODE.UNAUTHORIZED);
      }
      throw SupabaseAuthClient.toBusinessException(error);
    }
    return this.toSession(session);
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    try {
      await this.authClient.signOut(user.accessToken);
    } catch (error) {
      // The device forgets its tokens either way; a failed revoke is logged.
      this.logger.warn(`Sign-out revoke failed for ${user.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Always the same answer, whether or not the email exists, so emails cannot
   * be guessed (PRD §5.1). Failures are logged, never surfaced.
   */
  async forgotPassword(email: string): Promise<string> {
    try {
      await this.authClient.sendRecoveryEmail(email);
    } catch (error) {
      this.logger.warn(
        `Recovery email for a requested address failed: ${(error as Error).message}`,
      );
    }
    return SUCCESS_MESSAGE.RESET_LINK_SENT;
  }

  /** Completes an invite or a reset link: the link's token sets the password. */
  async setPassword(dto: SetPasswordDto): Promise<void> {
    try {
      await this.tokenVerifier.verify(dto.accessToken);
      await this.authClient.setPasswordWithToken(dto.accessToken, dto.password);
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure !== SupabaseFailure.REJECTED) {
        throw SupabaseAuthClient.toBusinessException(error);
      }
      throw new BusinessException(AUTH_ERROR.INVALID_SET_PASSWORD_LINK, ERROR_CODE.UNAUTHORIZED);
    }
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto): Promise<void> {
    try {
      await this.authClient.signInWithPassword(user.email, dto.currentPassword);
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.REJECTED) {
        throw new BusinessException(
          AUTH_ERROR.CURRENT_PASSWORD_WRONG,
          ERROR_CODE.VALIDATION_FAILED,
        );
      }
      throw SupabaseAuthClient.toBusinessException(error);
    }

    try {
      await this.authClient.updateUserAsAdmin(user.id, { password: dto.newPassword });
    } catch (error) {
      throw SupabaseAuthClient.toBusinessException(error);
    }
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    return this.toMe(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<MeDto> {
    const user = await this.users.findOneOrFail({ where: { id: userId } });

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.phone !== undefined) {
      const raw = blankToNull(dto.phone);
      const phone = raw === null ? null : normaliseIndianMobile(raw);
      if (raw !== null && phone === null) {
        throw new BusinessException(LEAD_ERROR.INVALID_PHONE, ERROR_CODE.VALIDATION_FAILED);
      }
      user.phone = phone;
    }

    return this.toMe(await this.users.save(user));
  }

  // ------------------------------------------------------------------ helpers

  private async toSession(session: SupabaseSession): Promise<SessionDto> {
    const user = await this.users.findOne({ where: { id: session.user.id } });

    if (!user) {
      // A login with no account here: refuse it and do not leave it signed in.
      await this.authClient.signOut(session.access_token).catch(() => undefined);
      throw new BusinessException(AUTH_ERROR.ACCOUNT_NOT_SET_UP, ERROR_CODE.UNAUTHORIZED);
    }
    if (!user.isActive) {
      await this.authClient.signOut(session.access_token).catch(() => undefined);
      throw new BusinessException(AUTH_ERROR.ACCOUNT_DEACTIVATED, ERROR_CODE.ACCOUNT_DEACTIVATED);
    }

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
      expiresAt: session.expires_at,
      user: await this.toMe(user),
    };
  }

  private async toMe(user: User): Promise<MeDto> {
    const memberships =
      user.role === UserRole.SUPER_ADMIN
        ? []
        : await this.members.find({
            where: { userId: user.id, isActive: true },
            relations: { project: true },
            order: { joinedAt: 'ASC' },
          });

    const projects = memberships.map((membership) => ({
      id: membership.project.id,
      name: membership.project.name,
      type: membership.project.type,
      status: membership.project.status,
      targetCount: membership.targetCount,
      targetPeriod: membership.targetPeriod,
    }));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      projects,
      notice:
        user.role !== UserRole.SUPER_ADMIN && projects.length === 0
          ? SUCCESS_MESSAGE.NO_PROJECTS
          : null,
    };
  }

  private signInFailure(error: unknown): BusinessException {
    if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.REJECTED) {
      return new BusinessException(AUTH_ERROR.INVALID_CREDENTIALS, ERROR_CODE.INVALID_CREDENTIALS);
    }
    return SupabaseAuthClient.toBusinessException(error);
  }
}
