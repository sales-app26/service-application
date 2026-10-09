import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';

/**
 * One place name in a project's autocomplete list (DB Design §2.4).
 *
 * Unique per project regardless of capitals; the first spelling saved is the
 * one kept. A row is created only when a lead or follow-up using it is saved.
 */
@Entity({ name: TABLE.LOCATIONS })
export class Location {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Column({ name: 'project_id', type: PG_TYPE.UUID })
  projectId: string;

  /** @example Wanowrie */
  @Column({ name: 'name', type: PG_TYPE.TEXT })
  name: string;

  @Column({ name: 'created_by', type: PG_TYPE.UUID, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  createdAt: Date;
}
