import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createApp } from '../src/server/app.js';
import { createSecretBox, hashPassword } from '../src/server/auth/crypto.js';
import { loadConfig } from '../src/server/config.js';
import type { Deps } from '../src/server/context.js';
import { connectPostgres, type DB } from '../src/server/db/client.js';
import * as schema from '../src/server/db/schema.js';
import { seed } from '../src/server/db/seed.js';
import { Glossary } from '../src/server/i18n/index.js';
import { memoryRateLimiter } from '../src/server/services/rateLimit.js';

export const ADMIN_PASSWORD = 'Admin@InitTemp2026!';
export const STRONG_PASSWORD = 'N3w-Str0ng-Passw0rd!';

export class TestClock {
  constructor(public now = new Date('2026-03-02T02:00:00Z')) {}
  advance(ms: number) {
    this.now = new Date(this.now.getTime() + ms);
  }
  read = () => this.now;
}

const MIGRATIONS = new URL('../drizzle', import.meta.url).pathname;

/**
 * In-process PGlite by default. Set TEST_DATABASE_URL (a Postgres server URL) to run the same
 * tests against real PostgreSQL through the production postgres-js driver; each context then
 * gets its own throwaway database.
 */
async function openDatabase(): Promise<{ db: DB; close: () => Promise<void> }> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) {
    const pg = new PGlite();
    await migrate(drizzle(pg), { migrationsFolder: MIGRATIONS });
    return { db: drizzle(pg, { schema }) as unknown as DB, close: () => pg.close() };
  }
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  const name = `td_test_${randomBytes(6).toString('hex')}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const { db, close } = await connectPostgres(url.toString(), MIGRATIONS);
  return {
    db,
    close: async () => {
      await close();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export async function createTestContext(env: Record<string, string> = {}) {
  const { db, close } = await openDatabase();
  const config = loadConfig({
    DATABASE_URL: 'pglite://memory',
    APP_SECRET: 'test-secret-test-secret-test-secret-123',
    BCRYPT_COST: '4',
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
    APP_URL: 'http://localhost:8080',
    LOGIN_RATE_LIMIT_PER_MIN: '1000',
    ...env,
  });
  await seed(db, config);
  const glossary = new Glossary(config.defaultLocale);
  await glossary.load(db);
  const clock = new TestClock();
  const deps: Deps = {
    db,
    config,
    glossary,
    rateLimiter: memoryRateLimiter(clock.read),
    secretBox: createSecretBox(config.appSecret),
    clock: clock.read,
  };
  const app = createApp(deps);

  const ctx = {
    db,
    deps,
    app,
    clock,
    /** Browser-like client that keeps its own session cookie. */
    client() {
      let cookie: string | undefined;
      const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const res = await app.request(path, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            ...(cookie ? { cookie } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
          const value = setCookie.split(';')[0];
          cookie = value.endsWith('=') ? undefined : value;
        }
        const text = await res.text();
        let json: any;
        try {
          json = text ? JSON.parse(text) : undefined;
        } catch {
          json = undefined;
        }
        return { status: res.status, body: json, text, headers: res.headers };
      };
      return {
        get: (path: string, headers?: Record<string, string>) => call('GET', path, undefined, headers),
        post: (path: string, body?: unknown, headers?: Record<string, string>) => call('POST', path, body ?? {}, headers),
        patch: (path: string, body: unknown) => call('PATCH', path, body),
        del: (path: string) => call('DELETE', path),
        raw: call,
        get cookie() {
          return cookie;
        },
        set cookie(v) {
          cookie = v;
        },
      };
    },
    /** API-token client (no cookies, no CSRF header). */
    tokenClient(token: string) {
      const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const res = await app.request(path, {
          method,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
      };
      return {
        get: (path: string) => call('GET', path),
        post: (path: string, body: unknown, headers?: Record<string, string>) => call('POST', path, body, headers),
      };
    },
    /** Creates an active user with a known password that does not need changing. */
    async createUser(email: string, role: string, extra: Partial<typeof schema.users.$inferInsert> = {}) {
      const [user] = await db
        .insert(schema.users)
        .values({
          email,
          displayName: email.split('@')[0],
          roleKey: role,
          passwordHash: await hashPassword(STRONG_PASSWORD, 4),
          ...extra,
        })
        .returning();
      return user;
    },
    async login(email: string, password = STRONG_PASSWORD) {
      const client = ctx.client();
      const res = await client.post('/api/v1/auth/login', { email, password });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${res.text}`);
      return client;
    },
    /** Signs in as the bootstrap admin and completes the forced password change. */
    async adminClient() {
      const client = ctx.client();
      await client.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });
      const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, 'admin@ticket.local'));
      if (admin.mustChangePassword) {
        const res = await client.post('/api/v1/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: STRONG_PASSWORD });
        if (res.status !== 200) throw new Error(`admin password change failed: ${res.text}`);
      } else {
        await client.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: STRONG_PASSWORD });
      }
      return client;
    },
    close,
  };
  return ctx;
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
