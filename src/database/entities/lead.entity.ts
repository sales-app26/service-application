import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { DiscountType, LeadSource, LeadStatus, PlanCode } from '../../common/enums';
import { nullableNumericTransformer } from '../../common/utils/numeric.transformer';
import { Location } from './location.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

/**
 * One client in one project — the current state only (DB Design §2.5).
 * The history is in `follow_ups`; every lead added in the app has at least
 * one entry, and an imported lead has none until its owner logs one.
 */
@Entity({ name: TABLE.LEADS })
export class Lead {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  /** Changes only through an approved transfer. */
  @Column({ name: 'owner_id', type: PG_TYPE.UUID })
  ownerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  /** @example Anil Sharma */
  @Column({ name: 'name', type: PG_TYPE.TEXT })
  name: string;

  /** @example Sharma General Stores */
  @Column({ name: 'business_name', type: PG_TYPE.TEXT, nullable: true })
  businessName: string | null;

  /** 10 digits, so duplicates are caught. @example 9876543210 */
  @Column({ name: 'phone', type: PG_TYPE.TEXT })
  phone: string;

  @Column({ name: 'location_id', type: PG_TYPE.UUID })
  locationId: string;

  @ManyToOne(() => Location)
  @JoinColumn({ name: 'location_id' })
  location: Location;

  @Column({ name: 'notes', type: PG_TYPE.TEXT, nullable: true })
  notes: string | null;

  @Column({ name: 'status', type: PG_TYPE.TEXT, default: LeadStatus.NEW })
  status: LeadStatus;

  /** Copied from the latest entry. Drives Due today. */
  @Column({ name: 'next_follow_up_date', type: PG_TYPE.DATE, nullable: true })
  nextFollowUpDate: string | null;

  /** Set when the status becomes Converted; cleared if it leaves. Drives targets. */
  @Column({ name: 'converted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  convertedAt: Date | null;

  /** The owner at the moment of conversion. Keeps the credit across transfers. */
  @Column({ name: 'converted_by', type: PG_TYPE.UUID, nullable: true })
  convertedBy: string | null;

  /**
   * The list price per month, before any discount. Won revenue is the effective
   * monthly value — see `reports/revenue-rules.ts`. @example 2499
   */
  @Column({ name: 'deal_value', type: PG_TYPE.INTEGER, nullable: true })
  dealValue: number | null;

  /** Old free-text plan, kept for history; new deals write `planCode`. @example Annual Gold */
  @Column({ name: 'plan', type: PG_TYPE.TEXT, nullable: true })
  plan: string | null;

  @Column({ name: 'plan_code', type: PG_TYPE.TEXT, nullable: true })
  planCode: PlanCode | null;

  /** 1, 3, 6 or 12. Null reads as 1. */
  @Column({ name: 'deal_tenure_months', type: PG_TYPE.SMALLINT, nullable: true })
  dealTenureMonths: number | null;

  @Column({ name: 'discount_type', type: PG_TYPE.TEXT, nullable: true })
  discountType: DiscountType | null;

  /** Percent (0–100) or whole rupees off the whole deal. */
  @Column({
    name: 'discount_value',
    type: PG_TYPE.NUMERIC,
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  discountValue: number | null;

  @Column({ name: 'coupon_code', type: PG_TYPE.TEXT, nullable: true })
  couponCode: string | null;

  /** The offer picked; its discount and coupon are copied onto the lead. Null for a typed discount. */
  @Column({ name: 'offer_id', type: PG_TYPE.UUID, nullable: true })
  offerId: string | null;

  @Column({ name: 'source', type: PG_TYPE.TEXT, nullable: true })
  source: LeadSource | null;

  /**
   * Who added it: the person who logged the first entry, or the admin who
   * imported it. Credits "new leads" even after a transfer. Null only for
   * leads imported before this was recorded.
   */
  @Column({ name: 'created_by', type: PG_TYPE.UUID, nullable: true })
  createdBy: string | null;

  /** The latest entry's time, else when the lead was added. Drives "cold" leads. */
  @Column({
    name: 'last_activity_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  lastActivityAt: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  updatedAt: Date;

  /** Soft delete, Super Admin only. Frees the phone number. */
  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}
