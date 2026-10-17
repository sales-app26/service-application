import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  BUSINESS_RULE,
  CONFIG_NAMESPACE,
  ENTRY_TYPE_LABEL,
  ERROR_CODE,
  NO,
  NOT_ASSIGNED,
  PLAN_LABEL,
  REASON_LABEL,
  REPORT_ERROR,
  ROUTE,
  SOURCE_LABEL,
  SQL_TABLE,
  STATUS_LABEL,
  YES,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import {
  DiscountType,
  EntryType,
  LeadSource,
  LeadStatus,
  LostReason,
  PlanCode,
} from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { daysBetween, formatIstDateTime, toCsv } from '../../common/utils';
import { AppConfig } from '../../config/configuration';
import { ExportFilterDto } from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';
import { dealTotalSql, wonMonthlyRevenueSql } from './revenue-rules';

export interface CsvFile {
  fileName: string;
  content: Buffer;
}

/**
 * CSV exports for the current filters (FR-15, PRD §5.12): leads, and
 * follow-ups with their GPS. At most 92 days (Assumption 12) and 20,000 rows
 * per file, and a moderator's file covers only his projects. The row cap is
 * checked by asking for one row more than allowed, so a file that is too big
 * is refused without building it.
 *
 * The photo column links to the web app, not to storage: the file outlives
 * any signed URL and may be forwarded, so the link must ask for a login.
 */
@Injectable()
export class ExportsService {
  private readonly appUrl: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scope: ReportScopeService,
    configService: ConfigService,
  ) {
    this.appUrl = configService.getOrThrow<AppConfig>(CONFIG_NAMESPACE.APP).appUrl;
  }

  /** Leads added in the range, with their current state. */
  async leads(actor: AuthenticatedUser, filter: ExportFilterDto): Promise<CsvFile> {
    const { range, projectIds } = await this.prepare(actor, filter);

    const rows = (await this.dataSource.query(
      `SELECT l.id, p.name AS project, l.name, l.business_name, l.phone, loc.name AS location,
              l.status, l.next_follow_up_date::text AS next_follow_up_date, o.name AS owner, o.is_active AS owner_active,
              l.converted_at, cb.name AS converted_by, l.deal_value, l.plan, l.plan_code,
              l.deal_tenure_months, l.discount_type, l.discount_value::float8 AS discount_value,
              l.coupon_code, ofr.name AS offer_name,
              ${dealTotalSql('l')}::float8 AS deal_total,
              round(${wonMonthlyRevenueSql('l')}, 2)::float8 AS monthly_revenue,
              l.source, l.created_at, l.updated_at, l.last_activity_at, l.notes
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id
         LEFT JOIN ${SQL_TABLE.USERS} o ON o.id = l.owner_id
         JOIN ${SQL_TABLE.LOCATIONS} loc ON loc.id = l.location_id
         LEFT JOIN ${SQL_TABLE.USERS} cb ON cb.id = l.converted_by
         LEFT JOIN ${SQL_TABLE.OFFERS} ofr ON ofr.id = l.offer_id
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.owner_id = $4::uuid)
        ORDER BY l.created_at
        LIMIT ${BUSINESS_RULE.EXPORT_MAX_ROWS + 1}`,
      [range.start, range.end, projectIds, filter.userId ?? null],
    )) as Array<{
      id: string;
      project: string;
      name: string | null;
      business_name: string | null;
      phone: string;
      location: string;
      status: LeadStatus;
      next_follow_up_date: string | null;
      owner: string | null;
      owner_active: boolean | null;
      converted_at: Date | null;
      converted_by: string | null;
      deal_value: number | null;
      plan: string | null;
      plan_code: PlanCode | null;
      deal_tenure_months: number | null;
      discount_type: DiscountType | null;
      discount_value: number | null;
      coupon_code: string | null;
      offer_name: string | null;
      deal_total: number | null;
      monthly_revenue: number | null;
      source: LeadSource | null;
      created_at: Date;
      updated_at: Date;
      last_activity_at: Date;
      notes: string | null;
    }>;
    this.assertRowCount(rows.length);

    // Headings and values in the words the screen uses; the sheet layout itself is unchanged.
    const csv = toCsv(
      [
        'Lead reference',
        'Campaign',
        'Contact person',
        'Business name',
        'Phone',
        'Location',
        'Stage',
        'Next follow-up',
        'Lead owner',
        'Owner still on team',
        'Won on (IST)',
        'Won by',
        'Plan',
        'Tenure (months)',
        'Monthly price (₹)',
        'Discount',
        'Coupon',
        'Deal total (₹)',
        'Monthly revenue after discount (₹)',
        'Lead source',
        'Added on (IST)',
        'Last changed (IST)',
        'Last activity (IST)',
        'Notes',
      ],
      rows.map((row) => [
        row.id,
        row.project,
        row.name,
        row.business_name,
        row.phone,
        row.location,
        STATUS_LABEL[row.status] ?? row.status,
        row.next_follow_up_date,
        // An unassigned lead: no owner, so no "owner active" answer either.
        row.owner ?? NOT_ASSIGNED,
        row.owner === null ? '' : row.owner_active ? YES : NO,
        formatIstDateTime(row.converted_at),
        row.converted_by,
        row.plan_code ? PLAN_LABEL[row.plan_code] : row.plan,
        // Free runs no term; any other deal without one was for a month.
        row.plan_code === PlanCode.FREE || row.deal_value === null
          ? null
          : (row.deal_tenure_months ?? 1),
        row.deal_value,
        discountText(row),
        row.coupon_code,
        row.deal_total,
        row.monthly_revenue,
        row.source ? (SOURCE_LABEL[row.source] ?? row.source) : null,
        formatIstDateTime(row.created_at),
        formatIstDateTime(row.updated_at),
        formatIstDateTime(row.last_activity_at),
        row.notes,
      ]),
    );

    return { fileName: `leads_${filter.from}_${filter.to}.csv`, content: Buffer.from(csv, 'utf8') };
  }

  /** Every entry in the range, with the visit place, latitude, longitude, accuracy and a photo link. */
  async entries(actor: AuthenticatedUser, filter: ExportFilterDto): Promise<CsvFile> {
    const { range, projectIds } = await this.prepare(actor, filter);

    const rows = (await this.dataSource.query(
      `SELECT f.id, f.created_at, f.updated_at, p.name AS project, l.name AS lead, l.business_name, l.phone,
              u.name AS logged_by, f.entry_type, f.status, f.reason, f.note,
              f.next_follow_up_date::text AS next_follow_up_date,
              loc.name AS location, f.place_name, f.latitude, f.longitude, f.gps_accuracy_m,
              (f.photo_path IS NOT NULL) AS has_photo
         FROM ${SQL_TABLE.FOLLOW_UPS} f
         JOIN ${SQL_TABLE.LEADS} l ON l.id = f.lead_id AND l.deleted_at IS NULL
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = f.project_id
         JOIN ${SQL_TABLE.USERS} u ON u.id = f.user_id
         LEFT JOIN ${SQL_TABLE.LOCATIONS} loc ON loc.id = f.location_id
        WHERE f.deleted_at IS NULL
          AND f.created_at >= $1 AND f.created_at < $2
          AND ($3::uuid[] IS NULL OR f.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR f.user_id = $4::uuid)
        ORDER BY f.created_at
        LIMIT ${BUSINESS_RULE.EXPORT_MAX_ROWS + 1}`,
      [range.start, range.end, projectIds, filter.userId ?? null],
    )) as Array<{
      id: string;
      created_at: Date;
      updated_at: Date;
      project: string;
      lead: string | null;
      business_name: string | null;
      phone: string;
      logged_by: string;
      entry_type: EntryType;
      status: LeadStatus;
      reason: LostReason | null;
      note: string | null;
      next_follow_up_date: string | null;
      location: string | null;
      place_name: string | null;
      latitude: string | null;
      longitude: string | null;
      gps_accuracy_m: string | null;
      has_photo: boolean;
    }>;
    this.assertRowCount(rows.length);

    const csv = toCsv(
      [
        'Follow-up reference',
        'Done on (IST)',
        'Campaign',
        'Lead',
        'Business name',
        'Phone',
        'Sales rep',
        'Activity',
        'Stage',
        'Reason',
        'Note',
        'Next follow-up',
        'Location',
        'Visit place',
        'Latitude',
        'Longitude',
        'Location accurate to (m)',
        'Approximate location',
        'Visit photo (sign in to view)',
        'Edited',
      ],
      rows.map((row) => {
        const accuracy = row.gps_accuracy_m === null ? null : Number(row.gps_accuracy_m);
        return [
          row.id,
          formatIstDateTime(row.created_at),
          row.project,
          row.lead,
          row.business_name,
          row.phone,
          row.logged_by,
          ENTRY_TYPE_LABEL[row.entry_type] ?? row.entry_type,
          STATUS_LABEL[row.status] ?? row.status,
          row.reason ? (REASON_LABEL[row.reason] ?? row.reason) : null,
          row.note,
          row.next_follow_up_date,
          row.location,
          row.place_name,
          row.latitude === null ? null : Number(row.latitude),
          row.longitude === null ? null : Number(row.longitude),
          accuracy,
          accuracy === null ? '' : accuracy > BUSINESS_RULE.LOW_ACCURACY_METRES ? YES : NO,
          row.has_photo ? this.photoLink(row.id) : '',
          row.updated_at.getTime() > row.created_at.getTime() ? YES : NO,
        ];
      }),
    );

    return {
      fileName: `follow-ups_${filter.from}_${filter.to}.csv`,
      content: Buffer.from(csv, 'utf8'),
    };
  }

  private async prepare(actor: AuthenticatedUser, filter: ExportFilterDto) {
    const range = this.scope.range(filter.from, filter.to);
    if (daysBetween(range.from, range.to) + 1 > BUSINESS_RULE.EXPORT_MAX_DAYS) {
      throw new BusinessException(REPORT_ERROR.EXPORT_RANGE_TOO_LONG, ERROR_CODE.VALIDATION_FAILED);
    }
    const projectIds = await this.scope.projectScope(actor, filter.projectId);
    return { range, projectIds };
  }

  private assertRowCount(count: number): void {
    if (count > BUSINESS_RULE.EXPORT_MAX_ROWS) {
      throw new BusinessException(REPORT_ERROR.EXPORT_TOO_MANY_ROWS, ERROR_CODE.VALIDATION_FAILED);
    }
  }

  private photoLink(entryId: string): string {
    const path = `${ROUTE.ENTRIES}/${entryId}`;
    return this.appUrl ? `${this.appUrl}/${path}` : path;
  }
}

/** "10% off", "₹500 off", with the offer's name when one was picked. */
const discountText = (row: {
  discount_type: DiscountType | null;
  discount_value: number | null;
  offer_name: string | null;
}): string | null => {
  if (row.discount_type === null || row.discount_value === null) return null;
  const amount =
    row.discount_type === DiscountType.PERCENT
      ? `${row.discount_value}% off`
      : `₹${row.discount_value} off`;
  return row.offer_name ? `${amount} (${row.offer_name})` : amount;
};
