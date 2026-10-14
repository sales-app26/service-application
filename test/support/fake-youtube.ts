import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

/**
 * Stands in for YouTube's playlist feed (`GET /feeds/videos.xml?playlist_id=`), so saving a
 * playlist lesson never reaches the internet. A playlist it doesn't know answers 404, as a
 * private or deleted one does on YouTube.
 */
export class FakeYoutube {
  readonly playlists = new Map<string, Array<{ id: string; title: string }>>();
  readonly requests: string[] = [];
  url = '';
  private server!: Server;

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/feeds/videos.xml`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const id = url.searchParams.get('playlist_id') ?? '';
    this.requests.push(id);
    const videos = url.pathname === '/feeds/videos.xml' ? this.playlists.get(id) : undefined;
    if (!videos) {
      res.writeHead(404).end();
      return;
    }
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const entries = videos
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
}
