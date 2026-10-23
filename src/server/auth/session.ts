import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { apiTokens, roles, sessions, users, type SessionStage, type User } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { clientIp, type AppContext, type AppEnv, type AuthContext } from '../context.js';
import { getSetting } from '../services/settings.js';
import { randomToken, sha256 } from './crypto.js';

export const SESSION_COOKIE = 'td_session';

/** Which step of the login flow the user must complete next. */
export async function nextStage(c: AppContext, user: User, mfaVerified: boolean): Promise<SessionStage> {
  if (user.mustChangePassword) return 'password_change';
  if (user.twoFactorEnabled) return mfaVerified ? 'full' : 'mfa_verify';
  if (await getSetting(c.var.deps.db, 'security.2fa_enforced')) return 'mfa_enroll';
  return 'full';
}

export async function issueSession(c: AppContext, user: User, stage: SessionStage): Promise<void> {
  const { db, config, clock } = c.var.deps;
  const token = randomToken();
  const ttlMs =
    stage === 'full' ? config.sessionTtlHours * 3600_000 : config.restrictedSessionTtlMinutes * 60_000;
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: user.id,
    stage,
    expiresAt: new Date(clock().getTime() + ttlMs),
    ip: clientIp(c),
    userAgent: c.req.header('user-agent')?.slice(0, 512),
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });
}

/** Replaces the current session (used after each completed login step). */
export async function replaceSession(c: AppContext, user: User, stage: SessionStage) {
  const current = c.var.auth?.sessionHash;
  if (current) await c.var.deps.db.delete(sessions).where(eq(sessions.tokenHash, current));
  await issueSession(c, user, stage);
}

export async function revokeAllSessions(c: AppContext, userId: number) {
  await c.var.deps.db.delete(sessions).where(eq(sessions.userId, userId));
}

export function clearSessionCookie(c: AppContext) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

async function permissionsFor(c: AppContext, roleKey: string): Promise<string[]> {
  const [role] = await c.var.deps.db.select({ p: roles.permissions }).from(roles).where(eq(roles.key, roleKey));
  return role?.p ?? [];
}

/** Resolves the caller from the session cookie or a `Bearer td_...` API token. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { db, clock, glossary } = c.var.deps;
  const now = clock();
  let auth: AuthContext | null = null;

  const authorization = c.req.header('authorization');
  if (authorization) {
    const token = authorization.match(/^Bearer\s+(td_\S+)$/)?.[1];
    if (!token) throw new ApiError(401, 'unauthorized');
    const [row] = await db
      .select({ token: apiTokens, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(
        and(
          eq(apiTokens.tokenHash, sha256(token)),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
          eq(users.isActive, true),
        ),
      );
    if (!row) throw new ApiError(401, 'unauthorized');
    if (!row.token.lastUsedAt || now.getTime() - row.token.lastUsedAt.getTime() > 60_000) {
      await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.token.id));
    }
    auth = {
      user: row.user,
      permissions: await permissionsFor(c, row.user.roleKey),
      stage: 'full',
      via: 'token',
      tokenId: row.token.id,
      tokenScopes: row.token.scopes,
    };
  } else {
    const cookie = getCookie(c, SESSION_COOKIE);
    if (cookie) {
      const hash = sha256(cookie);
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, now), eq(users.isActive, true)));
      if (row) {
        auth = {
          user: row.user,
          permissions: await permissionsFor(c, row.user.roleKey),
          stage: row.session.stage,
          via: 'session',
          sessionHash: hash,
        };
      } else {
        clearSessionCookie(c);
      }
    }
  }

  c.set('auth', auth);
  c.set('locale', auth ? glossary.resolveLocale(auth.user.locale) : glossary.fromAcceptLanguage(c.req.header('accept-language')));
  await next();
};

/**
 * Cookie-authenticated state-changing requests must carry `X-Requested-With: XMLHttpRequest`.
 * Browsers cannot add custom headers to cross-site form posts without a CORS preflight,
 * which this API never grants, so this blocks CSRF. Token-authenticated calls are exempt.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const safe = ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
  if (!safe && !c.req.header('authorization') && c.req.header('x-requested-with') !== 'XMLHttpRequest') {
    throw new ApiError(403, 'csrf_failed');
  }
  await next();
};

const STAGE_ERRORS: Record<Exclude<SessionStage, 'full'>, string> = {
  password_change: 'password_change_required',
  mfa_verify: 'mfa_required',
  mfa_enroll: 'mfa_enrollment_required',
};

interface GuardOptions {
  /** Session stages allowed; defaults to fully authenticated only. */
  stages?: SessionStage[];
  permission?: string;
  /** API token scope that grants access; when omitted API tokens are rejected. */
  tokenScope?: string;
}

export function guard(options: GuardOptions = {}): MiddlewareHandler<AppEnv> {
  const stages = options.stages ?? ['full'];
  return async (c, next) => {
    const auth = c.var.auth;
    if (!auth) throw new ApiError(401, 'unauthorized');
    if (auth.via === 'token') {
      if (!options.tokenScope || !auth.tokenScopes?.includes(options.tokenScope)) {
        throw new ApiError(403, 'insufficient_scope');
      }
    }
    if (!stages.includes(auth.stage)) {
      throw new ApiError(403, auth.stage === 'full' ? 'forbidden' : STAGE_ERRORS[auth.stage], undefined, {
        stage: auth.stage,
      });
    }
    if (options.permission && !(auth.permissions.includes('*') || auth.permissions.includes(options.permission))) {
      throw new ApiError(403, 'forbidden');
    }
    await next();
  };
}

/** Narrowing helper for handlers behind guard(). */
export function authOf(c: AppContext): AuthContext {
  const auth = c.var.auth;
  if (!auth) throw new ApiError(401, 'unauthorized');
  return auth;
}
