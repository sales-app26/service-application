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
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import { TransferStatus } from '../../../common/enums';
import { trimString, trimToNull } from '../../../common/utils';
import { PersonRefDto } from '../../leads/dto/entry.dto';

export class TransferLeadRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Anil Sharma' })
  name: string;

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

  @ApiProperty({ type: PersonRefDto, description: 'Owner at the time of the request.' })
  fromUser: PersonRefDto;

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
