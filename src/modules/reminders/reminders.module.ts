import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PushSubscription } from '../../database/entities';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushService } from './push.service';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

/** Reminders at a follow-up's time and each morning, in the app and on phones. */
@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription])],
  controllers: [RemindersController],
  providers: [RemindersService, PushService, PushSubscriptionsService],
})
export class RemindersModule {}
