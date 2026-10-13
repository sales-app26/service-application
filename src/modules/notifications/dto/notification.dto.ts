import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

import { BUSINESS_RULE, SWAGGER_EXAMPLE } from '../../../common/constants';
import { PaginationQueryDto } from '../../../common/dto';
import { NotificationKind } from '../../../common/enums';
import { toBoolean } from '../../../common/utils';
import { PersonRefDto } from '../../leads/dto/entry.dto';

export class NotificationDto {
  @ApiProperty({ format: 'uuid', example: SWAGGER_EXAMPLE.UUID })
  id: string;

  @ApiProperty({ enum: NotificationKind })
  kind: NotificationKind;

  @ApiProperty({ example: 'Meera Nair mentioned you on Anil Sharma' })
  title: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'At most 140 characters of what caused it.',
  })
  body: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '/leads/3f1c2a5e-8b0d-4c5e-9a71-2d6f0b8e4c11',
    description: 'A portal path to open.',
  })
  link: string | null;

  @ApiPropertyOptional({ type: PersonRefDto, nullable: true, description: 'Who caused it.' })
  actor: PersonRefDto | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  leadId: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, type: Date })
  readAt: Date | null;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only unread ones.', default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

export class MarkReadDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: BUSINESS_RULE.NOTIFICATIONS_READ_MAX_IDS,
    description: 'Your notifications to mark. Ids that are not yours are ignored.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BUSINESS_RULE.NOTIFICATIONS_READ_MAX_IDS)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'Mark every one of yours as read.' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  count: number;
}
