import { ConfigService } from '@nestjs/config';

import { BUSINESS_RULE, CONFIG_NAMESPACE, ENV } from '../../common/constants';
import { UserRole } from '../../common/enums';
import { supabaseConfig, visitConfig } from '../../config/configuration';
import {
  SupabaseAuthClient,
  SupabaseCallError,
  SupabaseFailure,
} from '../../modules/supabase/supabase-auth.client';
import { dataSource } from '../data-source';
import { User } from '../entities';

/**
 * Creates the first Super Admin — the one account nobody else can create,
 * since there is no sign-up and only admins add users (BRD §2).
 *
 * Idempotent: a second run with the same email does nothing.
 *
 *   SEED_SUPER_ADMIN_NAME, SEED_SUPER_ADMIN_EMAIL, SEED_SUPER_ADMIN_PASSWORD
 */
async function run(): Promise<void> {
  const name = process.env[ENV.SEED_SUPER_ADMIN_NAME]?.trim();
  const email = process.env[ENV.SEED_SUPER_ADMIN_EMAIL]?.trim().toLowerCase();
  const password = process.env[ENV.SEED_SUPER_ADMIN_PASSWORD] ?? '';

  if (!name || !email || password.length < BUSINESS_RULE.PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Set ${ENV.SEED_SUPER_ADMIN_NAME}, ${ENV.SEED_SUPER_ADMIN_EMAIL} and ${ENV.SEED_SUPER_ADMIN_PASSWORD} (at least ${BUSINESS_RULE.PASSWORD_MIN_LENGTH} characters).`,
    );
  }

  await dataSource.initialize();
  try {
    const users = dataSource.getRepository(User);
    const existing = await users.findOne({ where: { email } });
    if (existing) {
      console.warn(`A user with ${email} already exists (${existing.role}). Nothing to do.`);
      return;
    }

    const namespaces: Record<string, unknown> = {
      [CONFIG_NAMESPACE.SUPABASE]: supabaseConfig(),
      [CONFIG_NAMESPACE.VISIT]: visitConfig(),
    };
    const config = { getOrThrow: (key: string) => namespaces[key] } as unknown as ConfigService;
    const authClient = new SupabaseAuthClient(config);

    let authUserId: string;
    try {
      ({ id: authUserId } = await authClient.createConfirmedUser(email, password, name));
    } catch (error) {
      if (error instanceof SupabaseCallError && error.failure === SupabaseFailure.EMAIL_EXISTS) {
        throw new Error(
          `${email} already exists in Supabase Auth but has no users row. Delete it in the Supabase dashboard, or insert the row with its auth id.`,
        );
      }
      throw error;
    }

    try {
      await users.insert({
        id: authUserId,
        name,
        email,
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      });
    } catch (error) {
      await authClient.deleteUserAsAdmin(authUserId);
      throw error;
    }

    console.warn(`Super Admin ${email} created. Sign in with the seeded password.`);
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: Error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exit(1);
});
