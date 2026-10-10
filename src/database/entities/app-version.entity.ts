import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { User } from './user.entity';

/**
 * A release of the product and the note that goes with it.
 *
 * One number covers the API and the portal together: the people using the app
 * experience one product, so a "what's new" note that had to say which of two
 * apps moved would be noise.
 *
 * `notes` holds the markdown itself rather than a link to an uploaded file. The
 * dialog has to render on the first paint of the portal, and a second round trip
 * to storage would be a spinner in front of a release note.
 */
@Entity({ name: TABLE.APP_VERSIONS })
export class AppVersion {
  @PrimaryColumn({ name: 'id', type: PG_TYPE.UUID })
  id: string;

  /** Dotted release number, e.g. "1.2.0". @example 1.2.0 */
  @Column({ name: 'version', type: PG_TYPE.TEXT })
  version: string;

  /**
   * `major*1_000_000 + minor*1_000 + patch`, written at save time so "latest"
   * is an ORDER BY and not a string comparison (1.10.0 sorts below 1.9.0) or a
   * release date (a patch for an older line can be dated after a newer one).
   */
  @Column({ name: 'sort_order', type: PG_TYPE.INTEGER })
  sortOrder: number;

  /** Headline for the dialog and the list. @example Faster lead import */
  @Column({ name: 'title', type: PG_TYPE.TEXT, nullable: true })
  title: string | null;

  /** Short labels for what this release touched. @example ["Leads", "Transfers"] */
  @Column({ name: 'tags', type: PG_TYPE.TEXT, array: true, default: () => `'{}'::text[]` })
  tags: string[];

  /** The release note, markdown. */
  @Column({ name: 'notes', type: PG_TYPE.TEXT, default: '' })
  notes: string;

  @Column({ name: 'released_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  releasedAt: Date;

  /** Draft vs. live. Only a published version is ever "latest". */
  @Column({ name: 'is_published', type: PG_TYPE.BOOLEAN, default: false })
  isPublished: boolean;

  /** Whether reaching this version raises the dialog. Off for releases too small to interrupt. */
  @Column({ name: 'notify', type: PG_TYPE.BOOLEAN, default: true })
  notify: boolean;

  @Column({ name: 'created_by', type: PG_TYPE.UUID, nullable: true })
  createdBy: string | null;

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

/**
 * Who has already been shown which release note. A table and not browser
 * storage: the same person opens the tracker on a phone and a laptop, and local
 * storage would raise the dialog again on each and forget it when cleared. It
 * also answers the other half of the question — who has actually read it.
 */
@Entity({ name: TABLE.APP_VERSION_VIEWS })
export class AppVersionView {
  @PrimaryColumn({ name: 'id', type: PG_TYPE.UUID })
  id: string;

  @Column({ name: 'version_id', type: PG_TYPE.UUID })
  versionId: string;

  @ManyToOne(() => AppVersion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'version_id' })
  appVersion: AppVersion;

  @Column({ name: 'user_id', type: PG_TYPE.UUID })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** When they dismissed the dialog. */
  @Column({ name: 'seen_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  seenAt: Date;

  @CreateDateColumn({
    name: 'created_at',
    type: PG_TYPE.TIMESTAMPTZ,
    default: () => SQL_DEFAULT.NOW,
  })
  createdAt: Date;
}
