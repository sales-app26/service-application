import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import {
  CALL_ERROR,
  CONFIG_NAMESPACE,
  DB_CONSTRAINT,
  ERROR_CODE,
  SQL_TABLE,
} from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { isUniqueViolation } from '../../common/utils';
import { SupabaseConfig } from '../../config/configuration';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { RecordingFormat, sniffRecordingFormat } from './recording-format';

export interface UploadedRecording {
  buffer: Buffer;
}

export interface PreparedRecording {
  buffer: Buffer;
  format: RecordingFormat;
  sha256: string;
}

export interface StoredRecording {
  recordingPath: string;
  recordingSha256: string;
}

/**
 * The recording that proves a call that connected, as the photo proves a visit: `prepare` runs
 * before anything is written, `store` uploads, and `discard` removes it again if the entry then
 * fails to save.
 *
 * Recordings hold customers' voices, so they get their own private bucket and are only ever
 * reached through a short-lived link, after the API has checked who is asking.
 */
@Injectable()
export class CallRecordingService {
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(
    configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: SupabaseStorageClient,
  ) {
    this.bucket = configService.getOrThrow<SupabaseConfig>(
      CONFIG_NAMESPACE.SUPABASE,
    ).recordingsBucket;
  }

  async prepare(file: UploadedRecording | undefined): Promise<PreparedRecording> {
    if (!file?.buffer?.length) {
      throw new BusinessException(
        CALL_ERROR.RECORDING_REQUIRED,
        ERROR_CODE.CALL_RECORDING_REQUIRED,
      );
    }
    const format = sniffRecordingFormat(file.buffer);
    if (!format) {
      throw new BusinessException(CALL_ERROR.RECORDING_NOT_AUDIO, ERROR_CODE.UNPROCESSABLE);
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const used = (await this.dataSource.query(
      `SELECT 1 FROM ${SQL_TABLE.FOLLOW_UPS} WHERE recording_sha256 = $1`,
      [sha256],
    )) as unknown[];
    if (used.length > 0) throw this.usedError();
    return { buffer: file.buffer, format, sha256 };
  }

  async store(
    recording: PreparedRecording,
    place: { projectId: string; entryId: string },
  ): Promise<StoredRecording> {
    this.bucketReady ??= this.storage.ensurePrivateBucket(this.bucket).catch((error: unknown) => {
      this.bucketReady = undefined; // try again next time
      throw error;
    });
    await this.bucketReady;

    const path = `calls/${place.projectId}/${place.entryId}.${recording.format.extension}`;
    await this.storage.upload(path, recording.buffer, recording.format.mimeType, this.bucket);
    return { recordingPath: path, recordingSha256: recording.sha256 };
  }

  async discard(stored: StoredRecording | null): Promise<void> {
    if (stored) await this.remove([stored.recordingPath]);
  }

  remove(paths: string[]): Promise<void> {
    return this.storage.removeObjects(paths, this.bucket);
  }

  signedUrl(path: string): Promise<string | null> {
    return this.storage.signedUrl(path, this.bucket);
  }

  isReuse(error: unknown): boolean {
    return isUniqueViolation(error, DB_CONSTRAINT.FOLLOW_UPS_RECORDING);
  }

  usedError(): BusinessException {
    return new BusinessException(CALL_ERROR.RECORDING_USED, ERROR_CODE.CONFLICT);
  }
}
