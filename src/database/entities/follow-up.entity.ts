import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { PG_TYPE, TABLE } from '../../common/constants';
import { EntryType, LeadStatus } from '../../common/enums';
import { nullableNumericTransformer } from '../../common/utils/numeric.transformer';
import { Lead } from './lead.entity';
import { Location } from './location.entity';
import { Project } from './project.entity';
import { User } from './user.entity';

/**
 * One contact, visit or manual status change (DB Design §2.6) — the centre of
 * the design. Rows are never overwritten by a later contact; each is new.
 *
 * The id and both timestamps are set by the API rather than defaulted: the
 * photo is stored under the entry's id and stamped with its time *before* the
 * row is written, so all three have to be known up front. They are still
 * server values — the phone never sends any of them.
 */
@Entity({ name: TABLE.FOLLOW_UPS })
export class FollowUp {
  @PrimaryColumn({ name: 'id', type: PG_TYPE.UUID })
  id: string;

  @Column({ name: 'lead_id', type: PG_TYPE.UUID })
  leadId: string;

  @ManyToOne(() => Lead)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  /** Who logged it. Keeps their name after a transfer. */
  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'entry_type', type: PG_TYPE.TEXT })
  entryType: EntryType;

  /** The lead's status after this entry. Never editable. */
  @Column({ name: 'status', type: PG_TYPE.TEXT })
  status: LeadStatus;

  /** Editable the same IST day only. */
  @Column({ name: 'note', type: PG_TYPE.TEXT, nullable: true })
  note: string | null;

  /** Editable the same IST day only. */
  @Column({ name: 'next_follow_up_date', type: PG_TYPE.DATE, nullable: true })
  nextFollowUpDate: string | null;

  @Column({ name: 'location_id', type: PG_TYPE.UUID, nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location)
  @JoinColumn({ name: 'location_id' })
  location: Location | null;

  @Column({ name: 'photo_path', type: PG_TYPE.TEXT, nullable: true })
  photoPath: string | null;

  @Column({
    name: 'latitude',
    type: PG_TYPE.NUMERIC,
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  latitude: number | null;

  @Column({
    name: 'longitude',
    type: PG_TYPE.NUMERIC,
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  longitude: number | null;

  /** As reported by the phone. Stored and shown, never used to reject. */
  @Column({
    name: 'gps_accuracy_m',
    type: PG_TYPE.NUMERIC,
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  gpsAccuracyM: number | null;

  /** One-time id from the form. A double tap or retry finds this row. */
  @Column({ name: 'client_request_id', type: PG_TYPE.UUID, nullable: true })
  clientRequestId: string | null;

  /** Server time — the official visit time. */
  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ })
  createdAt: Date;

  /** Equal to `created_at` until a same-day edit; later means "Edited". */
  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}
