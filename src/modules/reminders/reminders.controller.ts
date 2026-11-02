import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ROUTE, SWAGGER_TAG } from '../../common/constants';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators';
import { PushKeyDto, SubscribePushDto, UnsubscribePushDto } from './dto/push.dto';
import { PushSubscriptionsService } from './push-subscriptions.service';

@ApiTags(SWAGGER_TAG.NOTIFICATIONS)
@Controller(`${ROUTE.NOTIFICATIONS}/push`)
export class RemindersController {
  constructor(private readonly subscriptions: PushSubscriptionsService) {}

  @Get('key')
  @ApiOperation({ summary: 'The public key a phone needs to turn on reminders' })
  key(): PushKeyDto {
    return { publicKey: this.subscriptions.publicKey };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send my reminders to this device',
    description: 'Only known push services are accepted. A device moves to whoever signed in last.',
  })
  async subscribe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: SubscribePushDto,
  ): Promise<null> {
    await this.subscriptions.subscribe(actor, dto);
    return null;
  }

  @Post('remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop reminders on this device' })
  async unsubscribe(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: UnsubscribePushDto,
  ): Promise<null> {
    await this.subscriptions.unsubscribe(actor, dto.endpoint);
    return null;
  }
}
