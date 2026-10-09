import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { TokenVerifierService } from './token-verifier.service';

/**
 * Sign-in and the global auth guard. Global so the guard, registered as an
 * `APP_GUARD` in the root module, can resolve the token verifier.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenVerifierService, AuthGuard],
  exports: [TokenVerifierService, AuthGuard],
})
export class AuthModule {}
