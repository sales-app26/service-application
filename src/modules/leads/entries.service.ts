import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import {
  CONFIG_NAMESPACE,
  DB_CONSTRAINT,
  ERROR_CODE,
  FOLLOW_UP_ERROR,
  VISIT_ERROR,
} from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { EntryType, ProjectStatus } from '../../common/enums';
import {
  BusinessException,
  ConflictBusinessException,
  ForbiddenBusinessException,
  IntegrationException,
  NotFoundBusinessException,
} from '../../common/exceptions/business.exception';
import { isSameIstDay, isUniqueViolation, istToday } from '../../common/utils';
import { VisitConfig } from '../../config/configuration';
import { FollowUp, Lead } from '../../database/entities';
import { ProjectAccessService } from '../access/project-access.service';
import { LocationsService } from '../locations/locations.service';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { PhotoUrlDto } from '../visits/dto/visit.dto';
import { StoredVisitProof, VisitProofService } from '../visits/visit-proof.service';
import { ChangeStatusDto, EditEntryDto, EntryDto, LogFollowUpDto } from './dto/entry.dto';
import { EntrySaveResultDto } from './dto/entry-result.dto';
import { EntryPresenter } from './entry.presenter';
import { LeadAccessService } from './lead-access.service';
import {
  assertFollowUpStatus,
  assertManualStatusChange,
  conversionAfter,
  resolveNextFollowUpDate,
} from './lead-rules';
import { LeadStateService } from './lead-state.service';
import { LeadPresenter } from './lead.presenter';

interface UploadedPhoto {
  buffer: Buffer;
}

/**
 * The lead history (PRD §5.6, §5.7, §5.9, §5.11).
 *
 * Every save writes a new `follow_ups` row and moves the lead's current state
 * in the same transaction, under a row lock on the lead — so two saves on one
 * lead apply in order, a transfer approved meanwhile is noticed, and a closed
 * project is noticed. Status, photo, GPS and time are never edited after
 * saving; only the note and next date, by the author, on the same IST day.
 */
@Injectable()
export class EntriesService {
  private readonly signedUrlTtlSeconds: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(FollowUp) private readonly followUps: Repository<FollowUp>,
    private readonly access: ProjectAccessService,
    private readonly leadAccess: LeadAccessService,
    private readonly locations: LocationsService,
    private readonly visitProof: VisitProofService,
    private readonly leadState: LeadStateService,
    private readonly entryPresenter: EntryPresenter,
    private readonly leadPresenter: LeadPresenter,
    private readonly storage: SupabaseStorageClient,
    configService: ConfigService,
  ) {
    this.signedUrlTtlSeconds = configService.getOrThrow<VisitConfig>(
      CONFIG_NAMESPACE.VISIT,
    ).signedUrlTtlSeconds;
  }

  // ---------------------------------------------------------------- follow-up

  /** PRD §7.2. Only the owner logs; in a door-to-door project, with visit proof. */
  async logFollowUp(
    actor: AuthenticatedUser,
    leadId: string,
    dto: LogFollowUpDto,
    photo?: UploadedPhoto,
  ): Promise<EntrySaveResultDto> {
    const replay = await this.replayFor(dto.clientRequestId, actor, leadId);
    if (replay) return replay;

    const lead = await this.leadAccess.findLiveLead(leadId);
    await this.assertOwnerAtWork(actor, lead);
    this.access.assertWritable(lead.project);
    assertFollowUpStatus(lead.status, dto.status);

    const now = new Date();
    const nextFollowUpDate = resolveNextFollowUpDate(
      dto.status,
      dto.nextFollowUpDate,
      istToday(now),
    );
    const locationName = this.locations.normaliseName(dto.location);
    const needsProof = this.visitProof.requiresProof(lead.project.type);
    const proofInput = { ...dto, photo };
    if (needsProof) {
      this.visitProof.validate(proofInput, actor, now);
    }

    const entryId = randomUUID();
    let proof: StoredVisitProof | null = null;

    try {
      if (needsProof) {
        proof = await this.visitProof.store(proofInput, {
          projectId: lead.projectId,
          entryId,
          createdAt: now,
          personName: actor.name,
        });
      }

      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, lead.projectId);
        const locked = await this.leadAccess.lockLead(manager, leadId);

        // The form may have been open while the lead was transferred away.
        if (locked.ownerId !== actor.id) {
          throw await this.leadAccess.notYoursError(actor, locked, manager);
        }
        if (!(await this.access.isActiveMember(locked.projectId, actor.id, manager))) {
          throw new NotFoundBusinessException(FOLLOW_UP_ERROR.NOT_FOUND);
        }
        // Re-checked against the locked row: an admin may have changed it.
        assertFollowUpStatus(locked.status, dto.status);

        const location = await this.locations.findOrCreate(
          manager,
          locked.projectId,
          locationName,
          actor.id,
        );

        await manager.insert(FollowUp, {
          id: entryId,
          leadId,
          projectId: locked.projectId,
          userId: actor.id,
          entryType: EntryType.FOLLOW_UP,
          status: dto.status,
          note: dto.note,
          nextFollowUpDate,
          locationId: location.id,
          photoPath: proof?.photoPath ?? null,
          latitude: proof?.latitude ?? null,
          longitude: proof?.longitude ?? null,
          gpsAccuracyM: proof?.gpsAccuracyM ?? null,
          clientRequestId: dto.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });

        await manager.update(
          Lead,
          { id: leadId },
          { status: dto.status, nextFollowUpDate, ...conversionAfter(locked, dto.status, now) },
        );
      });
    } catch (error) {
      await this.visitProof.discard(proof);
      if (isUniqueViolation(error, DB_CONSTRAINT.FOLLOW_UPS_CLIENT_REQUEST)) {
        const saved = await this.replayFor(dto.clientRequestId, actor, leadId);
        if (saved) return saved;
      }
      throw error;
    }

    return this.result(actor, entryId);
  }

  // ------------------------------------------------------------ status change

  /**
   * PRD §5.9. The owner or an admin changes the status by hand, with a reason.
   * Saved as a `status_change` entry with who and when; never asks for a
   * photo, even in a door-to-door project, because it is not a visit.
   */
  async changeStatus(
    actor: AuthenticatedUser,
    leadId: string,
    dto: ChangeStatusDto,
  ): Promise<EntrySaveResultDto> {
    const replay = await this.replayFor(dto.clientRequestId, actor, leadId);
    if (replay) return replay;

    const lead = await this.leadAccess.findLiveLead(leadId);
    const visibility = await this.leadAccess.assertVisible(actor, lead);
    this.access.assertWritable(lead.project);
    // Fail fast on the obvious; re-checked under the lock below.
    assertManualStatusChange(lead.status, dto.status, visibility.isAdmin);

    const now = new Date();
    const nextFollowUpDate = resolveNextFollowUpDate(
      dto.status,
      dto.nextFollowUpDate,
      istToday(now),
    );
    const entryId = randomUUID();

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.access.lockOpenProject(manager, lead.projectId);
        const locked = await this.leadAccess.lockLead(manager, leadId);

        if (!visibility.isAdmin && locked.ownerId !== actor.id) {
          throw await this.leadAccess.notYoursError(actor, locked, manager);
        }
        assertManualStatusChange(locked.status, dto.status, visibility.isAdmin);

        await manager.insert(FollowUp, {
          id: entryId,
          leadId,
          projectId: locked.projectId,
          userId: actor.id,
          entryType: EntryType.STATUS_CHANGE,
          status: dto.status,
          note: dto.note,
          nextFollowUpDate,
          locationId: null,
          clientRequestId: dto.clientRequestId,
          createdAt: now,
          updatedAt: now,
        });

        // Credit goes to the owner, never to an admin who set it by hand;
        // leaving Converted clears it and the target count drops.
        await manager.update(
          Lead,
          { id: leadId },
          { status: dto.status, nextFollowUpDate, ...conversionAfter(locked, dto.status, now) },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, DB_CONSTRAINT.FOLLOW_UPS_CLIENT_REQUEST)) {
        const saved = await this.replayFor(dto.clientRequestId, actor, leadId);
        if (saved) return saved;
      }
      throw error;
    }

    return this.result(actor, entryId);
  }

  // --------------------------------------------------------------------- edit

  /**
   * PRD §5.11: the author edits the note and next date until midnight India
   * time — not 24 hours later. Status changes allow the note only.
   */
  async edit(
    actor: AuthenticatedUser,
    entryId: string,
    dto: EditEntryDto,
  ): Promise<EntrySaveResultDto> {
    if (dto.note === undefined && dto.nextFollowUpDate === undefined) {
      throw new BusinessException(FOLLOW_UP_ERROR.NOTHING_TO_UPDATE, ERROR_CODE.VALIDATION_FAILED);
    }

    const entry = await this.findLiveEntry(entryId);
    if (entry.userId !== actor.id) {
      if (await this.access.isAdminOf(actor, entry.projectId)) {
        throw new ForbiddenBusinessException(FOLLOW_UP_ERROR.ONLY_AUTHOR_EDITS);
      }
      throw new NotFoundBusinessException(FOLLOW_UP_ERROR.NOT_FOUND);
    }

    const now = new Date();
    if (!isSameIstDay(entry.createdAt, now)) {
      throw new BusinessException(FOLLOW_UP_ERROR.LOCKED, ERROR_CODE.ENTRY_LOCKED);
    }
    this.access.assertWritable(entry.project);

    if (entry.entryType === EntryType.STATUS_CHANGE && dto.nextFollowUpDate !== undefined) {
      throw new BusinessException(
        FOLLOW_UP_ERROR.STATUS_CHANGE_NOTE_ONLY,
        ERROR_CODE.UNPROCESSABLE,
      );
    }

    const nextFollowUpDate =
      dto.nextFollowUpDate !== undefined
        ? resolveNextFollowUpDate(entry.status, dto.nextFollowUpDate, istToday(now))
        : undefined;

    await this.dataSource.transaction(async (manager) => {
      await this.access.lockOpenProject(manager, entry.projectId);
      const lead = await this.leadAccess.lockLead(manager, entry.leadId);

      if (nextFollowUpDate !== undefined && lead.ownerId !== actor.id) {
        throw new ForbiddenBusinessException(FOLLOW_UP_ERROR.NEXT_DATE_NOT_OWNER);
      }

      const changes: Partial<FollowUp> = {};
      if (dto.note !== undefined) changes.note = dto.note;
      if (nextFollowUpDate !== undefined) changes.nextFollowUpDate = nextFollowUpDate;
      await manager.update(FollowUp, { id: entry.id }, changes);

      // An older entry's date is history; only the latest drives Due today.
      if (nextFollowUpDate !== undefined) {
        const latest = await manager.getRepository(FollowUp).findOne({
          where: { leadId: lead.id, deletedAt: IsNull() },
          order: { createdAt: 'DESC', id: 'DESC' },
        });
        if (latest?.id === entry.id) {
          await manager.update(Lead, { id: lead.id }, { nextFollowUpDate });
        }
      }
    });

    return this.result(actor, entry.id);
  }

  // ------------------------------------------------------------------- delete

  /**
   * Super Admin only (Assumption 7). Hidden from timelines and counts; the
   * lead's state falls back to what the remaining history says.
   */
  async remove(entryId: string): Promise<void> {
    const entry = await this.findLiveEntry(entryId);

    await this.dataSource.transaction(async (manager) => {
      const lead = await this.leadAccess.lockLead(manager, entry.leadId, { includeDeleted: true });
      await manager.update(
        FollowUp,
        { id: entry.id, deletedAt: IsNull() },
        { deletedAt: new Date() },
      );
      await this.leadState.recompute(manager, lead);
    });
  }

  // -------------------------------------------------------------------- reads

  /** One entry — the target of the photo link in a CSV export. */
  async findOne(actor: AuthenticatedUser, entryId: string): Promise<EntryDto> {
    const entry = await this.findViewableEntry(actor, entryId);
    const [dto] = await this.entryPresenter.present([entry], {
      viewerId: actor.id,
      isProjectOpen: () => entry.project.status === ProjectStatus.ACTIVE,
    });
    return dto;
  }

  /**
   * PRD §5.7: photos are private. A fresh short-lived link for the person who
   * logged the entry, the lead's owner, or an admin of the project.
   */
  async photoUrl(actor: AuthenticatedUser, entryId: string): Promise<PhotoUrlDto> {
    const entry = await this.findViewableEntry(actor, entryId);
    if (!entry.photoPath) {
      throw new NotFoundBusinessException(VISIT_ERROR.NO_PHOTO);
    }

    const url = await this.storage.signedUrl(entry.photoPath);
    if (!url) {
      throw new IntegrationException(VISIT_ERROR.STORAGE_UNAVAILABLE);
    }
    return { url, expiresInSeconds: this.signedUrlTtlSeconds };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Only the owner logs a follow-up — not an admin, even one who can read the
   * lead (PRD §5.5) — and only while still a member of the project.
   */
  private async assertOwnerAtWork(actor: AuthenticatedUser, lead: Lead): Promise<void> {
    const visibility = await this.leadAccess.visibility(actor, lead);

    if (visibility.isOwner && visibility.isMember) return;
    if (visibility.isAdmin) {
      throw new ForbiddenBusinessException(FOLLOW_UP_ERROR.ONLY_OWNER_LOGS);
    }
    throw await this.leadAccess.notYoursError(actor, lead);
  }

  private async replayFor(
    clientRequestId: string,
    actor: AuthenticatedUser,
    leadId: string,
  ): Promise<EntrySaveResultDto | null> {
    const existing = await this.leadAccess.findReplay(clientRequestId, actor.id);
    if (!existing) return null;
    if (existing.leadId !== leadId) {
      throw new ConflictBusinessException(FOLLOW_UP_ERROR.CLIENT_REQUEST_REUSED);
    }
    return this.result(actor, existing.id);
  }

  private async findLiveEntry(entryId: string): Promise<FollowUp> {
    const entry = await this.followUps.findOne({
      where: { id: entryId, deletedAt: IsNull() },
      relations: { project: true, user: true, location: true, lead: true },
    });
    if (!entry || entry.lead.deletedAt) {
      throw new NotFoundBusinessException(FOLLOW_UP_ERROR.NOT_FOUND);
    }
    return entry;
  }

  private async findViewableEntry(actor: AuthenticatedUser, entryId: string): Promise<FollowUp> {
    const entry = await this.findLiveEntry(entryId);
    const allowed =
      entry.userId === actor.id ||
      (entry.lead.ownerId === actor.id &&
        (await this.access.isActiveMember(entry.projectId, actor.id))) ||
      (await this.access.isAdminOf(actor, entry.projectId));

    if (!allowed) {
      throw new NotFoundBusinessException(FOLLOW_UP_ERROR.NOT_FOUND);
    }
    return entry;
  }

  /** The saved entry and the lead it moved, for the screen to refresh from. */
  private async result(actor: AuthenticatedUser, entryId: string): Promise<EntrySaveResultDto> {
    const entry = await this.followUps.findOneOrFail({
      where: { id: entryId },
      relations: {
        user: true,
        location: true,
        project: true,
        lead: { owner: true, location: true },
      },
    });

    const isAdmin = await this.access.isAdminOf(actor, entry.projectId);
    const [entryDto] = await this.entryPresenter.present([entry], {
      viewerId: actor.id,
      isProjectOpen: () => entry.project.status === ProjectStatus.ACTIVE,
    });
    const [lead] = await this.leadPresenter.summaries([entry.lead], { showOwnerTags: isAdmin });

    return { entry: entryDto, lead };
  }
}
