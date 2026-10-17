import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import {
  DiscountType,
  LeadDue,
  LeadOwnerTag,
  LeadSource,
  LeadStatus,
  PlanCode,
  ProjectStatus,
  ProjectType,
  TransferStatus,
} from '../../../common/enums';
import { emptyToUndefined, toBoolean, trimString, trimToNull } from '../../../common/utils';
import { LocationRefDto } from '../../locations/dto/location.dto';
import { DealFieldsDto, DealOfferRefDto } from './deal.dto';
import { EntryDto, LogFollowUpDto, PersonRefDto } from './entry.dto';

export class LeadOwnerDto extends PersonRefDto {
  @ApiProperty()
  isActive: boolean;
}

/** A transfer as shown on the lead. */
export class LeadTransferRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: TransferStatus })
  status: TransferStatus;

  @ApiProperty({ type: PersonRefDto })
  toUser: PersonRefDto;

  @ApiProperty()
  reason: string;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ type: PersonRefDto, nullable: true })
  decidedBy: PersonRefDto | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  decidedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  decisionNote: string | null;
}

export class LeadSummaryDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Anil Sharma',
    description: 'The owner or manager, when known. Null on many leads.',
  })
  name: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Sharma General Stores',
    description: 'Required on every new lead; null only on older leads saved before that.',
  })
  businessName: string | null;

  @ApiProperty({ example: SWAGGER_EXAMPLE.PHONE })
  phone: string;

  @ApiProperty({ enum: LeadStatus })
  status: LeadStatus;

  @ApiPropertyOptional({ nullable: true, type: String, example: SWAGGER_EXAMPLE.DATE })
  nextFollowUpDate: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: '"Overdue by N days" when the next date has passed and the lead is still open.',
  })
  overdueDays: number | null;

  @ApiProperty({ type: LocationRefDto })
  location: LocationRefDto;

  @ApiProperty({
    type: LeadOwnerDto,
    nullable: true,
    description: 'Null: not assigned yet (left by a bulk upload for an admin to hand out).',
  })
  owner: LeadOwnerDto | null;

  @ApiPropertyOptional({
    enum: LeadOwnerTag,
    nullable: true,
    description: 'Admins: the owner is deactivated or removed — reassign the lead.',
  })
  ownerTag: LeadOwnerTag | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  convertedAt: Date | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 2499,
    description: 'List price per month in rupees, before any discount.',
  })
  dealValue: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'Annual Gold',
    description:
      'Old free-text plan, kept for history and shown when `planCode` is null. Never written any more.',
  })
  plan: string | null;

  @ApiPropertyOptional({ enum: PlanCode, nullable: true })
  planCode: PlanCode | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 6,
    description: 'Months the deal runs for; null reads as 1.',
  })
  dealTenureMonths: number | null;

  @ApiPropertyOptional({ enum: DiscountType, nullable: true })
  discountType: DiscountType | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 10,
    description: 'Percent, or rupees off the whole deal.',
  })
  discountValue: number | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'DIWALI10' })
  couponCode: string | null;

  @ApiPropertyOptional({
    type: DealOfferRefDto,
    nullable: true,
    description: 'The offer the deal used; null for a typed discount or none.',
  })
  offer: DealOfferRefDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 13494,
    description: 'What the client pays for the whole tenure: price × tenure − discount.',
  })
  dealTotal: number | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    example: 2249,
    description:
      'Deal total ÷ tenure: what the deal adds to "Monthly revenue won". Rupees, two decimals.',
  })
  effectiveMonthlyValue: number | null;

  @ApiPropertyOptional({ enum: LeadSource, nullable: true })
  source: LeadSource | null;

  @ApiProperty({ description: 'The latest entry’s time, else when the lead was added.' })
  lastActivityAt: Date;

  @ApiPropertyOptional({
    type: PersonRefDto,
    nullable: true,
    description: 'Who added the lead, or the admin who imported it.',
  })
  createdBy: PersonRefDto | null;

  @ApiProperty()
  hasPendingTransfer: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** What the caller may do on this lead, so the screen shows only those buttons. */
export class LeadPermissionsDto {
  @ApiProperty()
  canLogFollowUp: boolean;

  @ApiProperty()
  canChangeStatus: boolean;

  @ApiProperty({ description: 'Includes moving it away from Converted.' })
  canLeaveConverted: boolean;

  @ApiProperty()
  canEdit: boolean;

  @ApiProperty()
  canRequestTransfer: boolean;

  @ApiProperty()
  canReassign: boolean;

  @ApiProperty()
  canDelete: boolean;

  @ApiProperty({
    description:
      'The caller is covering for the owner, who is on leave: he may log follow-ups and change the status, nothing else.',
  })
  covering: boolean;
}

/** The newest pinned comment, shown at the top of the lead. */
export class PinnedCommentDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty()
  createdAt: Date;
}

export class LeadProjectRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ProjectType })
  type: ProjectType;

  @ApiProperty({ enum: ProjectStatus })
  status: ProjectStatus;
}

export class LeadDetailDto extends LeadSummaryDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: LeadProjectRefDto })
  project: LeadProjectRefDto;

  @ApiPropertyOptional({
    type: PersonRefDto,
    nullable: true,
    description: 'Who holds the conversion credit.',
  })
  convertedBy: PersonRefDto | null;

  @ApiProperty({ type: [EntryDto], description: 'The most recent entries, newest first.' })
  recentEntries: EntryDto[];

  @ApiProperty({ description: 'All entries, for paging through GET /leads/:id/entries.' })
  entryCount: number;

  @ApiPropertyOptional({ type: LeadTransferRefDto, nullable: true })
  pendingTransfer: LeadTransferRefDto | null;

  @ApiPropertyOptional({
    type: LeadTransferRefDto,
    nullable: true,
    description:
      'The latest decided transfer request, so the owner sees the outcome and who decided.',
  })
  lastDecidedTransfer: LeadTransferRefDto | null;

  @ApiProperty({ type: LeadPermissionsDto })
  permissions: LeadPermissionsDto;

  @ApiPropertyOptional({
    type: PersonRefDto,
    nullable: true,
    description: 'The owner, when the caller is covering for them while they are on leave.',
  })
  coveringFor: PersonRefDto | null;

  @ApiProperty({ description: 'A help request on this lead is waiting to be resolved.' })
  openHelp: boolean;

  @ApiPropertyOptional({ type: PinnedCommentDto, nullable: true })
  pinnedComment: PinnedCommentDto | null;

  @ApiProperty({ description: 'Comments on the lead, every kind, not counting deleted ones.' })
  commentCount: number;
}

/** A new lead and its first follow-up, in one form (PRD §5.5). */
export class CreateLeadDto extends LogFollowUpDto {
  @ApiPropertyOptional({ example: 'Anil Sharma', description: 'The owner or manager, if known.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string | null;

  @ApiProperty({ example: 'Sharma General Stores' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.BUSINESS_NAME_MAX_LENGTH)
  businessName: string;

  @ApiProperty({
    example: '+91 98765-43210',
    description:
      'Indian mobile. Stored as 10 digits after removing spaces, dashes, a leading 0 and +91.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional({ description: 'About the client, separate from the first follow-up note.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ enum: LeadSource, description: 'How the lead was found.' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(LeadSource)
  source?: LeadSource;

  // `status` is inherited. On a new lead New is allowed — the only place it is.
  // So are the deal fields, which a new lead takes with any status (the expected deal).
}

/**
 * Any of the lead's details. Sending any deal field replaces the whole deal
 * (fields left out are cleared); all of them null clears it.
 */
export class UpdateLeadDto extends DealFieldsDto {
  @ApiPropertyOptional({ nullable: true, description: 'The owner or manager; empty clears it.' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({ description: 'Can be changed, never cleared.' })
  // Not @IsOptional: that would let null through, and null would clear it.
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.BUSINESS_NAME_MAX_LENGTH)
  businessName?: string;

  @ApiPropertyOptional({ description: 'Checked again for duplicates in the project.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ example: 'Wanowrie' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.LOCATION_MAX_LENGTH * 2)
  location?: string;

  @ApiPropertyOptional({ enum: LeadSource, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(LeadSource)
  source?: LeadSource | null;
}

/** Lead list sort keys. `value` is the biggest deal first; `activity` the longest untouched. */
export const LEAD_SORT = [
  'updated',
  'created',
  'name',
  'next_follow_up',
  'value',
  'activity',
] as const;
export type LeadSort = (typeof LEAD_SORT)[number];

export class ListLeadsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional({ format: 'uuid', description: 'Admins: one owner’s leads.' })
  @IsOptional()
  @IsUUID('4')
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Only the caller’s own leads (a moderator’s "My leads").' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The leads of this owner, whom the caller is covering for today (403 otherwise). Other filters still apply.',
  })
  @IsOptional()
  @IsUUID('4')
  coveringFor?: string;

  @ApiPropertyOptional({ description: 'Admins: only leads whose owner is deactivated or removed.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ownerUnavailable?: boolean;

  @ApiPropertyOptional({
    description: 'Admins: only leads not assigned to anyone yet (left by a bulk upload).',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({
    enum: LeadDue,
    description:
      'By next follow-up date, India time: `overdue` before today, `today`, `tomorrow`, `week` tomorrow to 7 days ahead, `none` open with no date.',
  })
  @IsOptional()
  @IsEnum(LeadDue)
  due?: LeadDue;

  @ApiPropertyOptional({
    description: `Only open leads with no entry for ${BUSINESS_RULE.COLD_LEAD_DAYS} days.`,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  cold?: boolean;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({
    enum: LEAD_SORT,
    default: 'updated',
    description: '`value`: deal value, highest first. `activity`: longest untouched first.',
  })
  @IsOptional()
  @IsIn(LEAD_SORT)
  sort?: LeadSort;
}

export class BulkDeleteLeadsDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: BUSINESS_RULE.BULK_DELETE_MAX_LEADS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUSINESS_RULE.BULK_DELETE_MAX_LEADS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  leadIds: string[];
}

export class BulkDeleteResultDto {
  @ApiProperty({ example: 3 })
  deleted: number;
}
