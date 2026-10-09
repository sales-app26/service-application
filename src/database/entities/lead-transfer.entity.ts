import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { TransferStatus } from '../../common/enums';
import { Lead } from './lead.entity';
import { User } from './user.entity';

/**
 * A request to hand a lead to another member (DB Design §2.7).
 *
 * A direct reassignment by an admin is the same row created already
 * `approved`, with `requested_by` and `decided_by` both that admin.
 */
@Entity({ name: TABLE.LEAD_TRANSFERS })
export class LeadTransfer {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'lead_id', type: PG_TYPE.UUID })
  leadId: string;

  @ManyToOne(() => Lead)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  /** Owner at the time of the request. */
  @Column({ name: 'from_user_id', type: PG_TYPE.UUID })
  fromUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'from_user_id' })
  fromUser: User;

  @Column({ name: 'to_user_id', type: PG_TYPE.UUID })
  toUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'to_user_id' })
  toUser: User;

  @Column({ name: 'reason', type: PG_TYPE.TEXT })
  reason: string;

  @Column({ name: 'status', type: PG_TYPE.TEXT, default: TransferStatus.PENDING })
  status: TransferStatus;

  @Column({ name: 'requested_by', type: PG_TYPE.UUID })
  requestedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'requested_by' })
  requester: User;

  @CreateDateColumn({
    name: 'created_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  createdAt: Date;

  @Column({ name: 'decided_by', type: PG_TYPE.UUID, nullable: true })
  decidedBy: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'decided_by' })
  decider: User | null;

  @Column({ name: 'decided_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  decidedAt: Date | null;

  /** Why — always set when the system rejects on someone's behalf. */
  @Column({ name: 'decision_note', type: PG_TYPE.TEXT, nullable: true })
  decisionNote: string | null;
}
