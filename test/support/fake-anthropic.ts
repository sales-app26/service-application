import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface ClaudeRequest {
  path: string;
  headers: IncomingMessage['headers'];
  body: {
    model: string;
    system?: unknown;
    messages: Array<{ role: string; content: unknown }>;
    fallbacks?: unknown;
    output_config?: { effort?: string; format?: { type: string; schema: unknown } };
  };
}

/**
 * Stands in for the Claude API (`POST /v1/messages`), so practice pitches never
 * reach the internet. The owner answers "Owner line N"; a scoring request (one
 * with a JSON output format) gets `score` back. Records what it was asked.
 */
export class FakeAnthropic {
  readonly requests: ClaudeRequest[] = [];
  /** The score the coach gives. */
  score = 82;
  /** 'ok' answers; 'refusal' declines (HTTP 200, stop_reason refusal); 'down' answers 400. */
  mode: 'ok' | 'refusal' | 'down' = 'ok';
  url = '';
  private server!: Server;
  private lines = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  reset(): void {
    this.requests.length = 0;
    this.mode = 'ok';
    this.score = 82;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'POST' || path !== '/v1/messages') {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ClaudeRequest['body'];
      this.requests.push({ path, headers: req.headers, body });

      if (this.mode === 'down') {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'no' },
          }),
        );
        return;
      }
      const scoring = body.output_config?.format?.type === 'json_schema';
      const text = scoring
        ? JSON.stringify({
            score: this.score,
            summary: 'You asked good questions and handled the delivery worry.',
            strengths: ['Asked how orders come in today'],
            improvements: ['Ask for the trial earlier'],
            criteria: [{ criterion: 'ignored', met: true, note: 'Asked about Zomato orders.' }],
          })
        : `Owner line ${++this.lines}`;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          id: `msg_${this.requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: this.mode === 'refusal' ? [] : [{ type: 'text', text }],
          stop_reason: this.mode === 'refusal' ? 'refusal' : 'end_turn',
          stop_sequence: null,
          stop_details:
            this.mode === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  }
}
