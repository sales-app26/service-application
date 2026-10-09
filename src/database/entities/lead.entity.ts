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
import { LeadStatus } from '../../common/enums';
import { Location } from './location.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

/**
 * One client in one project — the current state only (DB Design §2.5).
 * The history is in `follow_ups`; every lead has at least one entry.
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
