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
  /** Buckets made through the API, with whether they are public. */
  readonly buckets = new Map<string, { public: boolean }>();
  /** Web pushes received, by device. `/push/gone` answers 410, as a push service does. */
  readonly pushes: { device: string; encrypted: boolean; vapid: boolean }[] = [];
  readonly recoveries: string[] = [];
  /** What Brevo was asked to send; the fake stands in for its transactional API. */
  readonly emails: { to: string; subject: string; text: string }[] = [];
  private readonly refreshTokens = new Map<string, string>();
  /** One-time `token_hash` values minted by generate_link, spent by /verify. */
  private readonly linkTokens = new Map<string, string>();
  /** Invited logins whose email isn't confirmed yet: GoTrue refuses them a password sign-in. */
  private readonly unconfirmed = new Set<string>();
  private server!: Server;
  url = '';
  /**
   * Stands in for a database trigger on auth.users that refuses password
   * changes it was not told about (Pronttera Connect shares the project and
   * installs one). Answers whether this change may go ahead.
   */
  passwordGuard: ((userId: string) => Promise<boolean>) | null = null;

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

  private async passwordChangeAllowed(userId: string): Promise<boolean> {
    return this.passwordGuard ? this.passwordGuard(userId) : true;
  }

  /** Every token Supabase minted runs out, as they all do within a day. */
  expireLinks(): void {
    this.linkTokens.clear();
  }

  private mint(userId: string): string {
    const token = randomUUID();
    this.linkTokens.set(token, userId);
    return token;
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
    if (req.method === 'POST' && path === '/v3/smtp/email') {
      if (req.headers['api-key'] !== 'e2e-brevo-key')
        return send(res, 401, { message: 'Key not found' });
      const mail = json() as {
        to: { email: string }[];
        subject: string;
        textContent: string;
      };
      this.emails.push({ to: mail.to[0].email, subject: mail.subject, text: mail.textContent });
      return send(res, 201, { messageId: randomUUID() });
    }
    if (req.method === 'POST' && path.startsWith('/push/')) {
      const device = path.slice('/push/'.length);
      if (device === 'gone') return send(res, 410, {});
      this.pushes.push({
        device,
        encrypted: req.headers['content-encoding'] === 'aes128gcm' && body.length > 0,
        vapid: String(req.headers.authorization ?? '').startsWith('vapid '),
      });
      return send(res, 201, {});
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
        if (this.unconfirmed.has(user.id)) {
          return send(res, 400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
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

    // Supabase only mints the one-time token; Brevo (above) does the sending.
    if (req.method === 'POST' && path === '/admin/generate_link') {
      const { email, type } = json() as { email: string; type: 'invite' | 'recovery' };
      const existing = [...this.users.values()].find((user) => user.email === email);
      if (type === 'invite') {
        if (existing) {
          return send(res, 422, {
            error_code: 'email_exists',
            msg: 'A user with this email address has already been registered',
          });
        }
        const user = { id: randomUUID(), email, password: null };
        this.users.set(user.id, user);
        this.unconfirmed.add(user.id);
        this.invites.push(email);
        return send(res, 200, { id: user.id, email, hashed_token: this.mint(user.id) });
      }
      if (!existing) return send(res, 404, { error_code: 'user_not_found', msg: 'User not found' });
      this.recoveries.push(email);
      return send(res, 200, { id: existing.id, email, hashed_token: this.mint(existing.id) });
    }

    if (req.method === 'POST' && path === '/verify') {
      const { token_hash: tokenHash } = json() as { token_hash: string };
      const userId = this.linkTokens.get(tokenHash);
      if (!userId) {
        return send(res, 403, {
          error_code: 'otp_expired',
          msg: 'Token has expired or is invalid',
        });
      }
      this.linkTokens.delete(tokenHash); // single use
      this.unconfirmed.delete(userId);
      return send(res, 200, await this.session(userId));
    }

    if (req.method === 'POST' && path.startsWith('/logout')) {
      return send(res, 204, null);
    }

    if (req.method === 'PUT' && path === '/user') {
      const userId = await this.bearerSubject(req);
      if (!userId) return send(res, 401, { msg: 'invalid JWT' });
      if (!(await this.passwordChangeAllowed(userId))) return send(res, 500, GUARD_REFUSAL);
      this.setPassword(userId, String(json().password));
      return send(res, 200, { id: userId });
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
        const changes = json() as {
          email?: string;
          password?: string;
          email_confirm?: boolean;
        };
        if (changes.password && !(await this.passwordChangeAllowed(user.id))) {
          return send(res, 500, GUARD_REFUSAL);
        }
        if (changes.email) user.email = changes.email;
        if (changes.password) user.password = changes.password;
        if (changes.email_confirm) this.unconfirmed.delete(user.id);
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
    if (req.method === 'POST' && path === '/bucket') {
      const { id, public: isPublic } = json() as { id: string; public: boolean };
      if (this.buckets.has(id)) {
        return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'already exists' });
      }
      this.buckets.set(id, { public: isPublic });
      return send(res, 200, { name: id });
    }
    // The default bucket always exists; any other must have been made first.
    const bucket = /^\/object\/(?:sign\/)?([^/]+)/u.exec(path)?.[1] ?? this.bucket;
    if (bucket !== this.bucket && !this.buckets.has(bucket)) {
      return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Bucket not found' });
    }
    const signPrefix = `/object/sign/${bucket}`;
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

    const objectPrefix = `/object/${bucket}`;
    if (req.method === 'DELETE' && path === objectPrefix) {
      for (const prefix of (json() as { prefixes: string[] }).prefixes) this.objects.delete(prefix);
      return send(res, 200, []);
    }
    if (req.method === 'POST' && path.startsWith(`${objectPrefix}/`)) {
      const key = path.slice(objectPrefix.length + 1);
      if (this.objects.has(key))
        return send(res, 400, { error: 'Duplicate', message: 'The resource already exists' });
      this.objects.set(key, { body, contentType: String(req.headers['content-type']) });
      return send(res, 200, { Key: `${bucket}/${key}` });
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

/** What Supabase answers when such a trigger raises. */
const GUARD_REFUSAL = {
  error_code: 'unexpected_failure',
  msg: 'ERROR: Passwords can only be changed by an administrator (SQLSTATE 42501)',
};
