import type { Context } from 'hono';
import type { SecretBox } from './auth/crypto.js';
import type { Config } from './config.js';
import type { DB } from './db/client.js';
import type { SessionStage, User } from './db/schema.js';
import type { Glossary } from './i18n/index.js';
import type { RateLimiter } from './services/rateLimit.js';

export interface Deps {
  db: DB;
  config: Config;
  glossary: Glossary;
  rateLimiter: RateLimiter;
  secretBox: SecretBox;
  clock: () => Date;
}

export interface AuthContext {
  user: User;
  permissions: string[];
  stage: SessionStage;
  via: 'session' | 'token';
  sessionHash?: string;
  tokenId?: number;
  tokenScopes?: string[];
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    auth: AuthContext | null;
    locale: string;
  };
};

export type AppContext = Context<AppEnv>;

export function clientIp(c: AppContext): string {
  if (c.var.deps.config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  // Populated by @hono/node-server; absent under app.request() in tests.
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}
