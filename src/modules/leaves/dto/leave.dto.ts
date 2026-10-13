import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { trimToNull } from '../../../common/utils';
import { IsIsoDate } from '../../../common/validators/is-iso-date.validator';
import { PersonRefDto } from '../../leads/dto/entry.dto';

/** The days of one leave, India dates, both included. */
export class LeaveSpanDto {
  @ApiProperty({ example: SWAGGER_EXAMPLE.DATE })
  startsOn: string;

  @ApiProperty({ example: '2026-10-10' })
  endsOn: string;
}

export class LeaveDto extends LeaveSpanDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ type: PersonRefDto, description: 'Who is away.' })
  user: PersonRefDto;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Family wedding' })
  note: string | null;

  @ApiProperty({ type: PersonRefDto, description: 'The person, or the admin who added it.' })
  createdBy: PersonRefDto;

  @ApiProperty()
  createdAt: Date;
}

export class CreateLeaveDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Who is away. Leave out (or send your own id) for yourself. For someone else: the Super Admin, or a moderator for a sales person he manages.',
  })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiProperty({
    example: SWAGGER_EXAMPLE.DATE,
    description: 'First day away. May be before today if the leave still covers today.',
  })
  @IsIsoDate()
  startsOn: string;

  @ApiProperty({
    example: '2026-10-10',
    description: `Last day away, at most ${BUSINESS_RULE.LEAVE_MAX_SPAN_DAYS} days after the first.`,
  })
  @IsIsoDate()
  endsOn: string;

  @ApiPropertyOptional({ maxLength: BUSINESS_RULE.LEAVE_NOTE_MAX_LENGTH, nullable: true })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BUSINESS_RULE.LEAVE_NOTE_MAX_LENGTH)
  note?: string | null;
}

export class ListLeavesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'One person. Sales persons: only themselves. Without it, admins get everyone in their scope.',
  })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
