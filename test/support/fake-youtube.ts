import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * Stands in for YouTube, so saving a playlist lesson never reaches the internet. It answers
 * both ways the app lists a playlist:
 *
 * - the public feed (`GET /feeds/videos.xml?playlist_id=`), which, like YouTube's, lists only
 *   the first 15 videos;
 * - the Data API (`GET /youtube/v3/playlistItems`), page by page, with `apiKey` as its key.
 *
 * A playlist it doesn't know answers 404, as a private or deleted one does on YouTube.
 */
export class FakeYoutube {
  /** YouTube's own cap on the public feed. */
  static readonly FEED_LIMIT = 15;

  readonly playlists = new Map<string, Array<{ id: string; title: string }>>();
  /** Every playlist id asked for, by either route. */
  readonly requests: string[] = [];
  readonly apiKey = 'fake-youtube-api-key';
  /** Videos per Data API page. YouTube's is 50; tests lower it to exercise paging. */
  pageSize = 50;
  /** When true the Data API refuses every call, as it does once the day's quota is spent. */
  apiDown = false;
  url = '';
  apiUrl = '';
  private server!: Server;

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    this.url = `${base}/feeds/videos.xml`;
    this.apiUrl = `${base}/youtube/v3`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/youtube/v3/playlistItems') return this.api(url, res);
    const id = url.searchParams.get('playlist_id') ?? '';
    this.requests.push(id);
    const videos = url.pathname === '/feeds/videos.xml' ? this.playlists.get(id) : undefined;
    if (!videos) {
      res.writeHead(404).end();
      return;
    }
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const entries = videos
      .slice(0, FakeYoutube.FEED_LIMIT)
      .map(
        (v) =>
          `<entry><id>yt:video:${v.id}</id><yt:videoId>${v.id}</yt:videoId><title>${escape(v.title)}</title></entry>`,
      )
      .join('');
    res
      .writeHead(200, { 'Content-Type': 'application/atom+xml; charset=UTF-8' })
      .end(
        `<?xml version="1.0" encoding="UTF-8"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Frostique app tutorial</title>${entries}</feed>`,
      );
  }

  private api(url: URL, res: ServerResponse): void {
    const id = url.searchParams.get('playlistId') ?? '';
    this.requests.push(id);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };
    if (this.apiDown) return json(403, { error: { code: 403, message: 'quotaExceeded' } });
    if (url.searchParams.get('key') !== this.apiKey) {
      return json(400, { error: { code: 400, message: 'API key not valid' } });
    }
    const videos = this.playlists.get(id);
    if (!videos) return json(404, { error: { code: 404, message: 'playlistNotFound' } });
    const size = Math.min(this.pageSize, Number(url.searchParams.get('maxResults') ?? 5));
    const start = Number(url.searchParams.get('pageToken') ?? 0);
    const page = videos.slice(start, start + size);
    json(200, {
      items: page.map((v) => ({
        snippet: { title: v.title, resourceId: { kind: 'youtube#video', videoId: v.id } },
        status: { privacyStatus: 'public' },
      })),
      ...(start + size < videos.length ? { nextPageToken: String(start + size) } : {}),
    });
  }
}
