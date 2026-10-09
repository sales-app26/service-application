import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { jwtVerify, SignJWT } from 'jose';

interface AuthUser {
  id: string;
  email: string;
  password: string | null;
}

/**
 * Just enough of Supabase Auth and Storage for the e2e suite, signing real
 * HS256 tokens with the secret the API is configured with — so the API's own
 * verification path runs unmodified.
 */
export class FakeSupabase {
  readonly users = new Map<string, AuthUser>();
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  readonly invites: string[] = [];
  readonly recoveries: string[] = [];
  private readonly refreshTokens = new Map<string, string>();
  private server!: Server;
  url = '';

  constructor(
    private readonly jwtSecret: string,
    readonly bucket: string,
  ) {}

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error: Error) => send(res, 500, { msg: error.message }));
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** A confirmed login with a password, as the seed or a completed invite leaves it. */
  addUser(email: string, password: string, id: string = randomUUID()): AuthUser {
    const user = { id, email, password };
    this.users.set(id, user);
    return user;
  }

  setPassword(userId: string, password: string): void {
    const user = this.users.get(userId);
    if (user) user.password = password;
  }

  async accessToken(userId: string, options: { expiresIn?: string } = {}): Promise<string> {
    const user = this.users.get(userId);
    return new SignJWT({ email: user?.email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(`${this.url}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '1h')
      .sign(new TextEncoder().encode(this.jwtSecret));
  }

  // ------------------------------------------------------------------ routing

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const body = await readBody(req);
    const json = () =>
      body.length ? (JSON.parse(body.toString('utf8')) as Record<string, unknown>) : {};
    const path = url.pathname;

    if (path.startsWith('/auth/v1')) {
      return this.auth(req, res, path.slice('/auth/v1'.length), url, json);
    }
    if (path.startsWith('/storage/v1')) {
      return this.storage(
        req,
        res,
        decodeURIComponent(path.slice('/storage/v1'.length)),
        body,
        json,
      );
    }
    send(res, 404, { msg: 'not found' });
  }

  private async auth(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
    json: () => Record<string, unknown>,
  ): Promise<void> {
    if (req.method === 'POST' && path === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const { email, password } = json() as { email: string; password: string };
        const user = [...this.users.values()].find((candidate) => candidate.email === email);
        if (!user || !user.password || user.password !== password) {
          return send(res, 400, {
            error_code: 'invalid_credentials',
            msg: 'Invalid login credentials',
          });
        }
        return send(res, 200, await this.session(user.id));
      }
      if (grant === 'refresh_token') {
        const userId = this.refreshTokens.get(String(json().refresh_token));
        if (!userId)
          return send(res, 400, {
            error_code: 'refresh_token_not_found',
            msg: 'Invalid Refresh Token',
          });
        return send(res, 200, await this.session(userId));
      }
    }

    if (req.method === 'POST' && path === '/recover') {
      this.recoveries.push(String(json().email));
      return send(res, 200, {});
    }

    if (req.method === 'POST' && path.startsWith('/logout')) {
      return send(res, 204, null);
    }

    if (req.method === 'PUT' && path === '/user') {
      const userId = await this.bearerSubject(req);
      if (!userId) return send(res, 401, { msg: 'invalid JWT' });
      this.setPassword(userId, String(json().password));
      return send(res, 200, { id: userId });
    }

    if (req.method === 'POST' && path === '/invite') {
      const { email } = json() as { email: string };
      if ([...this.users.values()].some((user) => user.email === email)) {
        return send(res, 422, {
          error_code: 'email_exists',
          msg: 'A user with this email address has already been registered',
        });
      }
      const user = { id: randomUUID(), email, password: null };
      this.users.set(user.id, user);
      this.invites.push(email);
      return send(res, 200, { id: user.id, email });
    }

    if (req.method === 'POST' && path === '/admin/users') {
      const { email, password } = json() as { email: string; password: string };
      return send(res, 200, this.addUser(email, password));
    }

    const adminUser = /^\/admin\/users\/([^/]+)$/u.exec(path);
    if (adminUser) {
      const user = this.users.get(adminUser[1]);
      if (!user) return send(res, 404, { msg: 'User not found' });
      if (req.method === 'PUT') {
        const changes = json() as { email?: string; password?: string };
        if (changes.email) user.email = changes.email;
        if (changes.password) user.password = changes.password;
        return send(res, 200, { id: user.id, email: user.email });
      }
      if (req.method === 'DELETE') {
        this.users.delete(user.id);
        return send(res, 200, {});
      }
    }

    if (path === '/.well-known/jwks.json') {
      return send(res, 200, { keys: [] });
    }

    send(res, 404, { msg: `no fake for ${req.method} ${path}` });
  }

  private storage(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    body: Buffer,
    json: () => Record<string, unknown>,
  ): void {
    const signPrefix = `/object/sign/${this.bucket}`;
    if (req.method === 'POST' && path === signPrefix) {
      const { paths } = json() as { paths: string[] };
      return send(
        res,
        200,
        paths.map((objectPath) => ({
          path: objectPath,
          signedURL: this.objects.has(objectPath) ? `${signPrefix}/${objectPath}?token=fake` : null,
          error: this.objects.has(objectPath) ? null : 'Object not found',
        })),
      );
    }

    // A signed link, as a browser follows it: the stored bytes with their content type.
    if (req.method === 'GET' && path.startsWith(`${signPrefix}/`)) {
      const stored = this.objects.get(decodeURIComponent(path.slice(signPrefix.length + 1)));
      if (!stored) return send(res, 404, { error: 'not_found', message: 'Object not found' });
      res.writeHead(200, {
        'content-type': stored.contentType,
        'access-control-allow-origin': '*',
      });
      res.end(stored.body);
      return;
    }

    const objectPrefix = `/object/${this.bucket}`;
    if (req.method === 'DELETE' && path === objectPrefix) {
      for (const prefix of (json() as { prefixes: string[] }).prefixes) this.objects.delete(prefix);
      return send(res, 200, []);
    }
    if (req.method === 'POST' && path.startsWith(`${objectPrefix}/`)) {
      const key = path.slice(objectPrefix.length + 1);
      if (this.objects.has(key))
        return send(res, 400, { error: 'Duplicate', message: 'The resource already exists' });
      this.objects.set(key, { body, contentType: String(req.headers['content-type']) });
      return send(res, 200, { Key: `${this.bucket}/${key}` });
    }

    send(res, 404, { msg: `no fake for ${req.method} ${path}` });
  }

  private async session(userId: string) {
    const refreshToken = randomUUID();
    this.refreshTokens.set(refreshToken, userId);
    return {
      access_token: await this.accessToken(userId),
      refresh_token: refreshToken,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: userId, email: this.users.get(userId)?.email },
    };
  }

  private async bearerSubject(req: IncomingMessage): Promise<string | null> {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer /u, '');
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.jwtSecret));
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const send = (res: ServerResponse, status: number, payload: unknown): void => {
  if (payload === null) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload));
};
