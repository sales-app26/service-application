import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { CommentKind } from '../../../common/enums';
import { trimString } from '../../../common/utils';
import { PersonRefDto } from '../../leads/dto/entry.dto';

/** The kinds a caller writes with `POST /leads/:id/comments`. Help and handover have their own routes. */
export const WRITABLE_COMMENT_KINDS = [CommentKind.COMMENT, CommentKind.FEEDBACK] as const;

export class CommentDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ enum: CommentKind })
  kind: CommentKind;

  @ApiProperty({ example: '@Meera can we offer the quarterly plan here?' })
  body: string;

  @ApiProperty({ type: PersonRefDto, description: 'The author.' })
  user: PersonRefDto;

  @ApiProperty({ type: [PersonRefDto] })
  mentions: PersonRefDto[];

  @ApiProperty()
  pinned: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Feedback: the entry it is about.',
  })
  entryId: string | null;

  @ApiPropertyOptional({ nullable: true, type: Date, description: 'Help requests only.' })
  resolvedAt: Date | null;

  @ApiPropertyOptional({ type: PersonRefDto, nullable: true })
  resolvedBy: PersonRefDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  editedAt: Date | null;

  @ApiProperty({ description: 'The caller wrote it and the project is open.' })
  canEdit: boolean;

  @ApiProperty({ description: 'The caller wrote it, or is the Super Admin.' })
  canDelete: boolean;

  @ApiProperty({ description: 'The caller owns the lead or administers the project.' })
  canPin: boolean;

  @ApiProperty({
    description: 'An open help request, and the caller administers the project or asked.',
  })
  canResolve: boolean;
}

export class CreateCommentDto {
  @ApiProperty({ maxLength: BUSINESS_RULE.COMMENT_MAX_LENGTH })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.COMMENT_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: BUSINESS_RULE.COMMENT_MAX_MENTIONS,
    description: 'From `GET /leads/:id/mentionable`; anyone else is `400`. Each is notified.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BUSINESS_RULE.COMMENT_MAX_MENTIONS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  mentionIds?: string[];

  @ApiPropertyOptional({ description: 'The lead’s owner or an admin only.' })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiPropertyOptional({
    enum: WRITABLE_COMMENT_KINDS,
    default: CommentKind.COMMENT,
    description: '`feedback`: an admin of the project, about one entry (`entryId` required).',
  })
  @IsOptional()
  @IsIn(WRITABLE_COMMENT_KINDS)
  kind?: CommentKind.COMMENT | CommentKind.FEEDBACK;

  @ApiPropertyOptional({ format: 'uuid', description: 'An entry in this lead’s history.' })
  @IsOptional()
  @IsUUID('4')
  entryId?: string;
}

export class UpdateCommentDto {
  @ApiPropertyOptional({
    maxLength: BUSINESS_RULE.COMMENT_MAX_LENGTH,
    description: 'The author only.',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.COMMENT_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ description: 'The lead’s owner or an admin only.' })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class HelpRequestDto {
  @ApiProperty({
    maxLength: BUSINESS_RULE.COMMENT_MAX_LENGTH,
    example: 'Client wants a discount I can’t approve.',
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUSINESS_RULE.COMMENT_MAX_LENGTH)
  body: string;
}
