import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CONFIG_NAMESPACE } from '../../common/constants';
import { TrainingConfig } from '../../config/configuration';
import { parsePlaylistFeed, PlaylistItem } from './training-rules';

/**
 * Lists a YouTube playlist's videos from its public RSS feed: no API key, no quota. Asked
 * once, when a playlist lesson is saved; reps never wait on it. Returns null when YouTube
 * doesn't list the playlist (private, deleted, or unreachable), and the app then plays the
 * playlist in YouTube's own player instead of listing its modules.
 */
@Injectable()
export class YoutubePlaylistClient {
  private readonly logger = new Logger(YoutubePlaylistClient.name);
  private readonly feedUrl: string;

  constructor(configService: ConfigService) {
    this.feedUrl = configService.getOrThrow<TrainingConfig>(
      CONFIG_NAMESPACE.TRAINING,
    ).youtubeFeedUrl;
  }

  async list(playlistId: string): Promise<{ title: string | null; items: PlaylistItem[] } | null> {
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
