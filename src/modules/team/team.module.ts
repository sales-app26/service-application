import { Module } from '@nestjs/common';

import { ReportsModule } from '../reports/reports.module';
import { TeamController } from './team.controller';
import { TeamService } from './team.service';

/** The roster, the project leaderboard, and who a backup is covering for. */
@Module({
  imports: [ReportsModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
