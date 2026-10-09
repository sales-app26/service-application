/**
 * Sales Tracker enumerations — one-for-one with the CHECK constraints in
 * `01_sales_schema.sql`. Values must match the database literals exactly.
 */

/** users.role — exactly one per person (BRD §2). */
export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  MODERATOR = 'moderator',
  SALES_PERSON = 'sales_person',
}

/** projects.type — decides whether a follow-up needs visit proof. */
export enum ProjectType {
  ONLINE = 'online',
  DOOR_TO_DOOR = 'door_to_door',
}

/** projects.status — closing archives; nothing is ever deleted. */
export enum ProjectStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

/** project_members.target_period — Monday–Sunday weeks, calendar months, IST. */
export enum TargetPeriod {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/** leads.status and follow_ups.status — the fixed list (FR-11). */
export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  INTERESTED = 'interested',
  FOLLOW_UP_SCHEDULED = 'follow_up_scheduled',
  NOT_INTERESTED = 'not_interested',
  CONVERTED = 'converted',
  LOST = 'lost',
}

/** follow_ups.entry_type */
export enum EntryType {
  /** A contact or visit. Carries visit proof in a door-to-door project. */
  FOLLOW_UP = 'follow_up',
  /** A status changed by hand. Never carries a photo: it is not a visit. */
  STATUS_CHANGE = 'status_change',
}

/** lead_transfers.status */
export enum TransferStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Why an admin sees a lead tagged. Derived, never stored: it follows the
 * owner's account and membership, so it can never go stale.
 */
export enum LeadOwnerTag {
  OWNER_INACTIVE = 'owner_inactive',
  OWNER_REMOVED = 'owner_removed',
}
