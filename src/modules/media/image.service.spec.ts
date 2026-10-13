import { writeFileSync } from 'node:fs';

import sharp from 'sharp';

import { BUSINESS_RULE, ERROR_CODE } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ImageService } from './image.service';

const STAMP = {
  latitude: 18.52043,
  longitude: 73.856743,
  accuracyM: 12.4,
  takenAt: '08 Oct 2026, 03:42 pm',
  // 15:42:10 IST.
  at: new Date('2026-10-08T10:12:10Z'),
  personName: 'Ravi <Kumar> & Co',
  place: 'Wanowrie Road, Wanowrie, Pune 411040',
};

type ExifValue = string | number[] | Array<[number, number]>;
interface ExifBlocks {
  image: Record<number, ExifValue>;
  exif: Record<number, ExifValue>;
  gps: Record<number, ExifValue>;
}

/**
 * Just enough of a TIFF/EXIF reader to check what was written: IFD0, the Exif
 * sub-IFD and the GPS sub-IFD, ASCII, SHORT, LONG, BYTE and RATIONAL values.
 */
const readExif = (raw: Buffer): ExifBlocks => {
  const tiff = raw.subarray(raw.indexOf('Exif\0\0', 0, 'latin1') + 6);
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const size: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const ifd = (offset: number): Record<number, ExifValue> => {
    const out: Record<number, ExifValue> = {};
    for (let i = 0; i < u16(offset); i += 1) {
      const e = offset + 2 + i * 12;
      const [tag, type, count] = [u16(e), u16(e + 2), u32(e + 4)];
      const at = size[type] * count > 4 ? u32(e + 8) : e + 8;
      const many = <T>(read: (k: number) => T): T[] =>
        Array.from({ length: count }, (_, k) => read(k));
      if (type === 2) out[tag] = tiff.toString('latin1', at, at + count).replace(/\0+$/u, '');
      else if (type === 5)
        out[tag] = many<[number, number]>((k) => [u32(at + 8 * k), u32(at + 8 * k + 4)]);
      else if (type === 3) out[tag] = many((k) => u16(at + 2 * k));
      else if (type === 4) out[tag] = many((k) => u32(at + 4 * k));
      else out[tag] = many((k) => tiff[at + k]);
    }
    return out;
  };
  const image = ifd(u32(4));
  const pointer = (tag: number) => (image[tag] ? ifd((image[tag] as number[])[0]) : {});
  return { image, exif: pointer(0x8769), gps: pointer(0x8825) };
};

/** Degrees, minutes, seconds as EXIF rationals, back to decimal degrees. */
const decimal = (value: ExifValue, ref: ExifValue): number => {
  const [d, m, sec] = (value as Array<[number, number]>).map(([n, den]) => n / den);
  return (d + m / 60 + sec / 3600) * (ref === 'S' || ref === 'W' ? -1 : 1);
};

/** A textured photo-sized JPEG, so compression has real work to do. */
const cameraPhoto = async (width: number, height: number): Promise<Buffer> => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const grain = (x * 31 + y * 17) % 23;
      pixels[i] = (x / 12 + grain) % 256;
      pixels[i + 1] = (y / 15 + grain) % 256;
      pixels[i + 2] = ((x + y) / 20 + grain) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
};

describe('ImageService', () => {
  const service = new ImageService();

  it('stamps, scales and compresses a camera photo toward 200–300 KB', async () => {
    const input = await cameraPhoto(3000, 4000);
    expect(input.length).toBeLessThan(BUSINESS_RULE.VISIT_PHOTO_MAX_BYTES);
    const output = await service.processVisitPhoto(input, STAMP);

    expect(output.contentType).toBe('image/jpeg');
    expect(Math.max(output.width, output.height)).toBe(BUSINESS_RULE.VISIT_PHOTO_MAX_EDGE_PX);
    expect(output.buffer.length).toBeLessThan(input.length);

    const metadata = await sharp(output.buffer).metadata();
    expect(metadata.format).toBe('jpeg');

    if (process.env.STAMP_PREVIEW_PATH) {
      writeFileSync(process.env.STAMP_PREVIEW_PATH, output.buffer);
    }
  });

  it('writes the server’s position and time into the photo’s EXIF', async () => {
    const output = await service.processVisitPhoto(await cameraPhoto(640, 480), STAMP);
    const { exif } = await sharp(output.buffer).metadata();
    const { image, exif: taken, gps } = readExif(exif!);

    expect(decimal(gps[0x2], gps[0x1])).toBeCloseTo(STAMP.latitude, 6);
    expect(decimal(gps[0x4], gps[0x3])).toBeCloseTo(STAMP.longitude, 6);
    expect(gps[0x1]).toBe('N');
    expect(gps[0x3]).toBe('E');
    expect(gps[0x12]).toBe('WGS-84');
    expect(gps[0x1f]).toEqual([[1240, 100]]); // ± 12.4 m
    expect(gps[0x1d]).toBe('2026:10:08'); // UTC date…
    expect(gps[0x7]).toEqual([
      [10, 1],
      [12, 1],
      [10, 1],
    ]); // …and time
    expect(taken[0x9003]).toBe('2026:10:08 15:42:10'); // DateTimeOriginal, IST
    expect(taken[0x9011]).toBe('+05:30');
    expect(image[0x10e]).toBe(STAMP.place);
  });

  it('replaces the phone’s own EXIF position with the server’s', async () => {
    const phoneSaysElsewhere = await sharp(await cameraPhoto(640, 480))
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '28/1 36/1 0/1' } })
      .jpeg()
      .toBuffer();
    const output = await service.processVisitPhoto(phoneSaysElsewhere, {
      ...STAMP,
      latitude: -33.8688,
      longitude: -151.2093,
      place: 'Café Zürich, São Paulo',
    });
    const { image, gps } = readExif((await sharp(output.buffer).metadata()).exif!);
    expect(decimal(gps[0x2], gps[0x1])).toBeCloseTo(-33.8688, 6);
    expect(decimal(gps[0x4], gps[0x3])).toBeCloseTo(-151.2093, 6);
    expect(image[0x10e]).toBe('Cafe Zurich, Sao Paulo'); // EXIF text is ASCII
  });

  it('adds a line for the place to the stamp, and leaves it out when unknown', async () => {
    const white = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();
    // Just above where a two-line band starts: dark only when a third line is there.
    const fontSize = Math.max(14, Math.round(640 / 38));
    const twoLineBand = Math.round(fontSize * 1.35) * 2 + Math.round(fontSize * 0.6) * 2;
    const row = 480 - twoLineBand - 4;
    const brightness = async (buffer: Buffer) => {
      const { data } = await sharp(buffer)
        .extract({ left: 600, top: row, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      return data[0];
    };
    const withPlace = await service.processVisitPhoto(white, STAMP);
    const withoutPlace = await service.processVisitPhoto(white, { ...STAMP, place: null });
    expect(await brightness(withPlace.buffer)).toBeLessThan(160);
    expect(await brightness(withoutPlace.buffer)).toBeGreaterThan(230);
    const { image } = readExif((await sharp(withoutPlace.buffer).metadata()).exif!);
    expect(image[0x10e]).toBeUndefined();
  });

  it('never enlarges a small photo', async () => {
    const output = await service.processVisitPhoto(await cameraPhoto(640, 480), STAMP);
    expect(output.width).toBe(640);
    expect(output.height).toBe(480);
  });

  it('refuses bytes that are not an image, whatever they claim to be', async () => {
    await expect(
      service.processVisitPhoto(Buffer.from('not a photo'), STAMP),
    ).rejects.toMatchObject({
      errorCode: ERROR_CODE.VALIDATION_FAILED,
    });
  });

  it('refuses a GIF as a project image (JPG or PNG only)', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
      .gif()
      .toBuffer();
    await expect(service.processProjectImage(gif)).rejects.toBeInstanceOf(BusinessException);
  });

  it('flattens a transparent PNG project image onto white', async () => {
    const png = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const output = await service.processProjectImage(png);
    const { data } = await sharp(output.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });
});
