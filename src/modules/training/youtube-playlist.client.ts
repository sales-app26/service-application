import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BUSINESS_RULE, CONFIG_NAMESPACE } from '../../common/constants';
import { TrainingConfig } from '../../config/configuration';
import { parsePlaylistFeed, parsePlaylistItemsPage, PlaylistItem } from './training-rules';

/** The most videos the Data API returns per page. */
const API_PAGE_SIZE = 50;
/** A stop for a playlist that is mostly private videos, so paging can't run on. */
const API_MAX_PAGES = 10;

/**
 * Lists a YouTube playlist's videos. Asked once, when a playlist lesson is saved; reps never
 * wait on it.
 *
 * With a YouTube Data API key it reads every video, up to the module cap (50 a page, 1 quota
 * unit a page). Without a key, or when the API refuses (bad key, quota spent, unreachable), it
 * reads the public RSS feed instead: no key and no quota, but YouTube only ever puts a
 * playlist's first 15 videos in it.
 *
 * Returns null when YouTube doesn't list the playlist (private, deleted, or unreachable), and
 * the app then plays the playlist in YouTube's own player instead of listing its modules.
 */
@Injectable()
export class YoutubePlaylistClient {
  private readonly logger = new Logger(YoutubePlaylistClient.name);
  private readonly feedUrl: string;
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<TrainingConfig>(CONFIG_NAMESPACE.TRAINING);
    this.feedUrl = config.youtubeFeedUrl;
    this.apiUrl = config.youtubeApiUrl;
    this.apiKey = config.youtubeApiKey;
  }

  async list(playlistId: string): Promise<{ title: string | null; items: PlaylistItem[] } | null> {
    if (this.apiKey) {
      const listed = await this.fromApi(playlistId);
      if (listed) return listed;
    }
    return this.fromFeed(playlistId);
  }

  /** Every video through the Data API, page by page. Null on any failure, so the feed gets a go. */
  private async fromApi(
    playlistId: string,
  ): Promise<{ title: string | null; items: PlaylistItem[] } | null> {
    const items: PlaylistItem[] = [];
    let pageToken: string | null = null;
    try {
      for (let page = 0; page < API_MAX_PAGES; page += 1) {
        const query = new URLSearchParams({
          part: 'snippet,status',
          playlistId,
          maxResults: String(API_PAGE_SIZE),
          key: this.apiKey,
        });
        if (pageToken) query.set('pageToken', pageToken);
        const res = await fetch(`${this.apiUrl}/playlistItems?${query.toString()}`, {
          signal: AbortSignal.timeout(6_000),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          this.logger.warn(`Playlist ${playlistId} API -> ${res.status}; trying the feed`);
          return null;
        }
        const listed = parsePlaylistItemsPage(await res.json());
        items.push(...listed.items);
        pageToken = listed.nextPageToken;
        if (!pageToken || items.length >= BUSINESS_RULE.PLAYLIST_MAX_ITEMS) break;
      }
    } catch (error) {
      this.logger.warn(
        `Playlist ${playlistId} API failed: ${(error as Error).message}; trying the feed`,
      );
      return null;
    }
    return items.length > 0 ? { title: null, items } : null;
  }

  private async fromFeed(
    playlistId: string,
  ): Promise<{ title: string | null; items: PlaylistItem[] } | null> {
    try {
      const res = await fetch(`${this.feedUrl}?playlist_id=${encodeURIComponent(playlistId)}`, {
        signal: AbortSignal.timeout(6_000),
        headers: { Accept: 'application/atom+xml, application/xml, text/xml' },
      });
      if (!res.ok) {
        this.logger.warn(`Playlist ${playlistId} feed -> ${res.status}`);
        return null;
      }
      const feed = parsePlaylistFeed(await res.text());
      return feed.items.length > 0 ? feed : null;
    } catch (error) {
      this.logger.warn(`Playlist ${playlistId} feed failed: ${(error as Error).message}`);
      return null;
    }
  }
}
