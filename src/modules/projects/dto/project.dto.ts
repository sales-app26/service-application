import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import { ProjectStatus, ProjectType, TargetPeriod } from '../../../common/enums';
import { emptyToUndefined, trimString, trimToNull } from '../../../common/utils';
import { IsIsoDate } from '../../../common/validators/is-iso-date.validator';

export class ProjectDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: 'Pune Retail Drive — Q4' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Short-lived signed URL; request the project again for a fresh one.',
  })
  imageUrl: string | null;

  @ApiProperty({ enum: ProjectType })
  type: ProjectType;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  startDate: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: SWAGGER_EXAMPLE.DATE })
  endDate: string | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  closedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    description:
      'Active and its end date has passed — shown as a "Past end date" tag. It stays active.',
  })
  pastEndDate: boolean;

  @ApiProperty({ description: 'The type cannot change once the project has a lead.' })
  typeLocked: boolean;

  @ApiProperty({ description: 'Active members.' })
  memberCount: number;

  @ApiProperty({ description: 'Leads, excluding deleted ones.' })
  leadCount: number;

  @ApiPropertyOptional({
    enum: TargetPeriod,
    nullable: true,
    description: 'The caller’s own target here.',
  })
  myTargetPeriod?: TargetPeriod | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'The caller’s own target here.',
  })
  myTargetCount?: number | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Non-blocking notices, e.g. "Another project already has this name."',
  })
  warnings?: string[];
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Pune Retail Drive — Q4', maxLength: BUSINESS_RULE.NAME_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiProperty({
    enum: ProjectType,
    description: 'Door-to-door requires a live photo and GPS on every follow-up.',
  })
  @IsEnum(ProjectType)
  type: ProjectType;

  @ApiProperty({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'Informational; work can be logged before it.',
  })
  @IsIsoDate()
  startDate: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'On or after the start date.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIsoDate()
  endDate?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Empty or null clears it.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ enum: ProjectType, description: 'Refused once the project has a lead.' })
  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.DATE })
  @IsOptional()
  @IsIsoDate()
  startDate?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Null or empty clears it.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsIsoDate()
  endDate?: string | null;
}

export class ListProjectsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ enum: ProjectType })
  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;
}
