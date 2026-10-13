import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BUSINESS_RULE, CONFIG_NAMESPACE } from '../../common/constants';
import { GeoConfig } from '../../config/configuration';
import { parseNominatim, parsePhoton, PlaceName } from './place-parsers';

export type { PlaceName } from './place-parsers';

/** Clock, timer and HTTP, replaceable in unit tests. */
export interface GeoDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const GEO_DEPS = Symbol('GEO_DEPS');

/** Identifies us to OpenStreetMap, as Nominatim's usage policy requires. */
const USER_AGENT_PRODUCT = 'ProntteraSales/1.0';
const USER_AGENT_HOMEPAGE = 'https://sales.pronttera.com';

type Service = 'nominatim' | 'photon';

/** `answered` with a null place: the service worked and knows no name here. */
type Outcome = { answered: true; place: PlaceName | null } | { answered: false };

/**
 * Turns a position into the area it is in, with free OpenStreetMap services and no
 * key: Nominatim first, Photon (komoot) when Nominatim fails or knows nothing.
 *
 * Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *  - an identifying User-Agent with a contact (GEOCODER_CONTACT);
 *  - at most one request a second: every request to a service waits for its slot
 *    in one queue shared by the whole API process;
 *  - results cached: positions are rounded to 4 decimals (~11 m), looked up once,
 *    and kept in memory; the same lookup asked twice at once is sent once.
 *
 * Never throws and never waits long: the whole lookup — queue, Nominatim, Photon —
 * gives up after GEOCODER_TIMEOUT_MS and answers null. A request whose queue slot
 * would come after that is not queued at all, so a burst cannot pile up.
 */
@Injectable()
export class ReverseGeocoder {
  private readonly logger = new Logger(ReverseGeocoder.name);
  private readonly config: GeoConfig;
  private readonly deps: GeoDeps;
  private readonly cache: TtlLru<PlaceName | null>;
  private readonly inflight = new Map<string, Promise<PlaceName | null>>();
  private readonly nextSlotAt: Record<Service, number> = { nominatim: 0, photon: 0 };

  constructor(configService: ConfigService, @Optional() @Inject(GEO_DEPS) deps?: GeoDeps) {
    this.config = configService.getOrThrow<GeoConfig>(CONFIG_NAMESPACE.GEO);
    this.deps = deps ?? {
      fetch: (...args) => fetch(...args),
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    this.cache = new TtlLru(this.config.cacheSize, this.config.cacheTtlMs, this.deps.now);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** The place at this position, or null when unknown, switched off or unreachable. */
  async reverse(latitude: number, longitude: number): Promise<PlaceName | null> {
    if (!this.config.enabled || !isPosition(latitude, longitude)) return null;

    const lat = roundTo(latitude);
    const lng = roundTo(longitude);
    const key = `${lat.toFixed(BUSINESS_RULE.GEOCODER_ROUND_DECIMALS)},${lng.toFixed(BUSINESS_RULE.GEOCODER_ROUND_DECIMALS)}`;

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const lookup = this.lookup(key, lat, lng)
      .catch((error: unknown) => {
        this.logger.warn(`Place lookup failed: ${(error as Error).message}`);
        return null;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, lookup);
    return lookup;
  }

  private async lookup(key: string, lat: number, lng: number): Promise<PlaceName | null> {
    const deadline = this.deps.now() + this.config.timeoutMs;

    const nominatim = await this.ask(
      'nominatim',
      this.nominatimUrl(lat, lng),
      parseNominatim,
      deadline,
    );
    if (nominatim.answered && nominatim.place) return this.remember(key, nominatim.place);

    const photon = await this.ask('photon', this.photonUrl(lat, lng), parsePhoton, deadline);
    if (photon.answered && photon.place) return this.remember(key, photon.place);

    // Both answered and neither knows a name: that is worth remembering too. A
    // failure is not — the next visit here should try again.
    if (nominatim.answered && photon.answered) this.cache.set(key, null);
    return null;
  }

  private remember(key: string, place: PlaceName): PlaceName {
    this.cache.set(key, place);
    return place;
  }

  private async ask(
    service: Service,
    url: string,
    parse: (body: unknown) => PlaceName | null,
    deadline: number,
  ): Promise<Outcome> {
    const wait = this.reserveSlot(service, deadline);
    if (wait === null) {
      this.logger.warn(`Place lookup skipped: ${service} is busy`);
      return { answered: false };
    }
    if (wait > 0) await this.deps.sleep(wait);

    const remaining = deadline - this.deps.now();
    if (remaining <= 0) return { answered: false };

    try {
      const response = await this.deps.fetch(url, {
        headers: {
          'User-Agent': this.userAgent(),
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
        signal: AbortSignal.timeout(remaining),
      });
      if (!response.ok) {
        this.logger.warn(`Place lookup: ${service} answered HTTP ${response.status}`);
        return { answered: false };
      }
      return { answered: true, place: parse(await response.json()) };
    } catch (error) {
      this.logger.warn(`Place lookup: ${service} unreachable (${(error as Error).message})`);
      return { answered: false };
    }
  }

  /**
   * Books the next free one-second slot for this service and says how long to wait
   * for it, or null when that slot is past the deadline (nothing is booked then).
   * Synchronous, so two callers can never book the same slot.
   */
  private reserveSlot(service: Service, deadline: number): number | null {
    const now = this.deps.now();
    const at = Math.max(now, this.nextSlotAt[service]);
    if (at >= deadline) return null;
    this.nextSlotAt[service] = at + this.config.minIntervalMs;
    return at - now;
  }

  private nominatimUrl(lat: number, lng: number): string {
    const params = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'en',
    });
    // The policy asks heavy users for an email to reach them; send it when we have one.
    if (this.config.contact.includes('@')) params.set('email', this.config.contact);
    return `${this.config.nominatimUrl}/reverse?${params.toString()}`;
  }

  private photonUrl(lat: number, lng: number): string {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en' });
    return `${this.config.photonUrl}/reverse?${params.toString()}`;
  }

  private userAgent(): string {
    const contact = this.config.contact.replace(/[^\x20-\x7e]/gu, '').replace(/[()]/gu, '');
    return `${USER_AGENT_PRODUCT} (+${USER_AGENT_HOMEPAGE}${contact ? `; ${contact}` : ''})`;
  }
}

const isPosition = (latitude: number, longitude: number): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180;

const roundTo = (value: number): number => {
  const factor = 10 ** BUSINESS_RULE.GEOCODER_ROUND_DECIMALS;
  return Math.round(value * factor) / factor;
};

/** A small least-recently-used cache whose entries also expire. */
export class TtlLru<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry); // most recently used goes last
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}
