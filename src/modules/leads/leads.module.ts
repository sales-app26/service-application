import { Module } from '@nestjs/common';

import { LocationsModule } from '../locations/locations.module';
import { VisitsModule } from '../visits/visits.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { EntryPresenter } from './entry.presenter';
import { LeadAccessService } from './lead-access.service';
import { LeadStateService } from './lead-state.service';
import { LeadPresenter } from './lead.presenter';
import { LeadsController } from './leads.controller';
import { LeadsImportService } from './leads-import.service';
import { LeadsService } from './leads.service';

/**
 * Leads and their history. The presenters and lead access are exported for
 * transfers, the timeline and the dashboard, which show the same rows.
 */
@Module({
  imports: [LocationsModule, VisitsModule],
  controllers: [LeadsController, EntriesController],
  providers: [
    LeadsService,
    LeadsImportService,
    EntriesService,
    LeadAccessService,
    LeadStateService,
    LeadPresenter,
    EntryPresenter,
  ],
  exports: [LeadAccessService, LeadPresenter, EntryPresenter],
})
export class LeadsModule {}
