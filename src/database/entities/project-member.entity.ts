import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { TargetPeriod } from '../../common/enums';
import { Project } from './project.entity';
import { User } from './user.entity';

/**
 * One user in one project, with that person's target (DB Design §2.3).
 *
 * Covers moderators and sales persons alike; the user's role decides what
 * they can do here. Removing a member flips `is_active` and keeps the row, so
 * adding the same person back restores the old target (PRD §5.4).
 */
@Entity({ name: TABLE.PROJECT_MEMBERS })
export class ProjectMember {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Converted leads per period. Null = no target set. */
  @Column({ name: 'target_count', type: PG_TYPE.INTEGER, nullable: true })
  targetCount: number | null;

  @Column({ name: 'target_period', type: PG_TYPE.TEXT, nullable: true })
  targetPeriod: TargetPeriod | null;

  @Column({ name: 'is_active', type: PG_TYPE.BOOLEAN, default: true })
  isActive: boolean;

  /** Same as `user_id` when a moderator assigns the project to himself. */
  @Column({ name: 'assigned_by', type: PG_TYPE.UUID, nullable: true })
  assignedBy: string | null;

  @Column({ name: 'joined_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  joinedAt: Date;

  @Column({ name: 'removed_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  removedAt: Date | null;
}
