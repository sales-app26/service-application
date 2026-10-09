import { Injectable } from '@nestjs/common';

import { BUSINESS_RULE } from '../../common/constants';
import { isSameIstDay } from '../../common/utils';
import { FollowUp } from '../../database/entities';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { EntryDto } from './dto/entry.dto';

export interface EntryPresentationContext {
  viewerId: string;
  /** Projects still open; an entry in a closed project is never editable. */
  isProjectOpen: (projectId: string) => boolean;
  /** Skip signing photo URLs, e.g. for an export that links to the app instead. */
  withPhotoUrls?: boolean;
  now?: Date;
}

/**
 * Turns `follow_ups` rows into what every screen shows: the history on a
 * lead, the daily timeline, the result of a save. Rows must be loaded with
 * their `user` and `location` relations.
 *
 * Photo links are signed in one batch per call, so a day of fifty visits is
 * one request to storage, not fifty.
 */
@Injectable()
export class EntryPresenter {
  constructor(private readonly storage: SupabaseStorageClient) {}

  async present(entries: FollowUp[], context: EntryPresentationContext): Promise<EntryDto[]> {
    const now = context.now ?? new Date();
    const urls =
      context.withPhotoUrls === false
        ? new Map<string, string | null>()
        : await this.storage.signedUrls(
            entries.map((entry) => entry.photoPath ?? '').filter(Boolean),
          );

    return entries.map((entry) => ({
      id: entry.id,
      leadId: entry.leadId,
      projectId: entry.projectId,
      entryType: entry.entryType,
      status: entry.status,
      note: entry.note,
      nextFollowUpDate: entry.nextFollowUpDate,
      location: entry.location ? { id: entry.location.id, name: entry.location.name } : null,
      hasPhoto: entry.photoPath !== null,
      photoUrl: entry.photoPath ? (urls.get(entry.photoPath) ?? null) : null,
      latitude: entry.latitude,
      longitude: entry.longitude,
      gpsAccuracyM: entry.gpsAccuracyM,
      lowAccuracy:
        entry.gpsAccuracyM !== null && entry.gpsAccuracyM > BUSINESS_RULE.LOW_ACCURACY_METRES,
      user: { id: entry.user.id, name: entry.user.name },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      edited: entry.updatedAt.getTime() > entry.createdAt.getTime(),
      editable:
        entry.userId === context.viewerId &&
        context.isProjectOpen(entry.projectId) &&
        isSameIstDay(entry.createdAt, now),
    }));
  }
}
