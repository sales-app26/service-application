import { ApiProperty } from '@nestjs/swagger';

import { EntryDto } from './entry.dto';
import { LeadSummaryDto } from './lead.dto';

/** A saved entry and the lead's state after it. */
export class EntrySaveResultDto {
  @ApiProperty({ type: EntryDto })
  entry: EntryDto;

  @ApiProperty({ type: LeadSummaryDto })
  lead: LeadSummaryDto;
}
