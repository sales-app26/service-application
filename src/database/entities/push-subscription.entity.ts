import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';

/** One device a person turned reminders on for. */
@Entity({ name: TABLE.PUSH_SUBSCRIPTIONS })
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @Column({ name: 'endpoint', type: PG_TYPE.TEXT })
  endpoint: string;

  @Column({ name: 'p256dh', type: PG_TYPE.TEXT })
  p256dh: string;

  @Column({ name: 'auth', type: PG_TYPE.TEXT })
  auth: string;

  @CreateDateColumn({
    name: 'created_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  createdAt: Date;
}
