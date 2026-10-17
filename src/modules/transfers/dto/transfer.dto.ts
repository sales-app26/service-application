import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import { TransferStatus } from '../../../common/enums';
import { trimString, trimToNull } from '../../../common/utils';
import { PersonRefDto } from '../../leads/dto/entry.dto';

export class TransferLeadRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Anil Sharma',
    description: 'The owner or manager, if known.',
  })
  name: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  businessName: string | null;

  @ApiProperty({ format: 'uuid' })
  projectId: string;

  @ApiProperty()
  projectName: string;
}

export class TransferDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ type: TransferLeadRefDto })
  lead: TransferLeadRefDto;

  @ApiProperty({
    type: PersonRefDto,
    nullable: true,
    description: 'Owner at the time of the request. Null: the lead was assigned from Not assigned.',
  })
  fromUser: PersonRefDto | null;

  @ApiProperty({ type: PersonRefDto })
  toUser: PersonRefDto;

  @ApiProperty({
    type: PersonRefDto,
    description: 'The owner, or the admin for a direct reassignment.',
  })
  requestedBy: PersonRefDto;

  @ApiProperty()
  reason: string;

  @ApiProperty({ enum: TransferStatus })
  status: TransferStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ type: PersonRefDto, nullable: true })
  decidedBy: PersonRefDto | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  decidedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'User deactivated' })
  decisionNote: string | null;

  @ApiProperty({ description: 'The caller may approve or reject it now.' })
  canDecide: boolean;
}

export class RequestTransferDto {
  @ApiProperty({ format: 'uuid', description: 'An active member of the same project.' })
  @IsUUID('4')
  toUserId: string;

  @ApiProperty({ example: 'Client lives in Ravi’s area now.' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.REASON_MAX_LENGTH)
  reason: string;

  @ApiPropertyOptional({
    maxLength: BUSINESS_RULE.HANDOVER_NOTE_MAX_LENGTH,
    nullable: true,
    example: 'Prefers calls after 6 pm. Quoted ₹1,499 for the annual plan.',
    description:
      'What the next owner should know. Saved as a pinned `handover` comment on the lead.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.HANDOVER_NOTE_MAX_LENGTH)
  handoverNote?: string | null;
}

/** Ask for a lead someone else owns, found by its phone number. */
export class RequestByPhoneDto {
  @ApiProperty({
    example: '+91 98765-43210',
    description: 'Normalised like a lead’s phone.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phone: string;

  @ApiProperty({ example: 'The owner’s brother is my client already.' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.REASON_MAX_LENGTH)
  reason: string;
}

export class BulkReassignDto extends RequestTransferDto {
  @ApiProperty({ type: [String], format: 'uuid', maxItems: BUSINESS_RULE.BULK_REASSIGN_MAX_LEADS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUSINESS_RULE.BULK_REASSIGN_MAX_LEADS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  leadIds: string[];
}

export class DecideTransferDto {
  @ApiPropertyOptional({ description: 'Shown to the owner with the decision.' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.REASON_MAX_LENGTH)
  note?: string | null;
}

export class ListTransfersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransferStatus })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  projectId?: string;
}

export class ReassignResultDto {
  @ApiProperty({ description: 'Leads that moved to the new owner.' })
  reassigned: number;

  @ApiProperty({ description: 'Leads skipped because the recipient already owns them.' })
  skipped: number;
}

export class PendingCountDto {
  @ApiProperty({ example: 3 })
  pending: number;
}
