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

/** leads.source — how the lead was found (`05_sales_insights.sql`). */
export enum LeadSource {
  WALK_IN = 'walk_in',
  REFERRAL = 'referral',
  PHONE = 'phone',
  WHATSAPP = 'whatsapp',
  SOCIAL = 'social',
  EVENT = 'event',
  /** Set by the CSV import, never by hand. */
  IMPORT = 'import',
  OTHER = 'other',
}

/** follow_ups.reason — why a lead was marked Not interested or Lost. */
export enum LostReason {
  PRICE = 'price',
  HAS_ALTERNATIVE = 'has_alternative',
  NOT_READY = 'not_ready',
  NO_NEED = 'no_need',
  OWNER_UNAVAILABLE = 'owner_unavailable',
  SHOP_CLOSED = 'shop_closed',
  COMPETITOR = 'competitor',
  OTHER = 'other',
}

/**
 * The lead list's `due` filter, on the next follow-up date in India time.
 * Derived, never stored.
 */
export enum LeadDue {
  /** Before today. */
  OVERDUE = 'overdue',
  TODAY = 'today',
  TOMORROW = 'tomorrow',
  /** Tomorrow to seven days ahead. */
  WEEK = 'week',
  /** Still open, but no next date at all. */
  NONE = 'none',
}

/** A dashboard funnel stage, reached by a lead's current status. */
export enum FunnelStage {
  CREATED = 'created',
  CONTACTED = 'contacted',
  INTERESTED = 'interested',
  CONVERTED = 'converted',
}

/** Why the dashboard flags someone or something for an admin's attention. */
export enum AttentionKind {
  BEHIND_TARGET = 'behind_target',
  OVERDUE_PILE = 'overdue_pile',
  IDLE = 'idle',
  STALE_TRANSFER = 'stale_transfer',
  /** An open help request on a lead (`lead_comments` kind `help`). */
  HELP_REQUEST = 'help_request',
}

/** How the dashboard trend is bucketed: by India day, or by Monday–Sunday week for long ranges. */
export enum TrendBucket {
  DAY = 'day',
  WEEK = 'week',
}

/** lead_comments.kind (`06_team_collaboration.sql`). */
export enum CommentKind {
  COMMENT = 'comment',
  /** The owner or a backup asks the project's moderators for help. One open per lead. */
  HELP = 'help',
  /** An admin's note on one entry. */
  FEEDBACK = 'feedback',
  /** Written with a transfer or reassignment, pinned for the next owner. */
  HANDOVER = 'handover',
}

/** notifications.kind — what the bell item is about. */
export enum NotificationKind {
  TRANSFER_REQUESTED = 'transfer_requested',
  TRANSFER_DECIDED = 'transfer_decided',
  LEAD_ASSIGNED = 'lead_assigned',
  MENTION = 'mention',
  HELP_REQUESTED = 'help_requested',
  HELP_RESOLVED = 'help_resolved',
  COMMENT = 'comment',
  FEEDBACK = 'feedback',
  LEAVE_COVER = 'leave_cover',
  TRAINING = 'training',
}

/** training_items.kind */
export enum TrainingKind {
  /** A YouTube video, with optional checks after it. */
  VIDEO = 'video',
  /** A PDF or image in our storage, or a link. */
  DOCUMENT = 'document',
  /** Short Markdown text: the field kit. */
  CARD = 'card',
  QUIZ = 'quiz',
  /** Practise a pitch with an AI shop owner. */
  ROLEPLAY = 'roleplay',
  /** A YouTube playlist: its videos are the modules, played one after another. */
  PLAYLIST = 'playlist',
}

/** training_items.step: where a lesson shows for a rep. */
export enum TrainingStep {
  WATCH = 'watch',
  /** App tutorial: how the product works, module by module. */
  TUTORIAL = 'tutorial',
  PRACTISE = 'practise',
  PROVE = 'prove',
  FIELD = 'field',
  LIBRARY = 'library',
}

/** The project leaderboard's window: this Monday–Sunday week or calendar month, IST. */
export enum LeaderboardPeriod {
  WEEK = 'week',
  MONTH = 'month',
}

/** leads.plan_code and plan_prices.plan — the Frostique plans (`08_deal_terms.sql`). */
export enum PlanCode {
  FREE = 'free',
  GROWTH = 'growth',
  GROWTH_PLUS = 'growth_plus',
  PRO = 'pro',
}

/** leads.discount_type and offers.discount_type: a share of the deal, or rupees off it. */
export enum DiscountType {
  /** 0–100, up to two decimals, off the whole deal (price × tenure). */
  PERCENT = 'percent',
  /** Whole rupees off the whole deal. */
  AMOUNT = 'amount',
}
