import { Global, Module } from '@nestjs/common';

import { NotificationSenderService } from './notification-sender.service';

/** Writing notifications, for every feature that causes one. */
@Global()
@Module({
  providers: [NotificationSenderService],
  exports: [NotificationSenderService],
})
export class NotificationSenderModule {}
