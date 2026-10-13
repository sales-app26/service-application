import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { CommentKind } from '../../common/enums';
import { FollowUp } from './follow-up.entity';
import { Lead } from './lead.entity';
import { User } from './user.entity';

/**
 * A comment on a lead (`06_team_collaboration.sql`): a plain comment, a help
 * request to the project's moderators, an admin's feedback on one entry, or
 * the handover note written with a transfer. Soft-deleted only.
 */
@Entity({ name: TABLE.LEAD_COMMENTS })
export class LeadComment {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'lead_id', type: PG_TYPE.UUID })
  leadId: string;

  @ManyToOne(() => Lead)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;

  /** Same project as the lead (composite foreign key). */
  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  /** The author. */
  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Feedback: the entry it is about. */
  @Column({ name: 'entry_id', type: PG_TYPE.UUID, nullable: true })
  entryId: string | null;

  @ManyToOne(() => FollowUp)
  @JoinColumn({ name: 'entry_id' })
  entry: FollowUp | null;

  @Column({ name: 'kind', type: PG_TYPE.TEXT })
  kind: CommentKind;

  @Column({ name: 'body', type: PG_TYPE.TEXT })
  body: string;

  /** Who was mentioned — and notified — when it was written. */
  @Column({
    name: 'mention_ids',
    type: PG_TYPE.UUID,
    array: true,
    default: () => `'{}'::uuid[]`,
  })
  mentionIds: string[];

  @Column({ name: 'pinned', type: PG_TYPE.BOOLEAN, default: false })
  pinned: boolean;

  /** Help requests only. */
  @Column({ name: 'resolved_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolved_by', type: PG_TYPE.UUID, nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  /** Set when the author changes the text. */
  @Column({ name: 'edited_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  editedAt: Date | null;

  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}
