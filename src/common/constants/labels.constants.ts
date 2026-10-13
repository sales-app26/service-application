import { EntryType, LeadSource, LeadStatus, LostReason, PlanCode } from '../enums';

/*
 * How enum values read to a salesperson, wherever the API writes them out as
 * text (report sheets). The same words the portal shows, so a sheet and the
 * screen agree: a converted lead is "Won", an imported one came "From a sheet".
 */

export const STATUS_LABEL: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: 'New',
  [LeadStatus.CONTACTED]: 'Contacted',
  [LeadStatus.INTERESTED]: 'Interested',
  [LeadStatus.FOLLOW_UP_SCHEDULED]: 'Follow-up scheduled',
  [LeadStatus.NOT_INTERESTED]: 'Not interested',
  [LeadStatus.CONVERTED]: 'Won',
  [LeadStatus.LOST]: 'Lost',
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  [LeadSource.WALK_IN]: 'Walk-in',
  [LeadSource.REFERRAL]: 'Referral',
  [LeadSource.PHONE]: 'Phone call',
  [LeadSource.WHATSAPP]: 'WhatsApp',
  [LeadSource.SOCIAL]: 'Social media',
  [LeadSource.EVENT]: 'Event',
  [LeadSource.IMPORT]: 'From a sheet',
  [LeadSource.OTHER]: 'Other',
};

export const REASON_LABEL: Record<LostReason, string> = {
  [LostReason.PRICE]: 'Price too high',
  [LostReason.HAS_ALTERNATIVE]: 'Already uses another',
  [LostReason.NOT_READY]: 'Not ready yet',
  [LostReason.NO_NEED]: 'Doesn’t need it',
  [LostReason.OWNER_UNAVAILABLE]: 'Owner not available',
  [LostReason.SHOP_CLOSED]: 'Shop closed',
  [LostReason.COMPETITOR]: 'Chose a competitor',
  [LostReason.OTHER]: 'Other',
};

export const ENTRY_TYPE_LABEL: Record<EntryType, string> = {
  [EntryType.FOLLOW_UP]: 'Follow-up',
  [EntryType.STATUS_CHANGE]: 'Stage change',
};

export const PLAN_LABEL: Record<PlanCode, string> = {
  [PlanCode.FREE]: 'Free',
  [PlanCode.GROWTH]: 'Growth',
  [PlanCode.GROWTH_PLUS]: 'Growth Plus',
  [PlanCode.PRO]: 'Pro',
};

export const YES = 'Yes';
export const NO = 'No';
