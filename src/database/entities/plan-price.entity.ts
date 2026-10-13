import { Column, Entity, PrimaryColumn } from 'typeorm';

import { PG_TYPE, SQL_DEFAULT, TABLE } from '../../common/constants';
import { PlanCode } from '../../common/enums';

/** The list price per month of one plan, set by the sales head (`08_deal_terms.sql`). */
@Entity({ name: TABLE.PLAN_PRICES })
export class PlanPrice {
  @PrimaryColumn({ name: 'plan', type: PG_TYPE.TEXT })
  plan: PlanCode;

  /** Whole rupees. Null until the sales head sets it; Free is always 0. */
  @Column({ name: 'monthly_price', type: PG_TYPE.INTEGER, nullable: true })
  monthlyPrice: number | null;

  @Column({ name: 'updated_by', type: PG_TYPE.UUID, nullable: true })
  updatedBy: string | null;

  @Column({ name: 'updated_at', type: PG_TYPE.TIMESTAMPTZ, default: () => SQL_DEFAULT.NOW })
  updatedAt: Date;
}
