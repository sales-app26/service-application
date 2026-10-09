import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
  LeadOwnerTag,
  LeadStatus,
  ProjectStatus,
  ProjectType,
  TransferStatus,
} from '../../../common/enums';
import { toBoolean, trimString, trimToNull } from '../../../common/utils';
import { LocationRefDto } from '../../locations/dto/location.dto';
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

  @ApiProperty({ example: 'Anil Sharma' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Sharma General Stores' })
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

  @ApiProperty({ type: LeadOwnerDto })
  owner: LeadOwnerDto;

  @ApiPropertyOptional({
    enum: LeadOwnerTag,
    nullable: true,
    description: 'Admins: the owner is deactivated or removed — reassign the lead.',
  })
  ownerTag: LeadOwnerTag | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  convertedAt: Date | null;

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
}

/** A new lead and its first follow-up, in one form (PRD §5.5). */
export class CreateLeadDto extends LogFollowUpDto {
  @ApiProperty({ example: 'Anil Sharma' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({ example: 'Sharma General Stores' })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.BUSINESS_NAME_MAX_LENGTH)
  businessName?: string | null;

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

  // `status` is inherited. On a new lead New is allowed — the only place it is.
}

export class UpdateLeadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.BUSINESS_NAME_MAX_LENGTH)
  businessName?: string | null;

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
}

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

  @ApiPropertyOptional({ description: 'Admins: only leads whose owner is deactivated or removed.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ownerUnavailable?: boolean;

  @ApiPropertyOptional({
    enum: ['updated', 'created', 'name', 'next_follow_up'],
    default: 'updated',
  })
  @IsOptional()
  @IsIn(['updated', 'created', 'name', 'next_follow_up'])
  sort?: 'updated' | 'created' | 'name' | 'next_follow_up';
}
