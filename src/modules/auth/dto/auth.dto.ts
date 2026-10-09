import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { ProjectStatus, ProjectType, TargetPeriod, UserRole } from '../../../common/enums';
import { lowerTrimString, trimString } from '../../../common/utils';

export class LoginDto {
  @ApiProperty({
    example: SWAGGER_EXAMPLE.EMAIL,
    description: 'Matched without regard to capitals.',
  })
  @Transform(lowerTrimString)
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'correct horse battery' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.PASSWORD_MAX_LENGTH)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.EMAIL })
  @Transform(lowerTrimString)
  @IsEmail()
  email: string;
}

export class SetPasswordDto {
  @ApiProperty({
    description:
      'The access token from the invite or reset link (Supabase puts it in the URL fragment after the redirect).',
  })
  @IsString()
  @IsNotEmpty()
  accessToken: string;

  @ApiProperty({ minLength: BUSINESS_RULE.PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(BUSINESS_RULE.PASSWORD_MIN_LENGTH)
  @MaxLength(BUSINESS_RULE.PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({ minLength: BUSINESS_RULE.PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(BUSINESS_RULE.PASSWORD_MIN_LENGTH)
  @MaxLength(BUSINESS_RULE.PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.PHONE, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;
}

/** One project the signed-in person works in, with their own target. */
export class MyProjectDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ProjectType })
  type: ProjectType;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;

  @ApiPropertyOptional({ nullable: true, type: Number })
  targetCount: number | null;

  @ApiPropertyOptional({ enum: TargetPeriod, nullable: true })
  targetPeriod: TargetPeriod | null;
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({
    type: [MyProjectDto],
    description: 'Active memberships. Empty for the Super Admin, who sees every project.',
  })
  projects: MyProjectDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '"You are not assigned to any project yet." for a member with no project.',
  })
  notice: string | null;
}

export class SessionDto {
  @ApiProperty({ description: 'Send as `Authorization: Bearer <accessToken>`.' })
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ description: 'Seconds until the access token expires.', example: 3600 })
  expiresIn: number;

  @ApiPropertyOptional({ description: 'Unix seconds when the access token expires.' })
  expiresAt?: number;

  @ApiProperty({ type: MeDto })
  user: MeDto;
}
