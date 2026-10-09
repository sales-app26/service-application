import { Module } from '@nestjs/common';

import { LeadsModule } from '../leads/leads.module';
import { DashboardService } from './dashboard.service';
import { ExportsService } from './exports.service';
import { MeService } from './me.service';
import { ReportScopeService } from './report-scope.service';
import { ReportsController } from './reports.controller';
import { SummaryService } from './summary.service';
import { TargetsService } from './targets.service';
import { TimelineService } from './timeline.service';

/** Read-only views over leads and follow-ups: home, Due today, timeline, dashboard, exports. */
@Module({
  imports: [LeadsModule],
  controllers: [ReportsController],
  providers: [
    ReportScopeService,
    TargetsService,
    MeService,
    TimelineService,
    SummaryService,
    DashboardService,
    ExportsService,
  ],
})
export class ReportsModule {}
