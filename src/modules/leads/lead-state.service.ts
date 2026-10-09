import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';

import { EntryType, LeadStatus } from '../../common/enums';
import { FollowUp, Lead } from '../../database/entities';
import { isTerminal } from './lead-rules';

/**
 * Rebuilds a lead's current state from its remaining entries.
 *
 * Needed only when the Super Admin deletes an entry (PRD §5.11): "if it was
 * the lead's latest entry, the lead's status and next date fall back to the
 * previous entry." Recomputing from the whole history covers that and the
 * quieter case too — deleting the entry that *started* a run of Converted
 * entries moves the conversion time to the next one.
 *
 * Invariants the rest of the code keeps, which make this possible:
 *  - `leads.status` and `next_follow_up_date` are the latest entry's;
 *  - `converted_at` is the time of the first entry of the current Converted run.
 */
@Injectable()
export class LeadStateService {
  async recompute(manager: EntityManager, lead: Lead): Promise<void> {
    const entries = await manager.getRepository(FollowUp).find({
      where: { leadId: lead.id, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const last = entries.at(-1);
    const status = last?.status ?? LeadStatus.NEW;
    const nextFollowUpDate = last && !isTerminal(last.status) ? last.nextFollowUpDate : null;

    let convertedAt: Date | null = null;
    let convertedBy: string | null = null;

    if (status === LeadStatus.CONVERTED) {
      let start = entries.length - 1;
      while (start > 0 && entries[start - 1].status === LeadStatus.CONVERTED) {
        start -= 1;
      }
      const runStart = entries[start];
      convertedAt = runStart.createdAt;

      // Keep the recorded credit when the conversion itself did not move.
      // Otherwise credit whoever converted it: the owner logs follow-ups; an
      // admin's manual change credits the owner, not the admin.
      convertedBy =
        lead.convertedAt?.getTime() === runStart.createdAt.getTime() && lead.convertedBy
          ? lead.convertedBy
          : runStart.entryType === EntryType.FOLLOW_UP
            ? runStart.userId
            : lead.ownerId;
    }

    await manager.update(
      Lead,
      { id: lead.id },
      { status, nextFollowUpDate, convertedAt, convertedBy },
    );
  }
}
