import { ConfigService } from '@nestjs/config';

import { GeoConfig } from '../../config/configuration';
import { GeoLookupLimiter } from './lookup-limiter';
import { parseNominatim, parsePhoton } from './place-parsers';
import { GeoDeps, ReverseGeocoder, TtlLru } from './reverse-geocoder.service';

/** Trimmed from a real Nominatim jsonv2 reverse answer for a street in Wanowrie, Pune. */
const NOMINATIM_WANOWRIE = {
  place_id: 123,
  lat: '18.4966',
  lon: '73.8993',
  name: 'Wanowrie Road',
  display_name:
    'Wanowrie Road, Salunke Vihar, Wanowrie, Pune City, Pune, Maharashtra, 411040, India',
  address: {
    road: 'Wanowrie Road',
    neighbourhood: 'Salunke Vihar',
    suburb: 'Wanowrie',
    city_district: 'Pune City',
    city: 'Pune',
    state_district: 'Pune',
    state: 'Maharashtra',
    'ISO3166-2-lvl4': 'IN-MH',
    postcode: '411040',
    country: 'India',
    country_code: 'in',
  },
};

/** Trimmed from a real Photon reverse answer. */
const PHOTON_KONDHWA = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [73.8822, 18.4732] },
      properties: {
        osm_key: 'highway',
        osm_value: 'residential',
        type: 'street',
        name: 'NIBM Road',
        district: 'Kondhwa',
        city: 'Pune',
        county: 'Pune',
        state: 'Maharashtra',
        postcode: '411048',
        country: 'India',
        countrycode: 'IN',
      },
    },
  ],
};

describe('place parsers', () => {
  it('reads the area and a short line from Nominatim', () => {
    expect(parseNominatim(NOMINATIM_WANOWRIE)).toEqual({
      area: 'Wanowrie',
      label: 'Wanowrie Road, Wanowrie, Pune 411040',
    });
  });

  it('falls back from suburb to neighbourhood, village and city', () => {
    expect(parseNominatim({ address: { neighbourhood: 'Koregaon Park', city: 'Pune' } })).toEqual({
      area: 'Koregaon Park',
      label: 'Koregaon Park, Pune',
    });
    expect(
      parseNominatim({ address: { village: 'Wagholi', county: 'Haveli', postcode: '412207' } }),
    ).toEqual({ area: 'Wagholi', label: 'Wagholi, Haveli 412207' });
    // The city as the only name: no "Pune, Pune".
    expect(parseNominatim({ address: { city: 'Pune', postcode: '411001' } })).toEqual({
      area: 'Pune',
      label: 'Pune, 411001',
    });
  });

  it('answers null when Nominatim knows nothing there', () => {
    expect(parseNominatim({ error: 'Unable to geocode' })).toBeNull();
    expect(parseNominatim(null)).toBeNull();
    expect(parseNominatim('<html>')).toBeNull();
    expect(parseNominatim({ address: {} })).toBeNull();
  });

  it('keeps the first parts of display_name when the address has no usable parts', () => {
    expect(
      parseNominatim({
        display_name: 'Gate 2, Magarpatta City, Hadapsar, Pune, Maharashtra, India',
        address: { country: 'India' },
      }),
    ).toEqual({ area: null, label: 'Gate 2, Magarpatta City, Hadapsar' });
  });

  it('strips markup and control characters from a third party’s text', () => {
    expect(parseNominatim({ address: { suburb: 'Wan<script>owrie\n', city: 'Pune' } })?.label).toBe(
      'Wan script owrie, Pune',
    );
  });

  it('cuts a very long line to 200 characters', () => {
    const label = parseNominatim({ address: { road: 'R'.repeat(300), city: 'Pune' } })!.label;
    expect(label).toHaveLength(200);
    expect(label.endsWith('…')).toBe(true);
  });

  it('reads Photon: the street feature, its district and city', () => {
    expect(parsePhoton(PHOTON_KONDHWA)).toEqual({
      area: 'Kondhwa',
      label: 'NIBM Road, Kondhwa, Pune 411048',
    });
    expect(
      parsePhoton({
        features: [{ properties: { type: 'locality', name: 'Undri', city: 'Pune' } }],
      }),
    ).toEqual({ area: 'Undri', label: 'Undri, Pune' });
    expect(parsePhoton({ features: [] })).toBeNull();
    expect(parsePhoton({})).toBeNull();
  });
});

/** A fake upstream: answers by host, records what was asked and on which (virtual) clock tick. */
const fakeUpstream = () => {
  let clock = 1_000_000;
  const timers: Array<{ end: number; resolve: () => void }> = [];
  const fireNext = (): void => {
    timers.sort((a, b) => a.end - b.end);
    const next = timers.shift();
    if (!next) return;
    clock = Math.max(clock, next.end);
    next.resolve();
  };
  const calls: Array<{ url: URL; at: number; headers: Record<string, string> }> = [];
  const reply: Record<string, (url: URL) => Promise<Response>> = {
    nominatim: async () => json(NOMINATIM_WANOWRIE),
    photon: async () => json(PHOTON_KONDHWA),
  };
  const deps: GeoDeps = {
    now: () => clock,
    // Virtual time: waits end at once, earliest first, each moving the clock to its end.
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        timers.push({ end: clock + ms, resolve });
        setImmediate(fireNext);
      }),
    fetch: ((input: string, init: RequestInit) => {
      const url = new URL(input);
      calls.push({ url, at: clock, headers: init.headers as Record<string, string> });
      return reply[url.hostname.split('.')[0]](url);
    }) as unknown as typeof fetch,
  };
  return { deps, calls, reply, tick: (ms: number) => (clock += ms) };
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CONFIG: GeoConfig = {
  enabled: true,
  contact: 'sales-ops@pronttera.com',
  nominatimUrl: 'https://nominatim.test',
  photonUrl: 'https://photon.test',
  timeoutMs: 4_000,
  minIntervalMs: 1_000,
  cacheSize: 100,
  cacheTtlMs: 60_000,
};

const geocoder = (deps: GeoDeps, config: Partial<GeoConfig> = {}) =>
  new ReverseGeocoder(
    { getOrThrow: () => ({ ...CONFIG, ...config }) } as unknown as ConfigService,
    deps,
  );

describe('ReverseGeocoder', () => {
  it('asks Nominatim as its usage policy asks: identified, rounded, English', async () => {
    const upstream = fakeUpstream();
    const place = await geocoder(upstream.deps).reverse(18.496612345, 73.899298765);

    expect(place).toEqual({ area: 'Wanowrie', label: 'Wanowrie Road, Wanowrie, Pune 411040' });
    expect(upstream.calls).toHaveLength(1);
    const [{ url, headers }] = upstream.calls;
    expect(url.origin + url.pathname).toBe('https://nominatim.test/reverse');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2',
      lat: '18.4966',
      lon: '73.8993',
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'en',
      email: 'sales-ops@pronttera.com',
    });
    expect(headers['User-Agent']).toBe(
      'ProntteraSales/1.0 (+https://sales.pronttera.com; sales-ops@pronttera.com)',
    );
  });

  it('falls back to Photon when Nominatim fails or knows nothing', async () => {
    const upstream = fakeUpstream();
    upstream.reply.nominatim = async () => json({ error: 'busy' }, 503);
    const service = geocoder(upstream.deps);
    expect(await service.reverse(18.4732, 73.8822)).toEqual({
      area: 'Kondhwa',
      label: 'NIBM Road, Kondhwa, Pune 411048',
    });
    expect(upstream.calls.map((c) => c.url.hostname)).toEqual(['nominatim.test', 'photon.test']);

    upstream.reply.nominatim = async () => json({ error: 'Unable to geocode' });
    expect((await service.reverse(19.1, 72.9))?.area).toBe('Kondhwa');
  });

  it('answers null when both services fail, and tries again next time', async () => {
    const upstream = fakeUpstream();
    upstream.reply.nominatim = async () => {
      throw new TypeError('fetch failed');
    };
    upstream.reply.photon = async () => new Response('<html>Bad gateway</html>', { status: 502 });
    const service = geocoder(upstream.deps);
    expect(await service.reverse(18.4966, 73.8993)).toBeNull();

    upstream.reply.nominatim = async () => json(NOMINATIM_WANOWRIE);
    upstream.tick(5_000);
    expect((await service.reverse(18.4966, 73.8993))?.area).toBe('Wanowrie');
  });

  it('remembers a place by its position to ~11 m, and asks once for two lookups at once', async () => {
    const upstream = fakeUpstream();
    const service = geocoder(upstream.deps);
    const [a, b] = await Promise.all([
      service.reverse(18.49661, 73.89931),
      service.reverse(18.49659, 73.89929), // rounds to the same 18.4966, 73.8993
    ]);
    expect(a).toEqual(b);
    expect(await service.reverse(18.4966, 73.8993)).toEqual(a);
    expect(upstream.calls).toHaveLength(1);

    // Somewhere else is asked for.
    upstream.tick(1_000);
    await service.reverse(18.5, 73.9);
    expect(upstream.calls).toHaveLength(2);
  });

  it('remembers "no name here" too, when both services said so', async () => {
    const upstream = fakeUpstream();
    upstream.reply.nominatim = async () => json({ error: 'Unable to geocode' });
    upstream.reply.photon = async () => json({ features: [] });
    const service = geocoder(upstream.deps);
    expect(await service.reverse(10, 10)).toBeNull();
    upstream.tick(5_000);
    expect(await service.reverse(10, 10)).toBeNull();
    expect(upstream.calls).toHaveLength(2);
  });

  it('sends at most one request a second to Nominatim, from every caller together', async () => {
    const upstream = fakeUpstream();
    const service = geocoder(upstream.deps);
    const places = await Promise.all([
      service.reverse(18.1, 73.1),
      service.reverse(18.2, 73.2),
      service.reverse(18.3, 73.3),
    ]);
    expect(places.every((p) => p?.area === 'Wanowrie')).toBe(true);
    const times = upstream.calls.map((c) => c.at).sort((x, y) => x - y);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1_000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1_000);
  });

  it('does not queue a lookup whose turn would come after the time limit', async () => {
    const upstream = fakeUpstream();
    upstream.reply.photon = async () => json({ features: [] });
    const service = geocoder(upstream.deps, { timeoutMs: 2_500 });
    const places = await Promise.all(
      [1, 2, 3, 4].map((i) => service.reverse(18 + i / 10, 73 + i / 10)),
    );
    // Slots at 0, 1 and 2 s fit in 2.5 s; the fourth would wait 3 s, so it isn't sent.
    expect(places.filter(Boolean)).toHaveLength(3);
    expect(upstream.calls.filter((c) => c.url.hostname === 'nominatim.test')).toHaveLength(3);
  });

  it('gives up after the time limit and answers null', async () => {
    const hang = (_url: URL, signal?: AbortSignal | null) =>
      new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as Error));
      });
    const deps: GeoDeps = {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: ((input: string, init: RequestInit) =>
        hang(new URL(input), init.signal)) as unknown as typeof fetch,
    };
    const started = Date.now();
    expect(await geocoder(deps, { timeoutMs: 150 }).reverse(18.4966, 73.8993)).toBeNull();
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(1_000);
  });

  it('does nothing when switched off or given no real position', async () => {
    const upstream = fakeUpstream();
    expect(await geocoder(upstream.deps, { enabled: false }).reverse(18.5, 73.9)).toBeNull();
    expect(await geocoder(upstream.deps).reverse(Number.NaN, 73.9)).toBeNull();
    expect(await geocoder(upstream.deps).reverse(91, 73.9)).toBeNull();
    expect(upstream.calls).toHaveLength(0);
  });

  it('identifies itself even without a contact', async () => {
    const upstream = fakeUpstream();
    await geocoder(upstream.deps, { contact: '' }).reverse(18.5, 73.9);
    expect(upstream.calls[0].headers['User-Agent']).toBe(
      'ProntteraSales/1.0 (+https://sales.pronttera.com)',
    );
    expect(upstream.calls[0].url.searchParams.has('email')).toBe(false);
  });
});

describe('TtlLru', () => {
  it('drops the least recently used entry when full, and expired ones', () => {
    let now = 0;
    const cache = new TtlLru<string>(2, 100, () => now);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A'); // a is now the most recent
    cache.set('c', 'C');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    now = 150;
    expect(cache.get('c')).toBeUndefined();
    expect(cache.size).toBe(1);
  });
});

describe('GeoLookupLimiter', () => {
  it('allows 20 lookups per person per minute', () => {
    const limiter = new GeoLookupLimiter();
    let now = 0;
    limiter.now = () => now;
    for (let i = 0; i < 20; i += 1) limiter.take('ravi');
    expect(() => limiter.take('ravi')).toThrow(/Too many tries/);
    // Someone else is counted on their own.
    expect(() => limiter.take('priya')).not.toThrow();
    now = 60_001;
    expect(() => limiter.take('ravi')).not.toThrow();
  });
});
