import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE, UNSPECIFIED } from '../../../common/constants';
import { LostReason, TrendBucket, UserRole } from '../../../common/enums';
import { IsIsoDate } from '../../../common/validators/is-iso-date.validator';
import { PersonRefDto } from '../../leads/dto/entry.dto';
import { FunnelStepDto, ReasonCountDto, SourceCountDto } from './report.dto';

// ----------------------------------------------------------------- filters

export class ScorecardQueryDto {
  @ApiProperty({
    example: '2026-10-01',
    description: `First day, India date, inclusive. At most ${BUSINESS_RULE.DASHBOARD_MAX_DAYS} days.`,
  })
  @IsIsoDate()
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE, description: 'Last day, inclusive.' })
  @IsIsoDate()
  to: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'One campaign.' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

// ----------------------------------------------------------------- numbers

/** The numbers on a scorecard row, the team totals and the team average. */
export class ScorecardNumbersDto {
  @ApiProperty({ description: 'Leads the rep added or imported in the period (`created_by`).' })
  leadsAdded: number;

  @ApiProperty({ description: 'Follow-ups logged in the period, visits included.' })
  followUps: number;

  @ApiProperty({ description: 'Follow-ups that carry a visit photo.' })
  visits: number;

  @ApiProperty({
    description:
      'Working days (not on leave, up to today) with at least one follow-up, visit or stage change.',
  })
  activeDays: number;

  @ApiProperty({ description: 'Days in the period up to today, minus days on leave.' })
  workingDays: number;

  @ApiProperty({ description: 'Days on leave in the period up to today.' })
  leaveDays: number;

  @ApiProperty({ description: 'Leads won and credited to the rep (`converted_by`) in the period.' })
  dealsWon: number;

  @ApiProperty({
    example: 14990,
    description: 'Monthly revenue won (₹/month), as the dashboard counts it.',
  })
  wonRevenue: number;

  @ApiProperty({
    description:
      'Leads the rep marked Not interested or Lost in the period that are not Won now (each lead once).',
  })
  lostLeads: number;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Deals won ÷ (deals won + lost leads), as a whole percentage. Null when nothing was closed.',
  })
  conversionPercent: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 12.5,
    description: 'Average days from a lead being added to being won, over the deals won.',
  })
  avgDaysToWin: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      'Campaign targets scaled to the period (monthly: per calendar month; weekly: per 7 days). Null without a target.',
  })
  target: number | null;

  @ApiProperty({ description: 'Deals won in the period in the campaigns that have a target.' })
  achieved: number;

  @ApiPropertyOptional({ nullable: true, type: Number, description: 'Achieved ÷ target, 0–100+.' })
  targetPercent: number | null;

  @ApiProperty({
    description: 'Open leads owned now in active campaigns whose follow-up date has passed.',
  })
  overdueNow: number;

  @ApiProperty({ description: 'Open leads owned now in active campaigns.' })
  openNow: number;

  @ApiProperty({ description: 'Handovers the rep asked for in the period, whatever the answer.' })
  handoversAsked: number;

  @ApiProperty({ description: 'Leads handed to the rep (approved) in the period.' })
  handoversReceived: number;
}

export class ScorecardRowDto extends ScorecardNumbersDto {
  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty({ description: 'False once the rep has left the team.' })
  isActive: boolean;

  @ApiProperty({ type: [String], description: 'Campaigns in scope the rep works in.' })
  campaigns: string[];

  @ApiPropertyOptional({
    enum: [...Object.values(LostReason), UNSPECIFIED],
    nullable: true,
    description: 'The most common reason on the lost leads.',
  })
  topLostReason: LostReason | typeof UNSPECIFIED | null;
}

export class ScorecardDto {
  @ApiProperty({ example: '2026-10-01' })
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  to: string;

  @ApiProperty({ description: 'Days of the period up to today.' })
  daysSoFar: number;

  @ApiProperty({ type: [ScorecardRowDto], description: 'One row per sales rep, by name.' })
  rows: ScorecardRowDto[];

  @ApiProperty({
    type: ScorecardNumbersDto,
    description: 'Counts added up; percentages from those sums.',
  })
  totals: ScorecardNumbersDto;

  @ApiPropertyOptional({
    type: ScorecardNumbersDto,
    nullable: true,
    description: 'The average rep on the list. Null with no reps.',
  })
  averages: ScorecardNumbersDto | null;
}

// ------------------------------------------------------------------ review

export class ReviewPersonDto extends PersonRefDto {
  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [String] })
  campaigns: string[];
}

export class ReviewTrendPointDto {
  @ApiProperty({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'The day, or the first day of the week inside the range.',
  })
  date: string;

  @ApiProperty()
  followUps: number;

  @ApiProperty()
  visits: number;

  @ApiProperty()
  newLeads: number;

  @ApiProperty()
  wins: number;
}

export class PlanMixDto {
  @ApiProperty({ example: 'Growth', description: '`unspecified` when no plan was recorded.' })
  plan: string;

  @ApiProperty()
  count: number;

  @ApiProperty({ description: '₹/month of those deals.' })
  revenue: number;
}

export class ReviewWinDto {
  @ApiProperty({ format: 'uuid' })
  leadId: string;

  @ApiProperty()
  leadName: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  businessName: string | null;

  @ApiProperty()
  projectName: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  plan: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number, description: '₹/month.' })
  dealValue: number | null;

  @ApiProperty()
  wonAt: Date;
}

export class WeekdayActivityDto {
  @ApiProperty({ description: 'Monday = 0 … Sunday = 6.' })
  weekday: number;

  @ApiProperty()
  followUps: number;

  @ApiProperty()
  visits: number;
}

export class ReviewFeedbackDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ type: PersonRefDto, description: 'The manager who wrote it.' })
  author: PersonRefDto;

  @ApiProperty({ format: 'uuid' })
  leadId: string;

  @ApiProperty()
  leadName: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  entryId: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class ReviewFeedbackSummaryDto {
  @ApiProperty({ description: 'Feedback notes on the rep’s follow-ups in the period.' })
  count: number;

  @ApiProperty({ type: [ReviewFeedbackDto], description: 'The latest five, newest first.' })
  recent: ReviewFeedbackDto[];
}

/** One rep's numbers for a monthly review, next to the team's average. */
export class RepReviewDto {
  @ApiProperty({ example: '2026-10-01' })
  from: string;

  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  to: string;

  @ApiProperty({ type: ReviewPersonDto })
  person: ReviewPersonDto;

  @ApiProperty({ type: ScorecardRowDto, description: 'The same numbers as the scorecard row.' })
  numbers: ScorecardRowDto;

  @ApiPropertyOptional({
    type: ScorecardNumbersDto,
    nullable: true,
    description: 'The average rep in the caller’s scope (same campaigns and dates).',
  })
  teamAverage: ScorecardNumbersDto | null;

  @ApiProperty({ description: 'How many reps the average is over.' })
  teamSize: number;

  @ApiProperty({
    enum: TrendBucket,
    description: `\`week\` past 31 days.`,
  })
  trendBucket: TrendBucket;

  @ApiProperty({ type: [ReviewTrendPointDto] })
  trend: ReviewTrendPointDto[];

  @ApiProperty({
    type: [FunnelStepDto],
    description: 'Leads added in the period that the rep owns or added, by furthest stage.',
  })
  funnel: FunnelStepDto[];

  @ApiProperty({ type: [ReasonCountDto], description: 'Reasons on the lost leads.' })
  lostReasons: ReasonCountDto[];

  @ApiProperty({ type: [SourceCountDto], description: 'Same leads as the funnel, by source.' })
  sources: SourceCountDto[];

  @ApiProperty({ type: [PlanMixDto], description: 'Deals won in the period by plan.' })
  planMix: PlanMixDto[];

  @ApiProperty({ type: [ReviewWinDto], description: 'The 10 latest deals won in the period.' })
  recentWins: ReviewWinDto[];

  @ApiProperty({ type: [WeekdayActivityDto], description: 'Monday to Sunday.' })
  weekdays: WeekdayActivityDto[];

  @ApiProperty({ type: ReviewFeedbackSummaryDto })
  feedback: ReviewFeedbackSummaryDto;
}
