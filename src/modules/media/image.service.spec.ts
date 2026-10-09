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
  personName: 'Ravi <Kumar> & Co',
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
    // The phone's own EXIF (its GPS, its clock) is not evidence and is dropped.
    expect(metadata.exif).toBeUndefined();

    if (process.env.STAMP_PREVIEW_PATH) {
      writeFileSync(process.env.STAMP_PREVIEW_PATH, output.buffer);
    }
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
