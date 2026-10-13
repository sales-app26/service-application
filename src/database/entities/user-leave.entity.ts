import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { User } from './user.entity';

/**
 * A person is away from `startsOn` to `endsOn`, India dates, both included
 * (`06_team_collaboration.sql`). While away, each project's backup covers
 * their follow-ups. Cancelling keeps the row.
 */
@Entity({ name: TABLE.USER_LEAVES })
export class UserLeave {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** @example 2026-10-14 */
  @Column({ name: 'starts_on', type: PG_TYPE.DATE })
  startsOn: string;

  /** Inclusive. @example 2026-10-16 */
  @Column({ name: 'ends_on', type: PG_TYPE.DATE })
  endsOn: string;

  @Column({ name: 'note', type: PG_TYPE.TEXT, nullable: true })
  note: string | null;

  /** The person, or the admin who added it for them. */
  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'cancelled_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  cancelledAt: Date | null;
}
