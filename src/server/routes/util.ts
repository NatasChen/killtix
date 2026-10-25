import type { z } from 'zod';
import type { User } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import type { AppContext } from '../context.js';

export async function parseJson<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  return parseWith(schema, body);
}

export function parseWith<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(undefined, {
      errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export function idParam(c: AppContext, name = 'id'): number {
  const id = Number(c.req.param(name));
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

export async function rateLimit(c: AppContext, key: string, limit: number, windowSeconds = 60) {
  const result = await c.var.deps.rateLimiter.hit(key, limit, windowSeconds);
  c.header('X-RateLimit-Limit', String(result.limit));
  c.header('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    c.header('Retry-After', String(result.resetSeconds));
    throw new ApiError(429, 'rate_limited');
  }
}

export function publicUser(u: User, teamIds: number[] = []) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.roleKey,
    teamIds,
    locale: u.locale,
    theme: u.theme,
    twoFactorEnabled: u.twoFactorEnabled,
    mustChangePassword: u.mustChangePassword,
    isBootstrapAdmin: u.isBootstrapAdmin,
    telegramChatId: u.telegramChatId,
  };
}

export const userSummary = (u: Pick<User, 'id' | 'displayName' | 'email'> | null | undefined) =>
  u ? { id: u.id, displayName: u.displayName, email: u.email } : null;
