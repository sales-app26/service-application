import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  BUSINESS_RULE,
  CONFIG_NAMESPACE,
  ERROR_CODE,
  REPORT_ERROR,
  ROUTE,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { EntryType, LeadStatus } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { daysBetween, formatIstDateTime, toCsv } from '../../common/utils';
import { AppConfig } from '../../config/configuration';
import { ExportFilterDto } from './dto/report.dto';
import { ReportScopeService } from './report-scope.service';

export interface CsvFile {
  fileName: string;
  content: Buffer;
}

/**
 * CSV exports for the current filters (FR-15, PRD §5.12): leads, and
 * follow-ups with their GPS. At most 92 days per file (Assumption 12), and
 * a moderator's file covers only his projects.
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
              l.converted_at, cb.name AS converted_by, l.created_at, l.updated_at, l.notes
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.PROJECTS} p ON p.id = l.project_id
         JOIN ${SQL_TABLE.USERS} o ON o.id = l.owner_id
         JOIN ${SQL_TABLE.LOCATIONS} loc ON loc.id = l.location_id
         LEFT JOIN ${SQL_TABLE.USERS} cb ON cb.id = l.converted_by
        WHERE l.deleted_at IS NULL
          AND l.created_at >= $1 AND l.created_at < $2
          AND ($3::uuid[] IS NULL OR l.project_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR l.owner_id = $4::uuid)
        ORDER BY l.created_at`,
      [range.start, range.end, projectIds, filter.userId ?? null],
    )) as Array<{
      id: string;
      project: string;
      name: string;
      business_name: string | null;
      phone: string;
      location: string;
      status: LeadStatus;
      next_follow_up_date: string | null;
      owner: string;
      owner_active: boolean;
      converted_at: Date | null;
      converted_by: string | null;
      created_at: Date;
      updated_at: Date;
      notes: string | null;
    }>;

    const csv = toCsv(
      [
        'Lead ID',
        'Project',
        'Name',
        'Business name',
        'Phone',
        'Location',
        'Status',
        'Next follow-up',
        'Owner',
        'Owner active',
        'Converted at (IST)',
        'Converted by',
        'Added at (IST)',
        'Updated at (IST)',
        'Notes',
      ],
      rows.map((row) => [
        row.id,
        row.project,
        row.name,
        row.business_name,
        row.phone,
        row.location,
        row.status,
        row.next_follow_up_date,
        row.owner,
        row.owner_active ? 'yes' : 'no',
        formatIstDateTime(row.converted_at),
        row.converted_by,
        formatIstDateTime(row.created_at),
        formatIstDateTime(row.updated_at),
        row.notes,
      ]),
    );

    return { fileName: `leads_${filter.from}_${filter.to}.csv`, content: Buffer.from(csv, 'utf8') };
  }

  /** Every entry in the range, with latitude, longitude, accuracy and a photo link. */
  async entries(actor: AuthenticatedUser, filter: ExportFilterDto): Promise<CsvFile> {
    const { range, projectIds } = await this.prepare(actor, filter);

    const rows = (await this.dataSource.query(
      `SELECT f.id, f.created_at, f.updated_at, p.name AS project, l.name AS lead, l.business_name, l.phone,
              u.name AS logged_by, f.entry_type, f.status, f.note, f.next_follow_up_date::text AS next_follow_up_date,
              loc.name AS location, f.latitude, f.longitude, f.gps_accuracy_m,
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
        ORDER BY f.created_at`,
      [range.start, range.end, projectIds, filter.userId ?? null],
    )) as Array<{
      id: string;
      created_at: Date;
      updated_at: Date;
      project: string;
      lead: string;
      business_name: string | null;
      phone: string;
      logged_by: string;
      entry_type: EntryType;
      status: LeadStatus;
      note: string | null;
      next_follow_up_date: string | null;
      location: string | null;
      latitude: string | null;
      longitude: string | null;
      gps_accuracy_m: string | null;
      has_photo: boolean;
    }>;

    const csv = toCsv(
      [
        'Entry ID',
        'Logged at (IST)',
        'Project',
        'Lead',
        'Business name',
        'Phone',
        'Logged by',
        'Type',
        'Status',
        'Note',
        'Next follow-up',
        'Typed location',
        'Latitude',
        'Longitude',
        'GPS accuracy (m)',
        'Low accuracy',
        'Photo (login required)',
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
          row.entry_type,
          row.status,
          row.note,
          row.next_follow_up_date,
          row.location,
          row.latitude === null ? null : Number(row.latitude),
          row.longitude === null ? null : Number(row.longitude),
          accuracy,
          accuracy === null ? '' : accuracy > BUSINESS_RULE.LOW_ACCURACY_METRES ? 'yes' : 'no',
          row.has_photo ? this.photoLink(row.id) : '',
          row.updated_at.getTime() > row.created_at.getTime() ? 'yes' : 'no',
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

  private photoLink(entryId: string): string {
    const path = `${ROUTE.ENTRIES}/${entryId}`;
    return this.appUrl ? `${this.appUrl}/${path}` : path;
  }
}
