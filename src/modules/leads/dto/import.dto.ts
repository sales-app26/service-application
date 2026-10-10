import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { toBoolean, trimToNull } from '../../../common/utils';
import { PersonRefDto } from './entry.dto';

/** Form fields next to the `file` part. Multipart sends everything as text. */
export class ImportLeadsDto {
  @ApiPropertyOptional({
    description:
      'Used for rows with no `location` value. Without it, such rows are listed as not importable.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  defaultLocation?: string | null;

  @ApiPropertyOptional({
    description:
      'Comma-separated ids of active members who get the rows that have no `owner_email`, shared evenly in file order.',
    example: 'b1…,c2…',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return [...new Set(list.map((id) => String(id).trim()).filter(Boolean))];
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  ownerIds?: string[];

  @ApiPropertyOptional({
    description:
      'One member who gets every row of the file. `owner_email`, `ownerIds` and `assignments` are ignored.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsUUID('4')
  ownerId?: string | null;

  @ApiPropertyOptional({
    description:
      'JSON object of file row number → member id, as picked on screen after a review dry run. Wins over `owner_email` for those rows.',
    example: '{"2":"b1…","3":"c2…"}',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(String(value)) as unknown;
    } catch {
      return 'invalid';
    }
  })
  @IsObject()
  assignments?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      '`true` with `dryRun`: rows without an owner yet are not problems; the admin assigns them after. Default `false`.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  review?: boolean;

  @ApiPropertyOptional({
    description: '`true`: check the file and report, change nothing. Default `false`.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  dryRun?: boolean;
}

export class ImportProblemDto {
  @ApiProperty({ description: 'Line number in the file (the header is line 1).' })
  row: number;

  @ApiProperty({ enum: ['invalid', 'duplicate'] })
  kind: 'invalid' | 'duplicate';

  @ApiProperty()
  name: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  reason: string;
}

export class ImportSampleDto {
  @ApiProperty()
  row: number;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: '10 digits.' })
  phone: string;

  @ApiProperty({ nullable: true, type: String })
  businessName: string | null;

  @ApiProperty()
  location: string;

  @ApiProperty({
    type: PersonRefDto,
    nullable: true,
    description: 'Null in a review until assigned.',
  })
  owner: PersonRefDto | null;
}

export class OwnerCountDto {
  @ApiProperty({ type: PersonRefDto })
  user: PersonRefDto;

  @ApiProperty()
  count: number;
}

export class ImportResultDto {
  @ApiProperty()
  dryRun: boolean;

  @ApiProperty({ description: 'Data rows in the file.' })
  total: number;

  @ApiProperty({ description: 'Rows that are, or were, good to import.' })
  importable: number;

  @ApiProperty({ description: 'Leads actually created: 0 on a dry run.' })
  imported: number;

  @ApiProperty({
    description: 'Rows skipped because the phone is already a lead here, or repeats in the file.',
  })
  duplicates: number;

  @ApiProperty({ description: 'Rows skipped because something in them is wrong.' })
  invalid: number;

  @ApiProperty({ type: [OwnerCountDto], description: 'Who gets how many of the importable rows.' })
  byOwner: OwnerCountDto[];

  @ApiProperty({ type: [ImportProblemDto] })
  problems: ImportProblemDto[];

  @ApiProperty({
    description: 'More problem rows exist than are listed; the counts above are complete.',
  })
  problemsTruncated: boolean;

  @ApiProperty({
    type: [ImportSampleDto],
    description: 'The first few importable rows, as they will be saved.',
  })
  sample: ImportSampleDto[];

  @ApiProperty({
    type: [ImportSampleDto],
    description: 'Every importable row, in file order, for assigning on screen.',
  })
  rows: ImportSampleDto[];
}
