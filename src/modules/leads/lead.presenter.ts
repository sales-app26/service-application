import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SQL_TABLE } from '../../common/constants';
import { LeadOwnerTag, TransferStatus } from '../../common/enums';
import { daysBetween, istToday } from '../../common/utils';
import { Lead } from '../../database/entities';
import { LeadSummaryDto } from './dto/lead.dto';
import { dealMoney } from './deal-rules';
import { isTerminal } from './lead-rules';

/**
 * Lead rows → list items. Leads must be loaded with `owner` and `location`.
 *
 * The owner tag and the pending-transfer flag are derived per page in two
 * queries, never stored: they follow the owner's account and membership, so
 * they cannot go stale (PRD §5.2, §5.4). A third looks up who added each lead.
 */
@Injectable()
export class LeadPresenter {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async summaries(leads: Lead[], options: { showOwnerTags: boolean }): Promise<LeadSummaryDto[]> {
    if (leads.length === 0) return [];

    const leadIds = leads.map((lead) => lead.id);
    const creatorIds = [
      ...new Set(leads.map((lead) => lead.createdBy).filter((id): id is string => id !== null)),
    ];
    const offerIds = [
      ...new Set(leads.map((lead) => lead.offerId).filter((id): id is string => id !== null)),
    ];
    const [pending, activeOwners, creators, offers] = await Promise.all([
      this.dataSource.query(
        `SELECT lead_id FROM ${SQL_TABLE.LEAD_TRANSFERS} WHERE status = $1 AND lead_id = ANY($2::uuid[])`,
        [TransferStatus.PENDING, leadIds],
      ) as Promise<Array<{ lead_id: string }>>,
      options.showOwnerTags
        ? (this.dataSource.query(
            `SELECT l.id
               FROM ${SQL_TABLE.LEADS} l
               JOIN ${SQL_TABLE.PROJECT_MEMBERS} pm
                 ON pm.project_id = l.project_id AND pm.user_id = l.owner_id AND pm.is_active
              WHERE l.id = ANY($1::uuid[])`,
            [leadIds],
          ) as Promise<Array<{ id: string }>>)
        : Promise.resolve([] as Array<{ id: string }>),
      creatorIds.length > 0
        ? (this.dataSource.query(
            `SELECT id, name FROM ${SQL_TABLE.USERS} WHERE id = ANY($1::uuid[])`,
            [creatorIds],
          ) as Promise<Array<{ id: string; name: string }>>)
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      // Removed offers too: a deal keeps the name of the offer it was won on.
      offerIds.length > 0
        ? (this.dataSource.query(
            `SELECT id, name FROM ${SQL_TABLE.OFFERS} WHERE id = ANY($1::uuid[])`,
            [offerIds],
          ) as Promise<Array<{ id: string; name: string }>>)
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    const pendingIds = new Set(pending.map((row) => row.lead_id));
    const ownerIsMember = new Set(activeOwners.map((row) => row.id));
    const creatorById = new Map(creators.map((row) => [row.id, row]));
    const offerById = new Map(offers.map((row) => [row.id, row]));
    const today = istToday();

    return leads.map((lead) => ({
      id: lead.id,
      projectId: lead.projectId,
      name: lead.name,
      businessName: lead.businessName,
      phone: lead.phone,
      status: lead.status,
      nextFollowUpDate: lead.nextFollowUpDate,
      overdueDays: overdueDays(lead, today),
      location: { id: lead.location.id, name: lead.location.name },
      // Null: not assigned yet.
      owner: lead.owner
        ? { id: lead.owner.id, name: lead.owner.name, isActive: lead.owner.isActive }
        : null,
      ownerTag:
        options.showOwnerTags && lead.owner
          ? !lead.owner.isActive
            ? LeadOwnerTag.OWNER_INACTIVE
            : !ownerIsMember.has(lead.id)
              ? LeadOwnerTag.OWNER_REMOVED
              : null
          : null,
      convertedAt: lead.convertedAt,
      ...dealSummary(lead),
      offer: lead.offerId ? (offerById.get(lead.offerId) ?? null) : null,
      source: lead.source,
      lastActivityAt: lead.lastActivityAt,
      createdBy: lead.createdBy ? (creatorById.get(lead.createdBy) ?? null) : null,
      hasPendingTransfer: pendingIds.has(lead.id),
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    }));
  }
}

/** The deal fields of a lead, with what the client pays and what it adds to revenue. */
export const dealSummary = (
  lead: Pick<
    Lead,
    | 'dealValue'
    | 'plan'
    | 'planCode'
    | 'dealTenureMonths'
    | 'discountType'
    | 'discountValue'
    | 'couponCode'
  >,
) => {
  const money = dealMoney(lead);
  return {
    dealValue: lead.dealValue,
    plan: lead.plan,
    planCode: lead.planCode,
    dealTenureMonths: lead.dealTenureMonths,
    discountType: lead.discountType,
    discountValue: lead.discountValue,
    couponCode: lead.couponCode,
    dealTotal: money?.dealTotal ?? null,
    effectiveMonthlyValue: money?.effectiveMonthlyValue ?? null,
  };
};

/** "Overdue by N days" until a new entry is logged (PRD §5.6). */
export const overdueDays = (
  lead: Pick<Lead, 'nextFollowUpDate' | 'status'>,
  today: string,
): number | null => {
  if (!lead.nextFollowUpDate || isTerminal(lead.status) || lead.nextFollowUpDate >= today) {
    return null;
  }
  return daysBetween(lead.nextFollowUpDate, today);
};
