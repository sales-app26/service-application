import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { NotificationKind } from '../../common/enums';
import { User } from './user.entity';

/**
 * One item in a person's in-app notifications (`06_team_collaboration.sql`).
 * Only `user_id` ever reads it. Written with what the recipient may already
 * see — a lead's name, a link — never more.
 */
@Entity({ name: TABLE.NOTIFICATIONS })
export class UserNotification {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** The recipient. */
  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @Column({ name: 'kind', type: PG_TYPE.TEXT })
  kind: NotificationKind;

  @Column({ name: 'title', type: PG_TYPE.TEXT })
  title: string;

  @Column({ name: 'body', type: PG_TYPE.TEXT, nullable: true })
  body: string | null;

  /** A portal path, e.g. `/leads/<id>`. */
  @Column({ name: 'link', type: PG_TYPE.TEXT, nullable: true })
  link: string | null;

  /** Who caused it. */
  @Column({ name: 'actor_id', type: PG_TYPE.UUID, nullable: true })
  actorId: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_id' })
  actor: User | null;

  @Column({ name: 'lead_id', type: PG_TYPE.UUID, nullable: true })
  leadId: string | null;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'read_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  readAt: Date | null;
}
