import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * The Supabase project is shared with Pronttera Connect, which guards
 * `auth.users` with a trigger (`private.guard_password_change`): a password
 * that already exists can change only if an approval row for that person was
 * written in the last two minutes. Supabase's invite creates the login with a
 * password already set, so without the approval every invite, reset link and
 * "Change password" fails inside Supabase.
 *
 * This API approves only after it has checked the person itself: a valid
 * one-time link, or their current password. The trigger spends the row.
 * Where the guard isn't installed (a fresh project, the test database) there
 * is nothing to approve.
 */
@Injectable()
export class PasswordChangeApprovalService {
  private readonly logger = new Logger(PasswordChangeApprovalService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async approve(userId: string): Promise<void> {
    const [{ guarded }] = (await this.dataSource.query(
      `SELECT to_regclass('private.password_change_approvals') IS NOT NULL AS guarded`,
    )) as { guarded: boolean }[];
    if (!guarded) {
      this.logger.debug('No password-change guard in this database; nothing to approve.');
      return;
    }
    await this.dataSource.query(
      `INSERT INTO private.password_change_approvals (user_id, approved_by, approved_at)
       VALUES ($1, $1, now())
       ON CONFLICT (user_id) DO UPDATE SET approved_by = EXCLUDED.approved_by, approved_at = now()`,
      [userId],
    );
  }
}
