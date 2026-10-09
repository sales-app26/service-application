import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { ProjectStatus, ProjectType } from '../../common/enums';

/**
 * A sales campaign (DB Design §2.2). Its type decides whether every follow-up
 * needs a live photo and GPS. Closing archives it: it becomes read-only and
 * every photo stays viewable.
 */
@Entity({ name: TABLE.PROJECTS })
export class Project {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** @example Pune Retail Drive — Q4 */
  @Column({ name: 'name', type: PG_TYPE.TEXT })
  name: string;

  @Column({ name: 'description', type: PG_TYPE.TEXT, nullable: true })
  description: string | null;

  /** Storage path inside the private bucket; served through a signed URL. */
  @Column({ name: 'image_path', type: PG_TYPE.TEXT, nullable: true })
  imagePath: string | null;

  @Column({ name: 'type', type: PG_TYPE.TEXT })
  type: ProjectType;

  @Column({ name: 'status', type: PG_TYPE.TEXT, default: ProjectStatus.ACTIVE })
  status: ProjectStatus;

  /** `YYYY-MM-DD`. Informational: logging is allowed before it (Assumption 8). */
  @Column({ name: 'start_date', type: PG_TYPE.DATE })
  startDate: string;

  @Column({ name: 'end_date', type: PG_TYPE.DATE, nullable: true })
  endDate: string | null;

  @Column({ name: 'closed_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  closedAt: Date | null;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

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
}
