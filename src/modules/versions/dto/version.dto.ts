import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE, VERSION_ERROR } from '../../../common/constants';
import { toBoolean, trimString, trimToNull } from '../../../common/utils';

/** `1.2.0` — three dotted numbers, nothing else. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Tags arrive from a multipart form as repeated fields or one comma-separated
 * string. Both become a trimmed, de-duplicated, capped list; an empty field is an empty list.
 */
const toTags = ({ value }: { value: unknown }): unknown => {
  if (value === undefined) return undefined;
  // An empty form field is an empty list: that is how an edit clears the tags.
  if (value === '') return [];
  const raw: unknown[] = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = raw
    .map((tag) => String(tag).trim())
    .filter((tag) => tag.length > 0 && tag.length <= BUSINESS_RULE.VERSION_TAG_MAX_LENGTH);
  return [...new Set(cleaned)].slice(0, BUSINESS_RULE.VERSION_TAGS_MAX);
};

/** An empty multipart field means "not sent", for booleans too. */
const toOptionalBoolean = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : toBoolean({ value });

export class CreateVersionDto {
  @ApiProperty({ example: '1.1.0' })
  @Transform(trimString)
  @IsString()
  @Matches(VERSION_PATTERN, { message: VERSION_ERROR.BAD_FORMAT })
  version: string;

  @ApiPropertyOptional({ example: 'Faster lead import' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.VERSION_TITLE_MAX_LENGTH)
  title?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['Leads', 'Transfers'],
    description: 'Short labels. Repeat the field or send them comma-separated.',
  })
  @IsOptional()
  @Transform(toTags)
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Release note in markdown. A `.md` file on the same request wins.',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.TIMESTAMP, description: 'Defaults to now.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsDateString()
  releasedAt?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    default: true,
    description: 'Whether reaching this version raises the dialog.',
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  notify?: boolean;
}

export class UpdateVersionDto {
  @ApiPropertyOptional({ example: '1.1.1' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Matches(VERSION_PATTERN, { message: VERSION_ERROR.BAD_FORMAT })
  version?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Empty clears it.' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(BUSINESS_RULE.VERSION_TITLE_MAX_LENGTH)
  title?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(toTags)
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: VERSION_ERROR.NOTE_EMPTY })
  notes?: string;

  @ApiPropertyOptional({ example: SWAGGER_EXAMPLE.TIMESTAMP })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsDateString()
  releasedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  notify?: boolean;
}

/** A release as the super admin manages it — drafts included. */
export class AppVersionDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ example: '1.1.0' })
  version: string;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ description: 'Release note, markdown.' })
  notes: string;

  @ApiProperty()
  releasedAt: Date;

  @ApiProperty()
  isPublished: boolean;

  @ApiProperty()
  notify: boolean;

  @ApiProperty({ description: 'How many people have dismissed the note — the read receipt count.' })
  seenCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** What the portal checks on load. */
export class LatestVersionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty()
  notes: string;

  @ApiProperty()
  releasedAt: Date;

  @ApiProperty({ description: 'True once this user has dismissed the dialog for this version.' })
  seen: boolean;

  @ApiProperty({
    description: 'False for releases published quietly: the version shows, the dialog does not.',
  })
  notify: boolean;
}

/** One published release in the history a signed-in user reads back through. */
export class VersionHistoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  version: string;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty()
  notes: string;

  @ApiProperty()
  releasedAt: Date;

  @ApiProperty()
  seen: boolean;
}

export class VersionViewDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  role: string;

  @ApiProperty()
  seenAt: Date;
}

export class VersionViewsDto {
  @ApiProperty({ type: [VersionViewDto], description: 'People who have been shown the note.' })
  seen: VersionViewDto[];

  @ApiProperty({ description: 'Active users who have not seen it yet.' })
  pending: number;
}
