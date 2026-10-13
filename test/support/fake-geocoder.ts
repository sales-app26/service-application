import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface GeoRequest {
  service: 'nominatim' | 'photon';
  lat: number;
  lon: number;
  userAgent: string;
}

/**
 * Stands in for OpenStreetMap's Nominatim and Photon, so no test ever reaches the
 * internet. Answers every position with a street in Wanowrie, Pune, unless told
 * otherwise; records what it was asked.
 */
export class FakeGeocoder {
  readonly requests: GeoRequest[] = [];
  /** 'ok' answers; 'down' answers 503; 'hang' never answers (the API must give up). */
  nominatim: 'ok' | 'down' | 'hang' = 'ok';
  photon: 'ok' | 'down' | 'hang' = 'ok';
  private server!: Server;
  private readonly hanging = new Set<ServerResponse>();
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const res of this.hanging) res.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get nominatimUrl(): string {
    return `${this.url}/nominatim`;
  }

  get photonUrl(): string {
    return `${this.url}/photon`;
  }

  reset(): void {
    this.requests.length = 0;
    this.nominatim = 'ok';
    this.photon = 'ok';
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.url);
    const service = url.pathname === '/nominatim/reverse' ? 'nominatim' : 'photon';
    if (!url.pathname.endsWith('/reverse')) {
      res.writeHead(404).end();
      return;
    }
    this.requests.push({
      service,
      lat: Number(url.searchParams.get('lat')),
      lon: Number(url.searchParams.get('lon')),
      userAgent: String(req.headers['user-agent']),
    });

    const mode = this[service];
    if (mode === 'hang') {
      this.hanging.add(res);
      return;
    }
    if (mode === 'down') {
      res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Service unavailable');
      return;
    }
    const body =
      service === 'nominatim'
        ? {
            display_name: 'Wanowrie Road, Wanowrie, Pune, Maharashtra, 411040, India',
            address: {
              road: 'Wanowrie Road',
              suburb: 'Wanowrie',
              city: 'Pune',
              state: 'Maharashtra',
              postcode: '411040',
              country: 'India',
            },
          }
        : {
            type: 'FeatureCollection',
            features: [
              {
                properties: {
                  type: 'street',
                  name: 'NIBM Road',
                  district: 'Kondhwa',
                  city: 'Pune',
                  postcode: '411048',
                },
              },
            ],
          };
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  }
}
