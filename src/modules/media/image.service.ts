import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import { BUSINESS_RULE, ERROR_CODE, PROJECT_ERROR, VISIT_ERROR } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';

/** The text burnt onto a visit photo (VP-5), and the EXIF written into it. */
export interface VisitStamp {
  latitude: number;
  longitude: number;
  accuracyM: number;
  /** Already formatted in IST, e.g. `08 Oct 2026, 03:42 pm`. */
  takenAt: string;
  /** The same moment, for the photo's EXIF date and time. */
  at: Date;
  personName: string;
  /** Where it was taken, e.g. `Wanowrie Road, Wanowrie, Pune 411040`. Left out when unknown. */
  place?: string | null;
}

/** A visit photo checked, upright and scaled, waiting for its stamp. */
export interface PreparedPhoto {
  data: Buffer;
  width: number;
  height: number;
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
   *  3. burns the place, latitude, longitude, accuracy, date, time and the
   *     person's name onto a band along the bottom (VP-5);
   *  4. writes the same position and time into the JPEG's EXIF, so the file
   *     itself says where and when wherever it is opened;
   *  5. encodes JPEG, stepping quality down until it is about 200–300 KB (VP-7).
   */
  async processVisitPhoto(input: Buffer, stamp: VisitStamp): Promise<ProcessedImage> {
    return this.stampVisitPhoto(await this.prepareVisitPhoto(input), stamp);
  }

  /** Steps 1–2: everything that doesn't need the stamp, so it can run while the place is looked up. */
  async prepareVisitPhoto(input: Buffer): Promise<PreparedPhoto> {
    if (input.length > BUSINESS_RULE.VISIT_PHOTO_MAX_BYTES) {
      throw new BusinessException(VISIT_ERROR.PHOTO_TOO_LARGE, ERROR_CODE.VALIDATION_FAILED);
    }
    await this.assertFormat(input, VISIT_PHOTO_FORMATS, VISIT_ERROR.PHOTO_INVALID);

    const { data, info } = await sharp(input, { failOn: 'error' })
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

    return { data, width: info.width, height: info.height };
  }

  /** Steps 3–5. */
  async stampVisitPhoto(prepared: PreparedPhoto, stamp: VisitStamp): Promise<ProcessedImage> {
    const { width, height } = prepared;
    const overlay = Buffer.from(this.stampSvg(width, height, stamp));
    const stamped = await sharp(prepared.data)
      .composite([{ input: overlay, top: 0, left: 0 }])
      .toBuffer();

    const exif = visitExif(stamp);
    let buffer = stamped;
    for (const quality of BUSINESS_RULE.VISIT_PHOTO_QUALITY_STEPS) {
      buffer = await sharp(stamped).withExif(exif).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buffer.length <= BUSINESS_RULE.VISIT_PHOTO_TARGET_MAX_BYTES) break;
    }

    return { buffer, contentType: 'image/jpeg', width, height };
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

  /** White text on a dark band, sized to the photo: the place (when known), position, time and name. */
  private stampSvg(width: number, height: number, stamp: VisitStamp): string {
    const fontSize = Math.max(14, Math.round(width / 38));
    const lineHeight = Math.round(fontSize * 1.35);
    const padding = Math.round(fontSize * 0.6);
    // A rough average glyph width for the sans fonts above; long lines are cut, not overflowed.
    const maxChars = Math.max(20, Math.floor((width - padding * 2) / (fontSize * 0.56)));

    const lines = [
      ...(stamp.place ? [placeLine(stamp.place, maxChars)] : []),
      `Lat ${stamp.latitude.toFixed(6)}, Long ${stamp.longitude.toFixed(6)} (±${Math.round(stamp.accuracyM)} m)`,
      `${stamp.takenAt} IST · ${stamp.personName}`,
    ];
    const bandHeight = lineHeight * lines.length + padding * 2;
    const bandTop = height - bandHeight;

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

/** Place names come from OpenStreetMap; its licence asks for the credit next to them. */
const PLACE_CREDIT = ' · © OpenStreetMap';

const placeLine = (place: string, maxChars: number): string => {
  const room = maxChars - PLACE_CREDIT.length;
  const name = place.length <= room ? place : `${place.slice(0, Math.max(1, room - 1)).trimEnd()}…`;
  return `${name}${PLACE_CREDIT}`;
};

/** India Standard Time is UTC+05:30 all year. */
const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * EXIF for the stored photo, in libvips' IFD names: IFD0 (the image), IFD2 (Exif:
 * when it was taken) and IFD3 (GPS). Position as degrees, minutes and seconds with
 * N/S and E/W; the time in IST with its offset, and in UTC in the GPS block.
 */
export const visitExif = (stamp: VisitStamp): Record<string, Record<string, string>> => {
  const ist = new Date(stamp.at.getTime() + IST_OFFSET_MS);
  const istDateTime = exifDateTime(ist);
  const utc = stamp.at;
  const description = stamp.place ? asciiOnly(stamp.place) : '';
  return {
    IFD0: {
      Software: 'Pronttera Sales',
      DateTime: istDateTime,
      ...(description ? { ImageDescription: description } : {}),
    },
    IFD2: {
      DateTimeOriginal: istDateTime,
      OffsetTimeOriginal: '+05:30',
    },
    IFD3: {
      GPSLatitudeRef: stamp.latitude < 0 ? 'S' : 'N',
      GPSLatitude: dms(stamp.latitude),
      GPSLongitudeRef: stamp.longitude < 0 ? 'W' : 'E',
      GPSLongitude: dms(stamp.longitude),
      GPSMapDatum: 'WGS-84',
      GPSHPositioningError: `${Math.round(stamp.accuracyM * 100)}/100`,
      GPSDateStamp: `${utc.getUTCFullYear()}:${pad(utc.getUTCMonth() + 1)}:${pad(utc.getUTCDate())}`,
      GPSTimeStamp: `${utc.getUTCHours()}/1 ${utc.getUTCMinutes()}/1 ${utc.getUTCSeconds()}/1`,
    },
  };
};

/** `18.52043` → `18/1 31/1 13548/1000` (degrees, minutes, seconds to a millisecond of arc). */
const dms = (value: number): string => {
  const milliArcSeconds = Math.round(Math.abs(value) * 3_600_000);
  const degrees = Math.floor(milliArcSeconds / 3_600_000);
  const minutes = Math.floor((milliArcSeconds % 3_600_000) / 60_000);
  const seconds = milliArcSeconds % 60_000;
  return `${degrees}/1 ${minutes}/1 ${seconds}/1000`;
};

/** `YYYY:MM:DD HH:MM:SS` of a Date already shifted to the wanted zone (read in UTC). */
const exifDateTime = (shifted: Date): string =>
  `${shifted.getUTCFullYear()}:${pad(shifted.getUTCMonth() + 1)}:${pad(shifted.getUTCDate())} ` +
  `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** EXIF text is ASCII: accents are dropped, anything else becomes a space. */
const asciiOnly = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\x20-\x7e]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/gu, (char) => `&#${char.charCodeAt(0)};`);
