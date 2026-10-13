import { Injectable } from '@nestjs/common';

import { BUSINESS_RULE, COMMON_ERROR, ERROR_CODE } from '../../common/constants';
import { BusinessException } from '../../common/exceptions/business.exception';

const WINDOW_MS = 60_000;
/** Past this many people tracked, idle ones are swept out. */
const SWEEP_AT = 1_000;

/**
 * Place lookups per person per minute (`GET /geo/reverse`). Per person rather than
 * per address: a team on one office Wi-Fi shares an address. In memory, like the
 * geocoder's own queue; a second API instance keeps its own count.
 */
@Injectable()
export class GeoLookupLimiter {
  private readonly recent = new Map<string, number[]>();
  /** The clock; replaced in unit tests. */
  now: () => number = () => Date.now();

  /** Counts one lookup for this person, or throws 429 when the minute is used up. */
  take(userId: string): void {
    const now = this.now();
    const since = now - WINDOW_MS;
    if (this.recent.size > SWEEP_AT) this.sweep(since);

    const times = (this.recent.get(userId) ?? []).filter((at) => at > since);
    if (times.length >= BUSINESS_RULE.GEO_LOOKUPS_PER_MINUTE) {
      this.recent.set(userId, times);
      throw new BusinessException(COMMON_ERROR.RATE_LIMITED, ERROR_CODE.RATE_LIMITED);
    }
    times.push(now);
    this.recent.set(userId, times);
  }

  private sweep(since: number): void {
    for (const [userId, times] of this.recent) {
      if (!times.some((at) => at > since)) this.recent.delete(userId);
    }
  }
}
