import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { SWAGGER_EXAMPLE } from '../../../common/constants';
import { LeaderboardPeriod, TargetPeriod, UserRole } from '../../../common/enums';
import { PersonRefDto } from '../../leads/dto/entry.dto';
import { LeaveSpanDto } from '../../leaves/dto/leave.dto';

// --------------------------------------------------------------- leaderboard

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ enum: LeaderboardPeriod, default: LeaderboardPeriod.WEEK })
  @IsOptional()
  @IsEnum(LeaderboardPeriod)
  period?: LeaderboardPeriod;
}

export class LeaderboardRowDto {
  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ description: 'Conversions credited in the period.' })
  conversions: number;

  @ApiProperty({ description: 'Follow-ups logged in the period.' })
  followUps: number;

  @ApiProperty({ description: '1 is first. Equal conversions and follow-ups share a rank.' })
  rank: number;

  @ApiProperty()
  isMe: boolean;
}

export class LeaderboardDto {
  @ApiProperty({ enum: LeaderboardPeriod })
  period: LeaderboardPeriod;

  @ApiProperty({ example: '2026-10-12', description: 'First day of the period, India time.' })
  from: string;

  @ApiProperty({ example: '2026-10-18', description: 'Last day of the period, India time.' })
  to: string;

  @ApiProperty({ type: [LeaderboardRowDto] })
  rows: LeaderboardRowDto[];
}

// -------------------------------------------------------------------- roster

export class ProjectScopeQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

export class RosterPersonDto extends PersonRefDto {
  @ApiPropertyOptional({ nullable: true, type: String, example: SWAGGER_EXAMPLE.PHONE })
  phone: string | null;

  @ApiProperty({ example: SWAGGER_EXAMPLE.EMAIL })
  email: string;
}

export class ProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;
}

export class RosterTargetDto {
  @ApiProperty({ example: 10 })
  count: number;

  @ApiProperty({ enum: TargetPeriod })
  period: TargetPeriod;

  @ApiProperty({ description: 'Conversions credited in the current week or month.' })
  achieved: number;
}

export class RosterRowDto {
  @ApiProperty({ type: RosterPersonDto })
  user: RosterPersonDto;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ type: [ProjectRefDto], description: 'Their projects within the roster’s scope.' })
  projects: ProjectRefDto[];

  @ApiPropertyOptional({ type: LeaveSpanDto, nullable: true })
  onLeave: LeaveSpanDto | null;

  @ApiPropertyOptional({ type: LeaveSpanDto, nullable: true })
  nextLeave: LeaveSpanDto | null;

  @ApiPropertyOptional({
    type: PersonRefDto,
    nullable: true,
    description: 'Their backup in the `projectId` asked for; null without one.',
  })
  backup: PersonRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Date,
    description: 'Their latest entry in the roster’s projects.',
  })
  lastActivityAt: Date | null;

  @ApiProperty()
  followUpsToday: number;

  @ApiProperty({ description: 'Leads they own that are not Converted, Lost or Not interested.' })
  openLeads: number;

  @ApiProperty({ description: 'Open leads due today or earlier (overdue included).' })
  dueToday: number;

  @ApiProperty({ description: 'Open leads due before today.' })
  overdue: number;

  @ApiPropertyOptional({
    type: RosterTargetDto,
    nullable: true,
    description: 'With `projectId` only: their target there and progress; null without one.',
  })
  target: RosterTargetDto | null;
}

// ------------------------------------------------------------------ covering

export class CoveringDto {
  @ApiProperty({ type: PersonRefDto, description: 'The owner on leave.' })
  user: PersonRefDto;

  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty()
  projectName: string;

  @ApiProperty({ type: LeaveSpanDto })
  leave: LeaveSpanDto;

  @ApiProperty({ description: 'Their open leads due today or earlier (overdue included).' })
  dueToday: number;

  @ApiProperty({ description: 'Their open leads due before today.' })
  overdue: number;
}
