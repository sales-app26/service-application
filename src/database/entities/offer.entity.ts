import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { DiscountType } from '../../common/enums';
import { numericTransformer } from '../../common/utils/numeric.transformer';

/**
 * A company-wide offer the sales head sets (`08_deal_terms.sql`). Reps pick an
 * active one when they mark a lead as won; its discount and coupon are copied
 * onto the lead, so changing the offer later never changes a deal already won.
 */
@Entity({ name: TABLE.OFFERS })
export class Offer {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  /** @example Diwali offer */
  @Column({ name: 'name', type: PG_TYPE.TEXT })
  name: string;

  /** @example DIWALI10 */
  @Column({ name: 'coupon_code', type: PG_TYPE.TEXT, nullable: true })
  couponCode: string | null;

  @Column({ name: 'discount_type', type: PG_TYPE.TEXT })
  discountType: DiscountType;

  @Column({
    name: 'discount_value',
    type: PG_TYPE.NUMERIC,
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  discountValue: number;

  /** India dates, inclusive. Null: no limit on that side. */
  @Column({ name: 'starts_on', type: PG_TYPE.DATE, nullable: true })
  startsOn: string | null;

  @Column({ name: 'ends_on', type: PG_TYPE.DATE, nullable: true })
  endsOn: string | null;

  /** False once the sales head ends it. */
  @Column({ name: 'active', type: PG_TYPE.BOOLEAN, default: true })
  active: boolean;

  @Column({ name: 'created_by', type: PG_TYPE.UUID })
  createdBy: string;

  @Column({ name: 'created_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  createdAt: Date;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;

  /** Removed by the sales head: hidden from every list, its name kept on past deals. */
  @Column({ name: 'deleted_at', type: PG_TYPE.TIMESTAMPTZ, nullable: true })
  deletedAt: Date | null;
}
