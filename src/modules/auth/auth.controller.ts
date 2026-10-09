import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  Public,
  ResponseMessage,
} from '../../common/decorators';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  MeDto,
  RefreshDto,
  SessionDto,
  SetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

/** Brute-force ceiling on the unauthenticated endpoints, per IP. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags(SWAGGER_TAG.AUTH)
@ApiStandardErrors()
@Controller(ROUTE.AUTH)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.LOGGED_IN)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description: [
      'Wrong email or wrong password → `401 INVALID_CREDENTIALS`, "Email or password is incorrect" — it never says which.',
      'Correct password on a deactivated account → `401 ACCOUNT_DEACTIVATED`, "Your account is deactivated. Contact your admin."',
    ].join('\n\n'),
  })
  @ApiOkEnvelope(SessionDto)
  login(@Body() dto: LoginDto): Promise<SessionDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.TOKEN_REFRESHED)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new session',
    description:
      'Refused for a deactivated account, so a stale device cannot keep itself signed in.',
  })
  @ApiOkEnvelope(SessionDto)
  refresh(@Body() dto: RefreshDto): Promise<SessionDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('forgot-password')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email a password reset link',
    description: 'Same answer for known and unknown emails, so emails cannot be guessed.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return { message: await this.authService.forgotPassword(dto.email) };
  }

  @Post('set-password')
  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.PASSWORD_SET)
  @ApiOperation({
    summary: 'Set a password from an invite or reset link',
    description: 'At least 8 characters.',
  })
  async setPassword(@Body() dto: SetPasswordDto): Promise<null> {
    await this.authService.setPassword(dto);
    return null;
  }

  @Post('logout')
  @ApiBearerAuth(SWAGGER_SECURITY.BEARER)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.LOGGED_OUT)
  @ApiOperation({ summary: 'Sign out this device' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<null> {
    await this.authService.logout(user);
    return null;
  }

  @Get('me')
  @ApiBearerAuth(SWAGGER_SECURITY.BEARER)
  @ApiOperation({
    summary: 'The signed-in person and their projects',
    description:
      'A member with no project gets `notice`: "You are not assigned to any project yet."',
  })
  @ApiOkEnvelope(MeDto)
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeDto> {
    return this.authService.me(user.id);
  }

  @Patch('me')
  @ApiBearerAuth(SWAGGER_SECURITY.BEARER)
  @ApiOperation({ summary: 'Edit own name and phone' })
  @ApiOkEnvelope(MeDto)
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<MeDto> {
    return this.authService.updateProfile(user.id, dto);
  }

  @Post('change-password')
  @ApiBearerAuth(SWAGGER_SECURITY.BEARER)
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.PASSWORD_CHANGED)
  @ApiOperation({ summary: 'Change own password', description: 'Requires the current password.' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<null> {
    await this.authService.changePassword(user, dto);
    return null;
  }
}
