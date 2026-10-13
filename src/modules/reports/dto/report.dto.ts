import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE, UNSPECIFIED } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import {
  AttentionKind,
  EntryType,
  FunnelStage,
  LeadSource,
  LeadStatus,
  LostReason,
  ProjectStatus,
  ProjectType,
  TargetPeriod,
  TrendBucket,
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

  @ApiProperty({
    description: 'Leads converted and credited to the caller this calendar month, India time.',
  })
  conversionsThisMonth: number;

  @ApiProperty({
    example: 14990,
    description:
      'Sum of the deal values (₹/month) of those conversions; a lead without one adds 0.',
  })
  revenueThisMonth: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  notice: string | null;
}

/** The member's own leads by what needs doing, for the home screen's agenda. */
export class AgendaDto {
  @ApiProperty({ description: 'Next follow-up date before today.' })
  overdue: number;

  @ApiProperty({ description: 'Next follow-up date today.' })
  today: number;

  @ApiProperty({ description: 'Next follow-up date tomorrow.' })
  tomorrow: number;

  @ApiProperty({
    description: 'Next follow-up date from tomorrow to 7 days ahead (tomorrow included).',
  })
  thisWeek: number;

  @ApiProperty({
    description: `Open leads with no entry for ${BUSINESS_RULE.COLD_LEAD_DAYS} days.`,
  })
  cold: number;

  @ApiProperty({ description: 'New leads with no entry at all — imported and never contacted.' })
  untouched: number;
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

  @ApiProperty({ description: 'Leads this person added, or imported.' })
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

  @ApiProperty({ description: 'Sum of the deal values (₹/month) of those conversions.' })
  revenue: number;

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

export class FunnelStepDto {
  @ApiProperty({ enum: FunnelStage })
  stage: FunnelStage;

  @ApiProperty({ description: 'Leads added in the range that have reached this stage.' })
  count: number;
}

export class TrendPointDto {
  @ApiProperty({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'The India day, or the first day of the week inside the range.',
  })
  date: string;

  @ApiProperty()
  followUps: number;

  @ApiProperty()
  newLeads: number;

  @ApiProperty()
  conversions: number;

  @ApiProperty({ description: 'Deal values (₹/month) of those conversions.' })
  revenue: number;
}

export class ReasonCountDto {
  @ApiProperty({ enum: [...Object.values(LostReason), UNSPECIFIED] })
  reason: LostReason | typeof UNSPECIFIED;

  @ApiProperty()
  count: number;
}

export class SourceCountDto {
  @ApiProperty({ enum: [...Object.values(LeadSource), UNSPECIFIED] })
  source: LeadSource | typeof UNSPECIFIED;

  @ApiProperty()
  count: number;
}

/** Something an admin should look at now, whatever the date range. */
export class AttentionItemDto {
  @ApiProperty({ enum: AttentionKind })
  kind: AttentionKind;

  @ApiPropertyOptional({
    type: PersonRefDto,
    nullable: true,
    description: 'Who it is about; for a transfer or a help request, who asked.',
  })
  user: PersonRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Null when it spans several projects.',
  })
  projectName: string | null;

  @ApiProperty({ example: '7 leads overdue for a follow-up.' })
  detail: string;

  @ApiPropertyOptional({
    description: '`overdue_pile`: the overdue leads. `idle`: the person’s open leads.',
  })
  leadCount?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '`help_request`: the lead help was asked on.',
  })
  leadId?: string;
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

  @ApiProperty({ description: 'Leads added or imported in the range.' })
  newLeads: number;

  @ApiProperty({ description: 'Follow-ups logged in the range.' })
  followUps: number;

  @ApiProperty()
  followUpsToday: number;

  @ApiProperty({ description: 'Leads converted in the range.' })
  conversions: number;

  @ApiProperty({ description: 'Sum of the deal values (₹/month) of those conversions.' })
  revenue: number;

  @ApiProperty({
    type: [FunnelStepDto],
    description:
      'Leads added in the range by the furthest stage their status has reached: created, contacted (not New), interested (Interested, Follow-up scheduled, Converted), converted.',
  })
  funnel: FunnelStepDto[];

  @ApiProperty({
    enum: TrendBucket,
    description: `\`week\` when the range is longer than ${BUSINESS_RULE.TREND_MAX_DAILY_POINTS} days.`,
  })
  trendBucket: TrendBucket;

  @ApiProperty({
    type: [TrendPointDto],
    description: 'Every day (or week) in the range, zeros included.',
  })
  trend: TrendPointDto[];

  @ApiProperty({
    type: [ReasonCountDto],
    description: 'Reasons on Not interested and Lost entries in the range, most common first.',
  })
  lostReasons: ReasonCountDto[];

  @ApiProperty({
    type: [SourceCountDto],
    description: 'Leads added in the range by source, most common first.',
  })
  sources: SourceCountDto[];

  @ApiProperty({ type: [PersonActivityDto] })
  people: PersonActivityDto[];

  @ApiProperty({
    type: [AttentionItemDto],
    description: `Right now, not the range: at most ${BUSINESS_RULE.ATTENTION_LIST_LIMIT}, most severe first.`,
  })
  needsAttention: AttentionItemDto[];

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
