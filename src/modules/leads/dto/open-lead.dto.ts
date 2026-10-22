import { ApiProperty } from '@nestjs/swagger';

import { PaginationQueryDto } from '../../../common/dto';
import { LeadSource } from '../../../common/enums';
import { LocationRefDto } from '../../locations/dto/location.dto';
import { PersonRefDto } from './entry.dto';

/**
 * A lead waiting in a campaign's open list, as a rep sees it before taking it: enough to
 * decide, not enough to work it. The phone shows once the lead is theirs.
 */
export class OpenLeadDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, type: String, example: 'Sharma General Stores' })
  businessName: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'The owner or manager, if known.' })
  name: string | null;

  @ApiProperty({ type: LocationRefDto })
  location: LocationRefDto;

  @ApiProperty({ nullable: true, type: String, description: 'About the client, from the sheet.' })
  notes: string | null;

  @ApiProperty({ description: 'Whether there is a number to call once taken.' })
  hasPhone: boolean;

  @ApiProperty({ enum: LeadSource, nullable: true })
  source: LeadSource | null;

  @ApiProperty({ type: PersonRefDto, nullable: true, description: 'Who uploaded or added it.' })
  addedBy: PersonRefDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** `search` (from the base) matches the business, the person or the location. */
export class ListOpenLeadsQueryDto extends PaginationQueryDto {}

export class ClaimLeadResultDto {
  @ApiProperty({ format: 'uuid', description: 'The lead, now the caller’s.' })
  leadId: string;
}
