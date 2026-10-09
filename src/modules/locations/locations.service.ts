import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { BUSINESS_RULE, ERROR_CODE, LOCATION_ERROR, SQL_TABLE } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { BusinessException } from '../../common/exceptions/business.exception';
import { collapseWhitespace, escapeLike } from '../../common/utils';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationSuggestionDto } from './dto/location.dto';

export interface ResolvedLocation {
  id: string;
  name: string;
}

/**
 * The per-project location list behind the autocomplete (PRD §5.8).
 *
 * Free text: picking a suggestion and typing the same words resolve to the
 * same row, so the API takes the name and never needs a location id. A new
 * name is added only when the lead or follow-up that uses it is saved.
 */
@Injectable()
export class LocationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
  ) {}

  /** Trimmed, inner spaces collapsed, 2–100 characters. Throws otherwise. */
  normaliseName(raw: string): string {
    const name = collapseWhitespace(raw ?? '');
    if (
      name.length < BUSINESS_RULE.LOCATION_MIN_LENGTH ||
      name.length > BUSINESS_RULE.LOCATION_MAX_LENGTH
    ) {
      throw new BusinessException(LOCATION_ERROR.LENGTH, ERROR_CODE.VALIDATION_FAILED);
    }
    return name;
  }

  /**
   * Up to 10 matches, names that start with the text first, then the most
   * used. An empty query returns the most used places in the project.
   */
  async suggest(
    actor: AuthenticatedUser,
    projectId: string,
    query?: string,
  ): Promise<LocationSuggestionDto[]> {
    await this.access.assertCanView(actor, projectId);

    const term = collapseWhitespace(query ?? '').toLowerCase();
    const escaped = escapeLike(term);

    const rows = (await this.dataSource.query(
      `SELECT l.id, l.name,
              ((SELECT count(*) FROM ${SQL_TABLE.FOLLOW_UPS} f WHERE f.location_id = l.id AND f.deleted_at IS NULL)
             + (SELECT count(*) FROM ${SQL_TABLE.LEADS} ld WHERE ld.location_id = l.id AND ld.deleted_at IS NULL))::int AS usage
         FROM ${SQL_TABLE.LOCATIONS} l
        WHERE l.project_id = $1
          AND ($2 = '' OR lower(l.name) LIKE '%' || $2 || '%')
        ORDER BY (lower(l.name) LIKE $2 || '%') DESC, usage DESC, lower(l.name) ASC
        LIMIT $3`,
      [projectId, escaped, BUSINESS_RULE.LOCATION_SUGGESTION_LIMIT],
    )) as Array<{ id: string; name: string; usage: number }>;

    return rows.map((row) => ({ id: row.id, name: row.name, usageCount: row.usage }));
  }

  /**
   * The location row for a name, created if new — inside the caller's
   * transaction, so an unsaved form adds nothing. "wanowrie" finds
   * "Wanowrie": the first spelling saved is kept.
   */
  async findOrCreate(
    manager: EntityManager,
    projectId: string,
    rawName: string,
    userId: string,
  ): Promise<ResolvedLocation> {
    const name = this.normaliseName(rawName);

    const inserted = (await manager.query(
      `INSERT INTO ${SQL_TABLE.LOCATIONS} (project_id, name, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, lower(name)) DO NOTHING
       RETURNING id, name`,
      [projectId, name, userId],
    )) as ResolvedLocation[];

    if (inserted.length > 0) {
      return inserted[0];
    }

    const [existing] = (await manager.query(
      `SELECT id, name FROM ${SQL_TABLE.LOCATIONS} WHERE project_id = $1 AND lower(name) = lower($2)`,
      [projectId, name],
    )) as ResolvedLocation[];
    return existing;
  }
}
