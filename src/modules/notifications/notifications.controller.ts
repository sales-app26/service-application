import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SUCCESS_MESSAGE, SWAGGER_SECURITY, SWAGGER_TAG } from '../../common/constants';
import {
  ApiOkEnvelope,
  ApiPaginatedEnvelope,
  ApiStandardErrors,
  AuthenticatedUser,
  CurrentUser,
  ResponseMessage,
} from '../../common/decorators';
import { PaginatedResponseDto } from '../../common/dto';
import {
  ListNotificationsQueryDto,
  MarkReadDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags(SWAGGER_TAG.NOTIFICATIONS)
@ApiBearerAuth(SWAGGER_SECURITY.BEARER)
@ApiStandardErrors()
@Controller(ROUTE.NOTIFICATIONS)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first',
    description: 'Only ever the caller’s own. `unreadOnly=true` leaves out the ones already read.',
  })
  @ApiPaginatedEnvelope(NotificationDto)
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponseDto<NotificationDto>> {
    return this.notificationsService.list(actor, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of mine are unread — the bell badge' })
  @ApiOkEnvelope(UnreadCountDto)
  unreadCount(@CurrentUser() actor: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.notificationsService.unreadCount(actor);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage(SUCCESS_MESSAGE.NOTIFICATIONS_READ)
  @ApiOperation({
    summary: 'Mark mine as read',
    description:
      '`ids` (up to 100) or `all: true`. Ids that are not the caller’s are ignored. Returns how many are still unread.',
  })
  @ApiOkEnvelope(UnreadCountDto)
  markRead(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: MarkReadDto,
  ): Promise<UnreadCountDto> {
    return this.notificationsService.markRead(actor, dto);
  }
}
