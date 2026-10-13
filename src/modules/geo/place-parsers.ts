import { BUSINESS_RULE } from '../../common/constants';

/** Where a position is, in words a sales rep uses. */
export interface PlaceName {
  /** The area: suburb, neighbourhood or locality, e.g. `Wanowrie`. Null when none is known. */
  area: string | null;
  /** One short readable line, e.g. `Wanowrie Road, Wanowrie, Pune 411040`. */
  label: string;
}

/** Nominatim `format=jsonv2` reverse answer (the parts we read). */
interface NominatimReverse {
  error?: string;
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
}

/** Photon reverse answer: a GeoJSON FeatureCollection. */
interface PhotonReverse {
  features?: Array<{ properties?: Record<string, unknown> }>;
}

/** Smallest named area first that a rep would recognise as "the area". */
const NOMINATIM_AREA_KEYS = [
  'suburb',
  'neighbourhood',
  'quarter',
  'residential',
  'village',
  'hamlet',
  'city_district',
  'town',
  'municipality',
  'city',
];
const NOMINATIM_CITY_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state_district'];
const NOMINATIM_STREET_KEYS = ['road', 'pedestrian', 'footway', 'path'];

/**
 * Reads Nominatim's reverse answer. Null when it found nothing (`{"error": …}`) or
 * nothing usable came back.
 */
export const parseNominatim = (body: unknown): PlaceName | null => {
  if (!isObject(body)) return null;
  const reply = body as NominatimReverse;
  if (reply.error || !isObject(reply.address)) return fromDisplayName(reply.display_name);
  const address = reply.address;
  const pick = (keys: string[]): string | null => {
    for (const key of keys) {
      const value = clean(address[key]);
      if (value) return value;
    }
    return null;
  };

  const area = pick(NOMINATIM_AREA_KEYS);
  const street = pick(NOMINATIM_STREET_KEYS);
  // The town around the area: a village's county, not the village again.
  const city = pick(NOMINATIM_CITY_KEYS.filter((key) => !sameText(address[key], area)));
  const postcode = clean(address.postcode);
  return (
    build(area, street, city, postcode) ??
    fromDisplayName(reply.display_name) ??
    (clean(reply.name) ? { area: null, label: clean(reply.name)! } : null)
  );
};

/** Reads Photon's reverse answer (first feature). */
export const parsePhoton = (body: unknown): PlaceName | null => {
  if (!isObject(body)) return null;
  const feature = (body as PhotonReverse).features?.[0];
  if (!isObject(feature?.properties)) return null;
  const props = feature.properties;
  const text = (key: string): string | null => clean(props[key]);

  const type = text('type');
  const name = text('name');
  // A street or an area may come back as the feature itself, named in `name`.
  const street = text('street') ?? (type === 'street' ? name : null);
  const area =
    text('district') ??
    text('locality') ??
    (type === 'district' || type === 'locality' ? name : null) ??
    text('city');
  const city = text('city') ?? text('county');
  const postcode = text('postcode');
  return build(area, street, city, postcode) ?? (name ? { area: null, label: name } : null);
};

/** `Street, Area, City Postcode`, skipping blanks and repeats. */
const build = (
  area: string | null,
  street: string | null,
  city: string | null,
  postcode: string | null,
): PlaceName | null => {
  const parts: string[] = [];
  const add = (part: string | null): void => {
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  };
  add(street);
  add(area);
  const cityPart = [city, postcode].filter(Boolean).join(' ');
  if (city && parts.some((p) => p.toLowerCase() === city.toLowerCase())) {
    // "Pune, Pune 411040" reads badly; keep the postcode alone.
    if (postcode) add(postcode);
  } else {
    add(cityPart || null);
  }
  if (parts.length === 0) return null;
  return { area: area ?? null, label: truncate(parts.join(', ')) };
};

/** `display_name` is long ("…, Pune, Maharashtra, 411040, India"): keep the first three parts. */
const fromDisplayName = (displayName: unknown): PlaceName | null => {
  const text = clean(displayName);
  if (!text) return null;
  const label = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  return label ? { area: null, label: truncate(label) } : null;
};

const sameText = (a: unknown, b: string | null): boolean =>
  b !== null && clean(a)?.toLowerCase() === b.toLowerCase();

const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  // No control characters or markup from a third party ends up on a photo or a screen.
  const text = value
    .replace(/[\p{Cc}<>]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > 0 ? text : null;
};

const truncate = (value: string): string =>
  value.length <= BUSINESS_RULE.PLACE_NAME_MAX_LENGTH
    ? value
    : `${value.slice(0, BUSINESS_RULE.PLACE_NAME_MAX_LENGTH - 1).trimEnd()}…`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
