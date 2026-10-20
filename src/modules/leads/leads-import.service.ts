import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  BUSINESS_RULE,
  DB_CONSTRAINT,
  ERROR_CODE,
  IMPORT_ERROR,
  LOCATION_ERROR,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { LeadSource, LeadStatus } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
} from '../../common/exceptions/business.exception';
import {
  collapseWhitespace,
  isUniqueViolation,
  normaliseIndianMobile,
  parseCsv,
} from '../../common/utils';
import { Lead } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationsService } from '../locations/locations.service';
import {
  ImportLeadsDto,
  ImportProblemDto,
  ImportResultDto,
  ImportSampleDto,
} from './dto/import.dto';

/** Column names an admin is likely to use, matched without case, spaces or dashes. */
const COLUMN_ALIASES = {
  // The person at the business (owner or manager), when known. Not `owner`: that is
  // ownerEmail, the team member who gets the lead.
  name: [
    'name',
    'client',
    'client_name',
    'lead',
    'lead_name',
    'full_name',
    'customer',
    'owner_name',
    'manager_name',
    'contact_name',
    'contact_person',
    'person',
  ],
  phone: [
    'phone',
    'mobile',
    'phone_number',
    'mobile_number',
    'contact',
    'contact_number',
    'whatsapp',
  ],
  businessName: [
    'business_name',
    'business',
    'company',
    'company_name',
    'shop',
    'shop_name',
    'store',
    'store_name',
    'outlet',
    'outlet_name',
    'firm',
    'brand',
  ],
  location: ['location', 'area', 'locality', 'city'],
  notes: ['notes', 'note', 'remarks', 'comments'],
  ownerEmail: ['owner_email', 'owner', 'assigned_to', 'assign_to', 'sales_person_email'],
} as const;
type Column = keyof typeof COLUMN_ALIASES;

const SAMPLE_SIZE = 5;
const INSERT_CHUNK = 200;
const MAX_EMAIL = 254;

interface Member {
  id: string;
  name: string;
  email: string;
}

/**
 * How a row with no phone is told apart: its business at its location, ignoring case.
 * Both already have their spaces collapsed; existingBusinesses builds the same key in SQL.
 */
const businessKey = (businessName: string, location: string): string =>
  `${businessName.toLowerCase()}\n${location.toLowerCase()}`;

interface ReadyRow {
  row: number;
  name: string | null;
  /** Null when the sheet left it empty. */
  phone: string | null;
  businessName: string;
  notes: string | null;
  location: string;
  /** Null until the even split hands one out. */
  owner: Member | null;
}

/**
 * Bulk lead import from a CSV (admin request after the v1 PRD, which listed it as "Later").
 *
 * Imported leads are plain assignments: status New, no first follow-up, no visit
 * photo — even in a door-to-door project, because nobody has visited yet. The
 * owner finds them in My leads and logs the first visit as usual. Each is marked
 * with source `import` and credited as added by the admin who imported it.
 *
 * Rows that cannot be imported are skipped and reported; the rest go in. A dry
 * run does everything except the final insert, so the admin sees the same report
 * before committing. Running the same file twice is harmless: the second run finds
 * every phone already a lead and imports nothing.
 *
 * The phone is optional: a row with no number goes in without one, and it is matched on
 * its business name and location instead, so the second run skips it too.
 */
@Injectable()
export class LeadsImportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly locations: LocationsService,
  ) {}

  async import(
    actor: AuthenticatedUser,
    projectId: string,
    file: Express.Multer.File | undefined,
    dto: ImportLeadsDto,
  ): Promise<ImportResultDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);

    const records = this.readFile(file);
    const columns = this.mapColumns(records[0]);
    const body = records.slice(1);
    if (body.length === 0) throw this.bad(IMPORT_ERROR.EMPTY);
    if (body.length > BUSINESS_RULE.IMPORT_MAX_ROWS) throw this.bad(IMPORT_ERROR.TOO_MANY_ROWS);

    const members = await this.activeMembers(projectId);
    const byEmail = new Map(members.map((member) => [member.email, member]));
    const single = dto.ownerId ? this.chooseOwners([dto.ownerId], members)[0] : null;
    const chosen = single ? [] : this.chooseOwners(dto.ownerIds ?? [], members);
    const assigned = single
      ? new Map<number, Member>()
      : this.readAssignments(dto.assignments, members);
    const dryRun = dto.dryRun === true;
    const defaultLocation = dto.defaultLocation ? this.tryLocation(dto.defaultLocation) : null;

    const problems: ImportProblemDto[] = [];
    const ready: ReadyRow[] = [];
    let invalid = 0;
    let duplicates = 0;
    const fail = (
      kind: ImportProblemDto['kind'],
      row: number,
      name: string,
      phone: string,
      reason: string,
    ): void => {
      if (kind === 'invalid') invalid += 1;
      else duplicates += 1;
      problems.push({ row, kind, name, phone, reason });
    };

    // ---- row by row: shape of each value
    const cell = (record: string[], column: Column): string =>
      collapseWhitespace(record[columns[column] ?? -1] ?? '');
    const phonesInFile = new Map<string, number>();
    const businessesInFile = new Map<string, number>();
    const checked: Array<ReadyRow & { ownerEmail: string }> = [];

    body.forEach((record, index) => {
      const row = index + 2;
      const name = cell(record, 'name') || null;
      const rawPhone = cell(record, 'phone');
      // An empty cell is fine: the lead goes in without a number. A filled one must be valid.
      const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
      const businessName = cell(record, 'businessName');
      const notes = (record[columns.notes ?? -1] ?? '').trim() || null;
      let ownerEmail = single ? '' : cell(record, 'ownerEmail').toLowerCase();
      // How the report names the row: its business, else whoever is named.
      const title = businessName || name || '(no name)';
      const label = { name: title, phone: rawPhone };

      if (!businessName) {
        return fail('invalid', row, label.name, label.phone, IMPORT_ERROR.ROW_BUSINESS_NAME);
      }
      if (rawPhone && !phone) {
        return fail('invalid', row, label.name, label.phone, IMPORT_ERROR.ROW_PHONE);
      }
      if (
        (name?.length ?? 0) > BUSINESS_RULE.NAME_MAX_LENGTH ||
        businessName.length > BUSINESS_RULE.BUSINESS_NAME_MAX_LENGTH ||
        (notes?.length ?? 0) > 2000 ||
        ownerEmail.length > MAX_EMAIL
      ) {
        return fail('invalid', row, title, phone ?? '', IMPORT_ERROR.ROW_LONG);
      }

      const typed = cell(record, 'location');
      const location = typed ? this.tryLocation(typed) : defaultLocation;
      if (!location) {
        return fail(
          'invalid',
          row,
          title,
          phone ?? '',
          typed ? LOCATION_ERROR.LENGTH : IMPORT_ERROR.ROW_NO_LOCATION,
        );
      }

      // An owner_email no one on the team has: the lead goes in unassigned, for later.
      if (ownerEmail && !byEmail.has(ownerEmail)) ownerEmail = '';

      const business = businessKey(businessName, location);
      if (phone) {
        const earlier = phonesInFile.get(phone);
        if (earlier !== undefined) {
          return fail('duplicate', row, title, phone, IMPORT_ERROR.ROW_SAME_NUMBER(earlier));
        }
        phonesInFile.set(phone, row);
      } else {
        // No number to match on: the business at that location stands in for it.
        const earlier = businessesInFile.get(business);
        if (earlier !== undefined) {
          return fail('duplicate', row, title, '', IMPORT_ERROR.ROW_SAME_BUSINESS(earlier));
        }
      }
      if (!businessesInFile.has(business)) businessesInFile.set(business, row);
      checked.push({ row, name, phone, businessName, notes, location, owner: null, ownerEmail });
    });

    // ---- numbers (or, with no number, businesses) that are already leads here
    const existing = await this.existingPhones(
      projectId,
      checked.flatMap((r) => (r.phone ? [r.phone] : [])),
    );
    const existingBusinesses = await this.existingBusinesses(
      projectId,
      checked.flatMap((r) => (r.phone ? [] : [businessKey(r.businessName, r.location)])),
    );
    for (const candidate of checked) {
      if (candidate.phone && existing.has(candidate.phone)) {
        const owner = existing.get(candidate.phone);
        fail(
          'duplicate',
          candidate.row,
          candidate.businessName,
          candidate.phone,
          owner ? IMPORT_ERROR.ROW_ALREADY_LEAD(owner) : IMPORT_ERROR.ROW_ALREADY_UNASSIGNED,
        );
        continue;
      }
      const business = businessKey(candidate.businessName, candidate.location);
      if (!candidate.phone && existingBusinesses.has(business)) {
        fail(
          'duplicate',
          candidate.row,
          candidate.businessName,
          '',
          IMPORT_ERROR.ROW_BUSINESS_ALREADY_LEAD(existingBusinesses.get(business) ?? null),
        );
        continue;
      }
      ready.push(candidate);
    }

    // ---- owners: one person for all; else picked on screen, then the file's own column,
    // then the rest shared evenly in file order. Whatever is left is added unassigned, for an
    // admin to hand out later from the campaign's Not assigned leads.
    let turn = 0;
    for (const candidate of ready as Array<ReadyRow & { ownerEmail: string }>) {
      candidate.owner =
        single ??
        assigned.get(candidate.row) ??
        (candidate.ownerEmail
          ? (byEmail.get(candidate.ownerEmail) ?? null)
          : (chosen[turn++ % chosen.length] ?? null));
    }

    const counts = new Map<string, { member: Member; count: number }>();
    for (const r of ready) {
      if (!r.owner) continue;
      const entry = counts.get(r.owner.id) ?? { member: r.owner, count: 0 };
      entry.count += 1;
      counts.set(r.owner.id, entry);
    }

    if (!dryRun && ready.length > 0) await this.insert(actor, projectId, ready);
    const present = (r: ReadyRow): ImportSampleDto => ({
      row: r.row,
      name: r.name,
      phone: r.phone,
      businessName: r.businessName,
      location: r.location,
      owner: r.owner ? { id: r.owner.id, name: r.owner.name } : null,
    });

    problems.sort((a, b) => a.row - b.row);
    const listed = problems.slice(0, BUSINESS_RULE.IMPORT_MAX_PROBLEMS_LISTED);
    return {
      dryRun,
      total: body.length,
      importable: ready.length,
      imported: dryRun ? 0 : ready.length,
      duplicates,
      invalid,
      unassigned: ready.filter((r) => !r.owner).length,
      byOwner: [...counts.values()]
        .sort((a, b) => b.count - a.count || a.member.name.localeCompare(b.member.name))
        .map(({ member, count }) => ({ user: { id: member.id, name: member.name }, count })),
      problems: listed,
      problemsTruncated: problems.length > listed.length,
      sample: ready.slice(0, SAMPLE_SIZE).map(present),
      rows: ready.map(present),
    };
  }

  // ----------------------------------------------------------------- file

  private readFile(file: Express.Multer.File | undefined): string[][] {
    if (!file || file.size === 0) throw this.bad(IMPORT_ERROR.NO_FILE);
    if (file.size > BUSINESS_RULE.IMPORT_MAX_BYTES) throw this.bad(IMPORT_ERROR.TOO_BIG);
    // "PK": an .xlsx renamed to .csv, or a zip.
    if (file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) throw this.bad(IMPORT_ERROR.NOT_CSV);

    let text = file.buffer.toString('utf8');
    // Older Excel saves "CSV" in Windows-1252; reading that as UTF-8 would mangle every accent.
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(file.buffer);

    const records = parseCsv(text);
    if (records.length === 0) throw this.bad(IMPORT_ERROR.EMPTY);
    return records;
  }

  /** Header cell → column index, for the columns the file has. */
  private mapColumns(header: string[]): Partial<Record<Column, number>> {
    const names = header.map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/gu, '_'),
    );
    const found: Partial<Record<Column, number>> = {};
    for (const column of Object.keys(COLUMN_ALIASES) as Column[]) {
      const at = names.findIndex((n) => (COLUMN_ALIASES[column] as readonly string[]).includes(n));
      if (at >= 0) found[column] = at;
    }
    // Only the business is required; a sheet with no phone column adds leads without numbers.
    if (found.businessName === undefined) throw this.bad(IMPORT_ERROR.MISSING_COLUMNS);
    return found;
  }

  private tryLocation(raw: string): string | null {
    try {
      return this.locations.normaliseName(raw);
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- data

  private async activeMembers(projectId: string): Promise<Member[]> {
    const rows = (await this.dataSource.query(
      `SELECT u.id, u.name, lower(u.email) AS email
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id
        WHERE pm.project_id = $1 AND pm.is_active AND u.is_active AND u.role <> 'super_admin'
        ORDER BY u.name, u.id`,
      [projectId],
    )) as Member[];
    return rows;
  }

  /** The people picked on screen, in the order picked; each must be an active member. */
  private chooseOwners(ids: string[], members: Member[]): Member[] {
    const byId = new Map(members.map((member) => [member.id, member]));
    return ids.map((id) => {
      const member = byId.get(id);
      if (!member) throw new BusinessException(IMPORT_ERROR.OWNER_NOT_MEMBER);
      return member;
    });
  }

  /** Row number → member, from the on-screen assignment; each must be an active member. */
  private readAssignments(
    raw: Record<string, string> | undefined,
    members: Member[],
  ): Map<number, Member> {
    const out = new Map<number, Member>();
    if (!raw) return out;
    const byId = new Map(members.map((member) => [member.id, member]));
    for (const [key, id] of Object.entries(raw)) {
      const row = Number(key);
      if (!Number.isInteger(row) || row < 2 || typeof id !== 'string') {
        throw this.bad(IMPORT_ERROR.ASSIGNMENTS_INVALID);
      }
      const member = byId.get(id);
      if (!member) throw new BusinessException(IMPORT_ERROR.OWNER_NOT_MEMBER);
      out.set(row, member);
    }
    return out;
  }

  /** Phone → who owns it there; null for a lead still waiting to be assigned. */
  private async existingPhones(
    projectId: string,
    phones: string[],
  ): Promise<Map<string, string | null>> {
    if (phones.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT l.phone, u.name AS owner
         FROM ${SQL_TABLE.LEADS} l
         LEFT JOIN ${SQL_TABLE.USERS} u ON u.id = l.owner_id
        WHERE l.project_id = $1 AND l.deleted_at IS NULL AND l.phone = ANY($2::text[])`,
      [projectId, phones],
    )) as Array<{ phone: string; owner: string | null }>;
    return new Map(rows.map((row) => [row.phone, row.owner]));
  }

  /**
   * Business key (see businessKey) → who owns it there; null for a lead still waiting to be
   * assigned. Any lead counts, with or without a number: a row with no phone naming a business
   * already listed at that location is the same client.
   */
  private async existingBusinesses(
    projectId: string,
    keys: string[],
  ): Promise<Map<string, string | null>> {
    if (keys.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT k.key, u.name AS owner
         FROM ${SQL_TABLE.LEADS} l
         JOIN ${SQL_TABLE.LOCATIONS} loc ON loc.id = l.location_id
         LEFT JOIN ${SQL_TABLE.USERS} u ON u.id = l.owner_id
        CROSS JOIN LATERAL (
          SELECT lower(regexp_replace(btrim(l.business_name), '\\s+', ' ', 'g'))
                 || E'\\n' || lower(loc.name) AS key
        ) k
        WHERE l.project_id = $1 AND l.deleted_at IS NULL AND l.business_name IS NOT NULL
          AND k.key = ANY($2::text[])`,
      [projectId, [...new Set(keys)]],
    )) as Array<{ key: string; owner: string | null }>;
    return new Map(rows.map((row) => [row.key, row.owner]));
  }

  private async insert(
    actor: AuthenticatedUser,
    projectId: string,
    rows: ReadyRow[],
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, projectId);
        const now = new Date();

        const locationIds = new Map<string, string>();
        for (const row of rows) {
          const key = row.location.toLowerCase();
          if (!locationIds.has(key)) {
            locationIds.set(
              key,
              (await this.locations.findOrCreate(manager, projectId, row.location, actor.id)).id,
            );
          }
        }

        const leads = rows.map((row) => ({
          id: randomUUID(),
          projectId,
          ownerId: row.owner?.id ?? null,
          name: row.name,
          businessName: row.businessName,
          phone: row.phone,
          locationId: locationIds.get(row.location.toLowerCase())!,
          notes: row.notes,
          status: LeadStatus.NEW,
          nextFollowUpDate: null,
          source: LeadSource.IMPORT,
          createdBy: actor.id,
          lastActivityAt: now,
        }));
        for (let i = 0; i < leads.length; i += INSERT_CHUNK) {
          await manager.insert(Lead, leads.slice(i, i + INSERT_CHUNK));
        }
      });
    } catch (error) {
      // Someone added one of these numbers between the check and the insert; nothing was saved.
      if (isUniqueViolation(error, DB_CONSTRAINT.LEADS_PROJECT_PHONE)) {
        throw new ConflictBusinessException(IMPORT_ERROR.RACE);
      }
      throw error;
    }
  }

  private bad(message: string): BusinessException {
    return new BusinessException(message, ERROR_CODE.VALIDATION_FAILED);
  }
}
