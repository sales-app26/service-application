import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  DB_CONSTRAINT,
  ERROR_CODE,
  LEAD_ERROR,
  NOTIFICATION_LINK,
  NOTIFICATION_TEXT,
  SQL_TABLE,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { LeadStatus, NotificationKind, UserRole } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  collapseWhitespace,
  isUniqueViolation,
  leadLabel,
  normaliseIndianMobile,
} from '../../common/utils';
import { Lead } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationsService } from '../locations/locations.service';
import { NotificationSenderService } from '../notifications/notification-sender.service';
import { AddTeamLeadDto, LeadDetailDto } from './dto/lead.dto';
import { LeadsService } from './leads.service';

/**
 * The Super Admin adds one lead by hand, as one row of a bulk upload would be: New, with no
 * follow-up and no visit photo, because nobody has visited or contacted the client yet. It goes
 * to a team member, or stays unassigned for an admin to hand out or a rep to take.
 */
@Injectable()
export class AdminLeadsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly locations: LocationsService,
    private readonly notifications: NotificationSenderService,
    private readonly leads: LeadsService,
  ) {}

  async add(
    actor: AuthenticatedUser,
    projectId: string,
    dto: AddTeamLeadDto,
  ): Promise<LeadDetailDto> {
    const project = await this.access.assertAdmin(actor, projectId);
    this.access.assertWritable(project);

    const phone = dto.phone ? normaliseIndianMobile(dto.phone) : null;
    if (dto.phone && !phone) {
      throw new BusinessException(LEAD_ERROR.INVALID_PHONE, ERROR_CODE.VALIDATION_FAILED);
    }
    const location = this.locations.normaliseName(dto.location);
    const businessName = collapseWhitespace(dto.businessName);
    const ownerId = dto.ownerId ?? null;
    if (ownerId && !(await this.canOwn(projectId, ownerId))) {
      throw new BusinessException(LEAD_ERROR.OWNER_NOT_ON_TEAM, ERROR_CODE.VALIDATION_FAILED);
    }
    await this.assertNotListed(projectId, phone, businessName, location);

    const leadId = randomUUID();
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, projectId);
        const { id: locationId } = await this.locations.findOrCreate(
          manager,
          projectId,
          location,
          actor.id,
        );
        const lead = {
          id: leadId,
          projectId,
          ownerId,
          name: dto.name ?? null,
          businessName,
          phone,
          locationId,
          notes: dto.notes ?? null,
          status: LeadStatus.NEW,
          nextFollowUpDate: null,
          source: dto.source ?? null,
          createdBy: actor.id,
          lastActivityAt: new Date(),
        };
        await manager.insert(Lead, lead);
        if (ownerId) await this.notifyOwner(manager, actor, ownerId, lead);
      });
    } catch (error) {
      // Someone added this number between the check and the insert.
      if (isUniqueViolation(error, DB_CONSTRAINT.LEADS_PROJECT_PHONE)) {
        await this.assertNotListed(projectId, phone, businessName, location);
      }
      throw error;
    }

    return this.leads.findDetail(actor, leadId);
  }

  private async canOwn(projectId: string, userId: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1
         FROM ${SQL_TABLE.PROJECT_MEMBERS} pm
         JOIN ${SQL_TABLE.USERS} u ON u.id = pm.user_id
        WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.is_active
          AND u.is_active AND u.role <> $3`,
      [projectId, userId, UserRole.SUPER_ADMIN],
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * The same rule as a bulk upload: a number can be one lead per campaign, and with no number
   * the business at that location stands in for it. `details.leadId` lets the screen open it.
   */
  private async assertNotListed(
    projectId: string,
    phone: string | null,
    businessName: string,
    location: string,
  ): Promise<void> {
    const [existing] = (
      phone
        ? await this.dataSource.query(
            `SELECT l.id, u.name AS owner
               FROM ${SQL_TABLE.LEADS} l
               LEFT JOIN ${SQL_TABLE.USERS} u ON u.id = l.owner_id
              WHERE l.project_id = $1 AND l.deleted_at IS NULL AND l.phone = $2`,
            [projectId, phone],
          )
        : await this.dataSource.query(
            `SELECT l.id, u.name AS owner
               FROM ${SQL_TABLE.LEADS} l
               JOIN ${SQL_TABLE.LOCATIONS} loc ON loc.id = l.location_id
               LEFT JOIN ${SQL_TABLE.USERS} u ON u.id = l.owner_id
              WHERE l.project_id = $1 AND l.deleted_at IS NULL
                AND lower(regexp_replace(btrim(l.business_name), '\\s+', ' ', 'g')) = lower($2)
                AND lower(loc.name) = lower($3)`,
            [projectId, businessName, location],
          )
    ) as Array<{ id: string; owner: string | null }>;
    if (!existing) return;

    const message = phone
      ? existing.owner
        ? LEAD_ERROR.DUPLICATE_OTHER(existing.owner)
        : LEAD_ERROR.DUPLICATE_NOT_ASSIGNED
      : LEAD_ERROR.DUPLICATE_BUSINESS;
    throw new BusinessException(message, ERROR_CODE.DUPLICATE_LEAD_OTHER, {
      leadId: existing.id,
      ownerName: existing.owner,
    });
  }

  private async notifyOwner(
    manager: EntityManager,
    actor: AuthenticatedUser,
    ownerId: string,
    lead: Pick<Lead, 'id' | 'name' | 'businessName'>,
  ): Promise<void> {
    await this.notifications.send(manager, actor.id, [
      {
        userId: ownerId,
        kind: NotificationKind.LEAD_ASSIGNED,
        title: NOTIFICATION_TEXT.LEAD_ASSIGNED_TITLE(actor.name, leadLabel(lead)),
        body: null,
        link: NOTIFICATION_LINK.LEAD(lead.id),
        leadId: lead.id,
      },
    ]);
  }
}
