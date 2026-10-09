import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import { SWAGGER_EXAMPLE } from '../../../common/constants';
import { TargetPeriod, UserRole } from '../../../common/enums';
import { toBoolean } from '../../../common/utils';

/** A sensible ceiling: no one converts a million leads a month. */
const MAX_TARGET = 100_000;

export class MemberDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  userId: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  name: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiPropertyOptional({ description: 'Admins only.' })
  email?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Admins only.' })
  phone?: string | null;

  @ApiProperty({ description: 'FALSE when the account is deactivated.' })
  userIsActive: boolean;

  @ApiProperty({ description: 'FALSE when removed from this project.' })
  isActive: boolean;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Admins only.' })
  targetCount?: number | null;

  @ApiPropertyOptional({ enum: TargetPeriod, nullable: true, description: 'Admins only.' })
  targetPeriod?: TargetPeriod | null;

  @ApiProperty()
  joinedAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  removedAt?: Date | null;
}

export class AddMemberDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Converted leads per period. Send with `targetPeriod`, or leave both out. A person added back keeps their previous target unless a new one is sent.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET)
  targetCount?: number;

  @ApiPropertyOptional({ enum: TargetPeriod })
  @IsOptional()
  @IsEnum(TargetPeriod)
  targetPeriod?: TargetPeriod;
}

export class SetTargetDto {
  @ApiProperty({
    nullable: true,
    minimum: 1,
    description: 'Null together with `targetPeriod` null clears the target.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_TARGET)
  targetCount: number | null;

  @ApiProperty({ enum: TargetPeriod, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsEnum(TargetPeriod)
  targetPeriod: TargetPeriod | null;
}

export class ListMembersQueryDto {
  @ApiPropertyOptional({ description: 'Admins only: include removed members.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeRemoved?: boolean;
}

export class MemberParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  userId: string;
}
