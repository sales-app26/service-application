import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { UserRole } from '../../common/enums';

/**
 * One row per person, whatever their role (DB Design §2.1).
 *
 * The id is the Supabase `auth.users.id`, so a verified token's `sub` finds
 * the row directly. Supabase holds the password; this row holds the role and
 * whether the account may work at all. Users are deactivated, never deleted,
 * so every entry they logged keeps their name.
 */
@Entity({ name: TABLE.USERS })
export class User {
  @PrimaryColumn({ name: 'id', type: PG_TYPE.UUID })
  id: string;

  /** @example Ravi Kumar */
  @Column({ name: 'name', type: PG_TYPE.TEXT })
  name: string;

  /** Login username, always lowercase. @example ravi.kumar@example.com */
  @Column({ name: 'email', type: PG_TYPE.TEXT })
  email: string;

  /** Optional, 10 digits. Lets admins call the person. @example 9876543210 */
  @Column({ name: 'phone', type: PG_TYPE.TEXT, nullable: true })
  phone: string | null;

  @Column({ name: 'role', type: PG_TYPE.TEXT })
  role: UserRole;

  @Column({ name: 'is_active', type: PG_TYPE.BOOLEAN, default: true })
  isActive: boolean;

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
