import { Global, Module } from '@nestjs/common';

import { MailService } from './mail.service';

/** Outgoing email (Brevo), available everywhere. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
