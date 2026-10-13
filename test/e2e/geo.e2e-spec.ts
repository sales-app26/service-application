import sharp from 'sharp';

import { ApiClient, cameraJpeg, requestId } from '../support/api-client';
import { Harness, startHarness } from '../support/harness';

const WANOWRIE = 'Wanowrie Road, Wanowrie, Pune 411040';
const KONDHWA = 'NIBM Road, Kondhwa, Pune 411048';

/**
 * Place names from OpenStreetMap (faked here): stamped onto visit photos, stored on
 * the entry, exported, and looked up for the lead form and the camera.
 */
describe('Visit place and place lookups (e2e)', () => {
  let harness: Harness;
  let api: ApiClient;
  let admin: ApiClient;
  let ravi: ApiClient;
  let raviId: string;
  let projectId: string;
  let onlineProjectId: string;
  let photo: Buffer;
  let phone = 9876501000;

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  const addVisit = async (latitude: number, longitude: number) => {
    const token = await ravi.post('/visits/capture-token');
    return ravi.postForm(
      `/projects/${projectId}/leads`,
      {
        name: 'Asha Patil',
        phone: String((phone += 1)),
        location: 'Wanowrie',
        status: 'contacted',
        note: 'Met the owner at the shop.',
        clientRequestId: requestId(),
        captureToken: token.body.data.captureToken,
        latitude,
        longitude,
        gpsAccuracyM: 12,
      },
      photo,
    );
  };

  const storedPhoto = (leadEntry: { photoUrl: string | null }): Buffer => {
    const key = decodeURIComponent(new URL(leadEntry.photoUrl!).pathname).split(
      `/object/sign/${harness.supabase.bucket}/`,
    )[1];
    return harness.supabase.objects.get(key)!.body;
  };

  /** ImageDescription (0x010e) from the photo's EXIF, which the server sets to the place. */
  const exifDescription = async (jpeg: Buffer): Promise<string | null> => {
    const { exif } = await sharp(jpeg).metadata();
    if (!exif) return null;
    const tiff = exif.subarray(6);
    const le = tiff.toString('latin1', 0, 2) === 'II';
    const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    const ifd0 = u32(4);
    for (let i = 0; i < u16(ifd0); i += 1) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) === 0x010e) {
        const count = u32(e + 4);
        const at = count > 4 ? u32(e + 8) : e + 8;
        return tiff.toString('latin1', at, at + count).replace(/\0+$/u, '');
      }
    }
    return null;
  };

  /** The stamp band is taller with the place line: this pixel is inside it only then. */
  const hasPlaceLine = async (jpeg: Buffer): Promise<boolean> => {
    const { width, height } = await sharp(jpeg).metadata();
    const fontSize = Math.max(14, Math.round(width! / 38));
    const twoLines = Math.round(fontSize * 1.35) * 2 + Math.round(fontSize * 0.6) * 2;
    const { data } = await sharp(jpeg)
      .extract({ left: width! - 10, top: height! - twoLines - 4, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    // cameraJpeg's green channel is 160; the band darkens it to about 70.
    return data[1] < 120;
  };

  beforeAll(async () => {
    harness = await startHarness();
    api = new ApiClient(harness.baseUrl);
    admin = api.as(await harness.supabase.accessToken(harness.superAdminId));
    const user = await admin.post('/users', {
      name: 'Ravi Kumar',
      email: 'ravi@pronttera.in',
      role: 'sales_person',
    });
    raviId = user.body.data.id;
    ravi = api.as(await harness.supabase.accessToken(raviId));
    const project = await admin.post('/projects', {
      name: 'Wanowrie Door-to-door',
      type: 'door_to_door',
      startDate: '2026-09-01',
    });
    projectId = project.body.data.id;
    const online = await admin.post('/projects', {
      name: 'Pune Retail Drive',
      type: 'online',
      startDate: '2026-09-01',
    });
    onlineProjectId = online.body.data.id;
    for (const id of [projectId, onlineProjectId]) {
      await admin.post(`/projects/${id}/members`, { userId: raviId });
    }
    photo = await cameraJpeg();
  });

  beforeEach(() => harness.geocoder.reset());

  afterAll(async () => {
    await harness?.close();
  });

  describe('visit proof', () => {
    it('stores where the photo was taken and stamps it on the photo', async () => {
      const res = await addVisit(18.496612, 73.899312);
      expect(res.status).toBe(201);
      const [entry] = res.body.data.recentEntries;
      expect(entry.placeName).toBe(WANOWRIE);

      const { rows } = await harness.db.query<{ place_name: string }>(
        `SELECT place_name FROM sales.follow_ups WHERE lead_id = $1`,
        [res.body.data.id],
      );
      expect(rows).toEqual([{ place_name: WANOWRIE }]);

      const jpeg = storedPhoto(entry);
      expect(await exifDescription(jpeg)).toBe(WANOWRIE);
      expect(await hasPlaceLine(jpeg)).toBe(true);

      // OpenStreetMap was asked once, politely, with the position rounded to ~11 m.
      expect(harness.geocoder.requests).toEqual([
        {
          service: 'nominatim',
          lat: 18.4966,
          lon: 73.8993,
          userAgent: 'ProntteraSales/1.0 (+https://sales.pronttera.com; e2e@example.com)',
        },
      ]);
    });

    it('asks once for the same spot, and falls back to Photon when Nominatim is down', async () => {
      expect((await addVisit(18.49661, 73.89931)).body.data.recentEntries[0].placeName).toBe(
        WANOWRIE,
      );
      expect(harness.geocoder.requests).toHaveLength(0); // remembered from the visit above

      harness.geocoder.nominatim = 'down';
      const res = await addVisit(18.4732, 73.8822);
      expect(res.body.data.recentEntries[0].placeName).toBe(KONDHWA);
      expect(harness.geocoder.requests.map((r) => r.service)).toEqual(['nominatim', 'photon']);
    });

    it('still saves the visit, without a place, when the map service does not answer', async () => {
      harness.geocoder.nominatim = 'hang';
      harness.geocoder.photon = 'hang';
      const started = Date.now();
      const res = await addVisit(19.076, 72.8777);
      expect(res.status).toBe(201);
      expect(Date.now() - started).toBeLessThan(5_000);
      const [entry] = res.body.data.recentEntries;
      expect(entry.placeName).toBeNull();

      const jpeg = storedPhoto(entry);
      expect(await exifDescription(jpeg)).toBeNull();
      expect(await hasPlaceLine(jpeg)).toBe(false);
    });

    it('adds the place to follow-ups on a visit, and never to an online follow-up', async () => {
      const lead = await addVisit(18.4966, 73.8993);
      const token = await ravi.post('/visits/capture-token');
      const visit = await ravi.postForm(
        `/leads/${lead.body.data.id}/follow-ups`,
        {
          status: 'interested',
          note: 'Second visit, wants a demo.',
          location: 'Wanowrie',
          clientRequestId: requestId(),
          captureToken: token.body.data.captureToken,
          latitude: 18.4732,
          longitude: 73.8822,
          gpsAccuracyM: 8,
        },
        photo,
      );
      expect(visit.status).toBe(201);
      const entries = await ravi.get(`/leads/${lead.body.data.id}/entries`);
      expect(
        entries.body.data.items.map((e: { placeName: string | null }) => e.placeName),
      ).toContain(WANOWRIE);

      harness.geocoder.reset();
      const online = await ravi.post(`/projects/${onlineProjectId}/leads`, {
        name: 'Imran Shaikh',
        phone: String((phone += 1)),
        location: 'Kondhwa',
        status: 'contacted',
        note: 'Called, will visit the store.',
        clientRequestId: requestId(),
      });
      expect(online.status).toBe(201);
      expect(online.body.data.recentEntries[0].placeName).toBeNull();
      expect(harness.geocoder.requests).toHaveLength(0);
    });

    it('exports the visit place', async () => {
      const res = await admin.get(
        `/exports/follow-ups?from=${today}&to=${today}&projectId=${projectId}`,
      );
      expect(res.status).toBe(200);
      const header = res.text.replace(/^\uFEFF/u, '').split(/\r?\n/u)[0];
      expect(header).toContain(',Location,Visit place,Latitude,Longitude,');
      expect(res.text).toContain(`"${WANOWRIE}"`);
    });
  });

  describe('GET /geo/reverse', () => {
    it('answers the area and a short line for a position', async () => {
      const res = await ravi.get('/geo/reverse?lat=18.4966&lng=73.8993');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ area: 'Wanowrie', label: WANOWRIE });
    });

    it('answers null, not an error, when nobody knows the place', async () => {
      harness.geocoder.nominatim = 'down';
      harness.geocoder.photon = 'down';
      const res = await ravi.get('/geo/reverse?lat=12.9716&lng=77.5946');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('is for signed-in people only', async () => {
      expect((await api.get('/geo/reverse?lat=18.4966&lng=73.8993')).status).toBe(401);
    });

    it.each([
      ['lat=91&lng=73.8993', 'lat'],
      ['lat=18.4966&lng=-181', 'lng'],
      ['lat=18.4966', 'lng'],
      ['lat=north&lng=73.8993', 'lat'],
    ])('refuses %s', async (query, field) => {
      const res = await ravi.get(`/geo/reverse?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      expect(res.body.errors?.map((e) => e.field)).toContain(field);
    });

    it('allows 20 lookups a minute per person', async () => {
      const user = await admin.post('/users', {
        name: 'Karan Mehta',
        email: 'karan@pronttera.in',
        role: 'sales_person',
      });
      const karan = api.as(await harness.supabase.accessToken(user.body.data.id));
      for (let i = 0; i < 20; i += 1) {
        expect((await karan.get('/geo/reverse?lat=18.4966&lng=73.8993')).status).toBe(200);
      }
      const limited = await karan.get('/geo/reverse?lat=18.4966&lng=73.8993');
      expect(limited.status).toBe(429);
      expect(limited.body.errorCode).toBe('RATE_LIMITED');
      // Someone else is not held back.
      expect((await admin.get('/geo/reverse?lat=18.4966&lng=73.8993')).status).toBe(200);
    });
  });
});
