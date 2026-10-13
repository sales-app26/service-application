import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { ERROR_CODE, NOTIFICATION_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { UserNotification } from '../../database/entities';
import {
  ListNotificationsQueryDto,
  MarkReadDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';

/**
 * The bell. Every read and write here is limited to the caller's own rows by
 * `user_id`: nobody — the Super Admin included — reads another person's
 * notifications.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notifications: Repository<UserNotification>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponseDto<NotificationDto>> {
    const [rows, total] = await this.notifications.findAndCount({
      where: { userId: actor.id, ...(query.unreadOnly ? { readAt: IsNull() } : {}) },
      relations: { actor: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return PaginatedResponseDto.from([rows.map(toDto), total], query.page, query.limit);
  }

  async unreadCount(actor: AuthenticatedUser): Promise<UnreadCountDto> {
    return {
      count: await this.notifications.count({ where: { userId: actor.id, readAt: IsNull() } }),
    };
  }

  /** Marks the caller's own notifications read; returns what is still unread. */
  async markRead(actor: AuthenticatedUser, dto: MarkReadDto): Promise<UnreadCountDto> {
    if (!dto.all && !dto.ids?.length) {
      throw new BusinessException(NOTIFICATION_ERROR.NOTHING_TO_MARK, ERROR_CODE.VALIDATION_FAILED);
    }

    await this.notifications.update(
      {
        userId: actor.id,
        readAt: IsNull(),
        ...(dto.all ? {} : { id: In(dto.ids!) }),
      },
      { readAt: new Date() },
    );
    return this.unreadCount(actor);
  }
}

const toDto = (row: UserNotification): NotificationDto => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  link: row.link,
  actor: row.actor ? { id: row.actor.id, name: row.actor.name } : null,
  leadId: row.leadId,
  createdAt: row.createdAt,
  readAt: row.readAt,
});
