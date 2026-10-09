import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { BUSINESS_RULE, ERROR_CODE, PROJECT_ERROR, VISIT_ERROR } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';

/** The text burnt onto a visit photo (VP-5). */
export interface VisitStamp {
  latitude: number;
  longitude: number;
  accuracyM: number;
  /** Already formatted in IST, e.g. `08 Oct 2026, 03:42 pm`. */
  takenAt: string;
  personName: string;
}

export interface ProcessedImage {
  buffer: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
}

/** Formats the camera can hand a browser that sharp decodes. */
const VISIT_PHOTO_FORMATS = new Set(['jpeg', 'png', 'webp']);
const PROJECT_IMAGE_FORMATS = new Set(['jpeg', 'png']);

const STAMP_FONT_FAMILY = 'DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif';

/**
 * Image handling with sharp. Formats are read from the bytes, never from the
 * name or MIME type the client declared.
 */
@Injectable()
export class ImageService {
  /**
   * Turns the camera upload into the stored visit photo:
   *
   *  1. rotates it upright from its EXIF orientation, then drops all metadata
   *     (the phone's own GPS and clock are not evidence — the server's are);
   *  2. scales it to at most 1280 px on the long edge;
   *  3. burns latitude, longitude, accuracy, date, time and the person's name
   *     onto a band along the bottom (VP-5);
   *  4. encodes JPEG, stepping quality down until it is about 200–300 KB (VP-7).
   */
  async processVisitPhoto(input: Buffer, stamp: VisitStamp): Promise<ProcessedImage> {
    if (input.length > BUSINESS_RULE.VISIT_PHOTO_MAX_BYTES) {
      throw new BusinessException(VISIT_ERROR.PHOTO_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    await this.assertFormat(input, VISIT_PHOTO_FORMATS, VISIT_ERROR.PHOTO_INVALID);

    const { data: upright, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({
        width: BUSINESS_RULE.VISIT_PHOTO_MAX_EDGE_PX,
        height: BUSINESS_RULE.VISIT_PHOTO_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer({ resolveWithObject: true })
      .catch(() => {
        throw new BusinessException(VISIT_ERROR.PHOTO_INVALID, ERROR_CODE.VALIDATION_FAILED);
      });

    const overlay = Buffer.from(this.stampSvg(info.width, info.height, stamp));
    const stamped = await sharp(upright)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .toBuffer();

    let buffer = stamped;
    for (const quality of BUSINESS_RULE.VISIT_PHOTO_QUALITY_STEPS) {
      buffer = await sharp(stamped).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buffer.length <= BUSINESS_RULE.VISIT_PHOTO_TARGET_MAX_BYTES) break;
    }

    return { buffer, contentType: 'image/jpeg', width: info.width, height: info.height };
  }

  /** PRD §5.3: JPG or PNG up to 2 MB, compressed on upload. */
  async processProjectImage(input: Buffer): Promise<ProcessedImage> {
    if (input.length > BUSINESS_RULE.PROJECT_IMAGE_MAX_BYTES) {
      throw new BusinessException(PROJECT_ERROR.IMAGE_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    await this.assertFormat(input, PROJECT_IMAGE_FORMATS, PROJECT_ERROR.IMAGE_TYPE);

    const { data, info } = await sharp(input)
      .rotate()
      .resize({
        width: BUSINESS_RULE.PROJECT_IMAGE_MAX_EDGE_PX,
        height: BUSINESS_RULE.PROJECT_IMAGE_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // A transparent PNG would turn black as JPEG.
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return { buffer: data, contentType: 'image/jpeg', width: info.width, height: info.height };
  }

  private async assertFormat(input: Buffer, allowed: Set<string>, message: string): Promise<void> {
    const format = await sharp(input)
      .metadata()
      .then((metadata) => metadata.format)
      .catch(() => undefined);

    if (!format || !allowed.has(format)) {
      throw new BusinessException(message, ERROR_CODE.VALIDATION_FAILED);
    }
  }

  /** Two lines of white text on a dark band, sized to the photo. */
  private stampSvg(width: number, height: number, stamp: VisitStamp): string {
    const fontSize = Math.max(14, Math.round(width / 38));
    const lineHeight = Math.round(fontSize * 1.35);
    const padding = Math.round(fontSize * 0.6);
    const bandHeight = lineHeight * 2 + padding * 2;
    const bandTop = height - bandHeight;

    const lines = [
      `Lat ${stamp.latitude.toFixed(6)}, Long ${stamp.longitude.toFixed(6)} (±${Math.round(stamp.accuracyM)} m)`,
      `${stamp.takenAt} IST · ${stamp.personName}`,
    ];

    const text = lines
      .map(
        (line, index) =>
          `<text x="${padding}" y="${bandTop + padding + lineHeight * (index + 1) - Math.round(fontSize * 0.3)}">${escapeXml(line)}</text>`,
      )
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect x="0" y="${bandTop}" width="${width}" height="${bandHeight}" fill="#000000" fill-opacity="0.55"/>
  <g font-family="${STAMP_FONT_FAMILY}" font-size="${fontSize}" fill="#ffffff">${text}</g>
</svg>`;
  }
}

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/gu, (char) => `&#${char.charCodeAt(0)};`);
