import { Injectable } from '@nestjs/common';

import { ERROR_CODE, STORAGE_FOLDER, VISIT_ERROR } from '../../common/constants';
import { AuthenticatedUser } from '../../common/decorators';
import { ProjectType } from '../../common/enums';
import { BusinessException } from '../../common/exceptions/business.exception';
import { formatIstStamp, istDateOf } from '../../common/utils';
import { ImageService } from '../media/image.service';
import { SupabaseStorageClient } from '../supabase/supabase-storage.client';
import { CaptureTokenService } from './capture-token.service';

/** What the form sends for a visit. Every field is optional at the DTO level. */
export interface VisitProofInput {
  photo?: { buffer: Buffer };
  latitude?: number;
  longitude?: number;
  gpsAccuracyM?: number;
  captureToken?: string;
}

/** The stored proof, ready to write onto the entry. */
export interface StoredVisitProof {
  photoPath: string;
  latitude: number;
  longitude: number;
  gpsAccuracyM: number;
}

/**
 * Visit proof for door-to-door follow-ups (BRD §4, PRD §5.7).
 *
 * `validate` runs before anything is written; `store` stamps and uploads the
 * photo; `discard` removes it again if the entry then fails to save, so the
 * bucket never holds a photo without its entry.
 *
 * Online projects skip all of this. A photo or position sent for an online
 * project is ignored rather than stored: the columns are visit proof, and an
 * online follow-up is not a visit.
 */
@Injectable()
export class VisitProofService {
  constructor(
    private readonly captureTokens: CaptureTokenService,
    private readonly images: ImageService,
    private readonly storage: SupabaseStorageClient,
  ) {}

  requiresProof(projectType: ProjectType): boolean {
    return projectType === ProjectType.DOOR_TO_DOOR;
  }

  /** Everything checkable without side effects. Throws the message the screen shows. */
  validate(input: VisitProofInput, user: AuthenticatedUser, now: Date): void {
    if (!input.photo?.buffer?.length) {
      throw new BusinessException(VISIT_ERROR.PHOTO_REQUIRED, ERROR_CODE.VISIT_PROOF_REQUIRED);
    }
    if (
      input.latitude === undefined ||
      input.longitude === undefined ||
      input.gpsAccuracyM === undefined
    ) {
      throw new BusinessException(VISIT_ERROR.GPS_REQUIRED, ERROR_CODE.VISIT_PROOF_REQUIRED);
    }
    this.captureTokens.verify(input.captureToken, user.id, now);
  }

  /**
   * Stamps latitude, longitude, accuracy, IST date and time and the person's
   * name onto the photo and uploads it under the entry's id. Call `validate`
   * first.
   */
  async store(
    input: VisitProofInput,
    context: { projectId: string; entryId: string; createdAt: Date; personName: string },
  ): Promise<StoredVisitProof> {
    const latitude = input.latitude!;
    const longitude = input.longitude!;
    const gpsAccuracyM = input.gpsAccuracyM!;

    const processed = await this.images.processVisitPhoto(input.photo!.buffer, {
      latitude,
      longitude,
      accuracyM: gpsAccuracyM,
      takenAt: formatIstStamp(context.createdAt),
      personName: context.personName,
    });

    const month = istDateOf(context.createdAt).slice(0, 7);
    const photoPath = `${STORAGE_FOLDER.VISITS}/${context.projectId}/${month}/${context.entryId}.jpg`;
    await this.storage.upload(photoPath, processed.buffer, processed.contentType);

    return {
      photoPath,
      latitude: roundTo(latitude, 6),
      longitude: roundTo(longitude, 6),
      gpsAccuracyM: roundTo(gpsAccuracyM, 2),
    };
  }

  async discard(proof: StoredVisitProof | null): Promise<void> {
    if (proof) await this.storage.removeObjects([proof.photoPath]);
  }
}

const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
