import { Global, Module } from '@nestjs/common';

import { SupabaseAuthClient } from './supabase-auth.client';
import { SupabaseStorageClient } from './supabase-storage.client';

/** Supabase Auth and Storage, available everywhere. */
@Global()
@Module({
  providers: [SupabaseAuthClient, SupabaseStorageClient],
  exports: [SupabaseAuthClient, SupabaseStorageClient],
})
export class SupabaseModule {}
