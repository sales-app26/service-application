import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import { UserRole } from '../../../common/enums';
import { lowerTrimString, toBoolean, trimString } from '../../../common/utils';
import { User } from '../../../database/entities';

/** Roles the app can create. Super Admins come from the seed or a role change. */
export const CREATABLE_ROLES = [UserRole.MODERATOR, UserRole.SALES_PERSON] as const;

export class UserDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  name: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.EMAIL })
  email: string;

  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.PHONE, nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  createdBy: string | null;

  @ApiProperty({ example: SWAGGER_EXAMPLE.TIMESTAMP })
  createdAt: Date;

  /**
   * Whether the caller may edit, deactivate or reactivate this person. The
   * screen hides those actions when false (PRD §5.2).
   */
  @ApiProperty()
  canManage: boolean;

  static from(user: User, canManage: boolean): UserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdBy: user.createdBy,
      createdAt: user.createdAt,
      canManage,
    };
  }
}

export class CreateUserDto {
  @ApiProperty({ example: 'Ravi Kumar', maxLength: BUSINESS_RULE.NAME_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.EMAIL, description: 'Stored lowercase.' })
  @Transform(lowerTrimString)
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: SWAGGER_EXAMPLE.PHONE,
    description: 'Indian mobile; spaces, dashes, a leading 0 and +91 are removed.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({
    enum: CREATABLE_ROLES,
    description: 'Moderators may create sales persons only.',
  })
  @IsIn(CREATABLE_ROLES)
  role: UserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Ravi Kumar' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    example: SWAGGER_EXAMPLE.PHONE,
    nullable: true,
    description: 'Send null or an empty string to clear.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;
}

export class ChangeRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class ChangeEmailDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.EMAIL })
  @Transform(lowerTrimString)
  @IsEmail()
  email: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Filter by active (true) or deactivated (false).' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Only active members of this project.' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;

  @ApiPropertyOptional({ description: 'Only people the caller may manage.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  manageableOnly?: boolean;
}
