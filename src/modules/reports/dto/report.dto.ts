import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import {
  EntryType,
  LeadStatus,
  ProjectStatus,
  ProjectType,
  TargetPeriod,
  UserRole,
} from '../../../common/enums';
import { IsIsoDate } from '../../../common/validators/is-iso-date.validator';
import { EntryDto, PersonRefDto } from '../../leads/dto/entry.dto';

// ----------------------------------------------------------------- filters

export class ReportFilterDto {
  @ApiPropertyOptional({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'Inclusive, India time. Default today.',
  })
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @ApiPropertyOptional({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'Inclusive, India time. Default today.',
  })
  @IsOptional()
  @IsIsoDate()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'One sales person (or moderator doing sales work).',
  })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}

export class ExportFilterDto {
  @ApiProperty({
    example: '2026-10-01',
    description: 'Required, India time. At most 92 days per file.',
  })
  @IsIsoDate()
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  @IsIsoDate()
  to: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}

export class TimelineQueryDto {
  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.DATE, description: 'India date. Default today.' })
  @IsOptional()
  @IsIsoDate()
  date?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Admins: whose day. Default: the caller.' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Limit to one project.' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

export class SummaryQueryDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE, description: 'First day, India date, inclusive.' })
  @IsIsoDate()
  from: string;

  @ApiProperty({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'Last day, inclusive. At most 92 days from `from`.',
  })
  @IsIsoDate()
  to: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Admins: whose work. Default: the caller.' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Limit to one project.' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

export class DueTodayQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

export class ProjectFilterQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

// ----------------------------------------------------------------- targets

export class TargetProgressDto {
  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty()
  projectName: string;

  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Null: no target — show the count only.',
  })
  targetCount: number | null;

  @ApiPropertyOptional({ enum: TargetPeriod, nullable: true })
  targetPeriod: TargetPeriod | null;

  @ApiProperty({
    description: 'Conversions credited in the current target period (this week if none).',
  })
  achieved: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: '0–100+, rounded. Null without a target.',
  })
  progressPercent: number | null;

  @ApiProperty({ description: 'Start of the current period (India time), as an instant.' })
  periodStart: Date;

  @ApiProperty({ description: 'Exclusive end of the current period.' })
  periodEnd: Date;

  @ApiProperty()
  conversionsThisWeek: number;

  @ApiProperty()
  conversionsThisMonth: number;
}

// --------------------------------------------------------------------- home

export class HomeDto {
  @ApiProperty({
    type: [TargetProgressDto],
    description: 'The caller’s own progress, per project.',
  })
  targets: TargetProgressDto[];

  @ApiProperty({ description: 'Leads due today or overdue.' })
  dueToday: number;

  @ApiProperty({ description: 'Of those, how many are overdue.' })
  overdue: number;

  @ApiProperty({ description: 'Follow-ups the caller logged today.' })
  followUpsToday: number;

  @ApiProperty({ description: 'Leads the caller owns.' })
  myLeads: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  notice: string | null;
}

// ----------------------------------------------------------------- timeline

export class TimelineLeadRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  businessName: string | null;
}

export class TimelineProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ProjectType })
  type: ProjectType;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;
}

export class TimelineEntryDto extends EntryDto {
  @ApiProperty({ type: TimelineLeadRefDto })
  lead: TimelineLeadRefDto;

  @ApiProperty({ type: TimelineProjectRefDto })
  project: TimelineProjectRefDto;
}

export class TimelineDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  date: string;

  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ type: [TimelineEntryDto], description: 'In time order.' })
  entries: TimelineEntryDto[];

  @ApiProperty()
  followUps: number;

  @ApiProperty()
  visits: number;

  @ApiProperty()
  statusChanges: number;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Nothing logged on this day.' })
  message: string | null;
}

export class DaySummaryDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  date: string;

  @ApiProperty({ description: 'Follow-ups logged, visits included.' })
  followUps: number;

  @ApiProperty({ description: 'Follow-ups that carry a visit photo.' })
  visits: number;

  @ApiProperty()
  statusChanges: number;

  @ApiProperty({ description: 'Leads this person added (their first entry on the lead).' })
  newLeads: number;

  @ApiProperty({ description: 'Leads converted and credited to this person.' })
  conversions: number;
}

export class SummaryTotalsDto extends OmitType(DaySummaryDto, ['date'] as const) {
  @ApiProperty({ description: 'Days with at least one entry.' })
  activeDays: number;
}

/** One person's work over a week, a month or any range up to 92 days. */
export class SummaryDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  to: string;

  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ type: SummaryTotalsDto })
  totals: SummaryTotalsDto;

  @ApiProperty({
    type: [DaySummaryDto],
    description: 'Every day in the range, quiet ones as zeros.',
  })
  days: DaySummaryDto[];
}

// ---------------------------------------------------------------- dashboard

export class StatusCountDto {
  @ApiProperty({ enum: LeadStatus })
  status: LeadStatus;

  @ApiProperty()
  count: number;
}

export class PersonActivityDto {
  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ description: 'Leads this person added in the range.' })
  newLeads: number;

  @ApiProperty({ description: 'Follow-ups this person logged in the range.' })
  followUps: number;

  @ApiProperty({ description: 'Conversions credited to this person in the range.' })
  conversions: number;

  @ApiProperty()
  followUpsToday: number;
}

export class IdleMemberDto {
  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ type: [String], description: 'Projects where nothing was logged today.' })
  projects: string[];
}

export class ConversionDto {
  @ApiProperty({ format: 'uuid' })
  leadId: string;

  @ApiProperty()
  leadName: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  businessName: string | null;

  @ApiProperty({ description: 'To call the client and spot-check.' })
  phone: string;

  @ApiProperty()
  projectName: string;

  @ApiProperty({ type: PersonRefDto, description: 'Credited with the conversion.' })
  convertedBy: PersonRefDto;

  @ApiProperty({ type: PersonRefDto })
  currentOwner: PersonRefDto;

  @ApiProperty()
  convertedAt: Date;

  @ApiProperty({
    enum: EntryType,
    description: '`status_change` = set by hand, tagged on the list.',
  })
  via: EntryType;
}

export class DashboardDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  to: string;

  @ApiProperty({
    type: [TargetProgressDto],
    description: 'Current week or month, not the date range.',
  })
  targets: TargetProgressDto[];

  @ApiProperty()
  newLeads: number;

  @ApiProperty({ description: 'Follow-ups logged in the range.' })
  followUps: number;

  @ApiProperty()
  followUpsToday: number;

  @ApiProperty({ type: [PersonActivityDto] })
  people: PersonActivityDto[];

  @ApiProperty({ type: [IdleMemberDto], description: 'Active members with no entry today.' })
  loggedNothingToday: IdleMemberDto[];

  @ApiProperty({ type: [StatusCountDto] })
  leadsByStatus: StatusCountDto[];

  @ApiProperty({
    type: [ConversionDto],
    description: 'This week (Mon–Sun, India time), newest first.',
  })
  conversionsThisWeek: ConversionDto[];

  @ApiProperty()
  pendingTransfers: number;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'No data for these dates.' })
  message: string | null;
}
