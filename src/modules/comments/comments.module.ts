import { Module } from '@nestjs/common';

import { LeadsModule } from '../leads/leads.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';

/** Comments, mentions, help requests and feedback on leads. */
@Module({
  imports: [LeadsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
