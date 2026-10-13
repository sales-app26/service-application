import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { BUSINESS_RULE, SQL_TABLE } from '../../common/constants';
import { CommentKind } from '../../common/enums';
import { isSameIstDay } from '../../common/utils';
import { FollowUp } from '../../database/entities';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { EntryDto, EntryFeedbackDto, PersonRefDto } from './dto/entry.dto';

interface FeedbackRow {
  id: string;
  entry_id: string;
  body: string;
  user_id: string;
  user_name: string;
  created_at: Date;
}

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
 * one request to storage, not fifty. Who a backup was covering for, and the
 * feedback admins left on each entry, are two more queries per call.
 *
 * Whoever may see an entry may see the feedback on it: it is about that entry.
 */
@Injectable()
export class EntryPresenter {
  constructor(
    private readonly storage: SupabaseStorageClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async present(entries: FollowUp[], context: EntryPresentationContext): Promise<EntryDto[]> {
    if (entries.length === 0) return [];
    const now = context.now ?? new Date();
    const [urls, coveredFor, feedback] = await Promise.all([
      context.withPhotoUrls === false
        ? Promise.resolve(new Map<string, string | null>())
        : this.storage.signedUrls(entries.map((entry) => entry.photoPath ?? '').filter(Boolean)),
      this.people(entries.map((entry) => entry.coveringForId)),
      this.feedback(entries.map((entry) => entry.id)),
    ]);

    return entries.map((entry) => ({
      id: entry.id,
      leadId: entry.leadId,
      projectId: entry.projectId,
      entryType: entry.entryType,
      status: entry.status,
      note: entry.note,
      reason: entry.reason,
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
      coveringFor: entry.coveringForId ? (coveredFor.get(entry.coveringForId) ?? null) : null,
      feedback: feedback.get(entry.id) ?? [],
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      edited: entry.updatedAt.getTime() > entry.createdAt.getTime(),
      editable:
        entry.userId === context.viewerId &&
        context.isProjectOpen(entry.projectId) &&
        isSameIstDay(entry.createdAt, now),
    }));
  }

  private async people(ids: Array<string | null>): Promise<Map<string, PersonRefDto>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = (await this.dataSource.query(
      `SELECT id, name FROM ${SQL_TABLE.USERS} WHERE id = ANY($1::uuid[])`,
      [unique],
    )) as PersonRefDto[];
    return new Map(rows.map((row) => [row.id, { id: row.id, name: row.name }]));
  }

  /** Feedback comments on these entries, oldest first. */
  private async feedback(entryIds: string[]): Promise<Map<string, EntryFeedbackDto[]>> {
    const rows = (await this.dataSource.query(
      `SELECT c.id, c.entry_id, c.body, c.user_id, u.name AS user_name, c.created_at
         FROM ${SQL_TABLE.LEAD_COMMENTS} c
         JOIN ${SQL_TABLE.USERS} u ON u.id = c.user_id
        WHERE c.entry_id = ANY($1::uuid[]) AND c.kind = $2 AND c.deleted_at IS NULL
        ORDER BY c.created_at, c.id`,
      [entryIds, CommentKind.FEEDBACK],
    )) as FeedbackRow[];

    const byEntry = new Map<string, EntryFeedbackDto[]>();
    for (const row of rows) {
      const list = byEntry.get(row.entry_id) ?? [];
      list.push({
        id: row.id,
        body: row.body,
        user: { id: row.user_id, name: row.user_name },
        createdAt: row.created_at,
      });
      byEntry.set(row.entry_id, list);
    }
    return byEntry;
  }
}
