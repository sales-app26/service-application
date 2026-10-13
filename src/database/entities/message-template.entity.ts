import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { Project } from './project.entity';

/**
 * A canned message for one project (`06_team_collaboration.sql`). The body
 * keeps its `{client}`, `{rep}` and `{business}` placeholders as written; the
 * app fills them in when the message is sent.
 */
@Entity({ name: TABLE.MESSAGE_TEMPLATES })
export class MessageTemplate {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  /** @example First visit */
  @Column({ name: 'label', type: PG_TYPE.TEXT })
  label: string;

  /** @example Hi {client}, this is {rep} from Pronttera. */
  @Column({ name: 'body', type: PG_TYPE.TEXT })
  body: string;

  /** Lower first. */
  @Column({ name: 'sort', type: PG_TYPE.INTEGER, default: 0 })
  sort: number;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}
