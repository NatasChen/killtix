import { and, asc, count, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword, randomPassword, randomToken, sha256 } from '../auth/crypto.js';
import { authOf, guard, revokeAllSessions } from '../auth/session.js';
import type { AppContext, AppEnv } from '../context.js';
import {
  apiTokens,
  auditLogs,
  cannedResponses,
  customFields,
  FIELD_TYPES,
  glossaryTerms,
  helpTopics,
  LOGO_VARIANTS,
  notificationLogs,
  roles,
  sessions,
  slaPlans,
  tags,
  teams,
  ticketForms,
  users,
} from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import { SUPPORTED_LOCALES } from '../i18n/index.js';
import { audit } from '../services/audit.js';
import { deleteLogo, LOGO_MAX_BYTES, logoUrls, setLogo } from '../services/branding.js';
import { getSetting, setSetting } from '../services/settings.js';
import { idParam, parseJson, parseWith, publicUser } from './util.js';

const ROLE_KEYS = ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user'] as const;
const TOKEN_SCOPES = ['tickets:read', 'tickets:write'] as const;

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(128);
const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const tagList = z.array(z.string().trim().min(1).max(64)).max(20);

/** Postgres unique violations become 409 instead of 500. */
async function unique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
      if ((e as { code?: string }).code === '23505') throw new ApiError(409, 'conflict');
    }
    throw err;
  }
}

function regexIsValid(pattern: string | null | undefined) {
  if (!pattern) return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

async function activeSuperAdmins(c: AppContext) {
  const [{ n }] = await c.var.deps.db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.roleKey, 'super_admin'), eq(users.isActive, true)));
  return n;
}

const manageUsers = guard({ permission: 'admin:users' });
const manageCatalog = guard({ permission: 'catalog:manage' });
const manageSystem = guard({ permission: 'admin:settings' });

export const adminRoutes = new Hono<AppEnv>()
  // ------------------------------------------------------------------ users
  .get('/users', manageUsers, async (c) => {
    const q = c.req.query('q')?.trim();
    const rows = await c.var.deps.db
      .select()
      .from(users)
      .where(
        and(
          ne(users.roleKey, 'api_client'),
          q ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(asc(users.email))
      .limit(500);
    return c.json(rows.map((u) => ({ ...publicUser(u), isActive: u.isActive, lockedUntil: u.lockedUntil, lastLoginAt: u.lastLoginAt, identityProvider: u.identityProvider })));
  })

  .post('/users', manageUsers, async (c) => {
    const { db, config } = c.var.deps;
    const body = await parseJson(
      c,
      z.object({
        email: z.email().max(255),
        displayName: name,
        role: z.enum(ROLE_KEYS),
        teamId: id.nullable().optional(),
      }),
    );
    // New accounts get a one-time password and must change it at first login.
    const temporaryPassword = randomPassword();
    const passwordHash = await hashPassword(temporaryPassword, config.bcryptCost);
    const [user] = await unique(() =>
      db
        .insert(users)
        .values({
          email: body.email.toLowerCase(),
          displayName: body.displayName,
          roleKey: body.role,
          teamId: body.teamId ?? null,
          passwordHash,
          mustChangePassword: true,
          locale: config.defaultLocale,
        })
        .returning(),
    );
    await audit(c, 'admin.user_created', { type: 'user', id: user.id }, { role: body.role });
    return c.json({ user: publicUser(user), temporaryPassword }, 201);
  })

  .patch('/users/:id', manageUsers, async (c) => {
    const { db } = c.var.deps;
    const auth = authOf(c);
    const userId = idParam(c);
    const body = await parseJson(
      c,
      z
        .object({
          displayName: name.optional(),
          role: z.enum(ROLE_KEYS).optional(),
          teamId: id.nullable().optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    );
    const [target] = await db.select().from(users).where(eq(users.id, userId));
    if (!target || target.roleKey === 'api_client') throw notFound();
    const demotesAdmin =
      target.roleKey === 'super_admin' && target.isActive && ((body.role && body.role !== 'super_admin') || body.isActive === false);
    // Never leave the system without an active super admin.
    if (demotesAdmin && (await activeSuperAdmins(c)) <= 1) throw new ApiError(409, 'last_super_admin');
    if (userId === auth.user.id && (body.isActive === false || (body.role && body.role !== target.roleKey))) {
      throw new ApiError(409, 'cannot_modify_self');
    }
    const [updated] = await db
      .update(users)
      .set({ displayName: body.displayName, roleKey: body.role, teamId: body.teamId, isActive: body.isActive })
      .where(eq(users.id, userId))
      .returning();
    if (body.isActive === false || body.role) await db.delete(sessions).where(eq(sessions.userId, userId));
    await audit(c, 'admin.user_updated', { type: 'user', id: userId }, body);
    return c.json(publicUser(updated));
  })

  .post('/users/:id/reset-password', manageUsers, async (c) => {
    const { db, config } = c.var.deps;
    const userId = idParam(c);
    const temporaryPassword = randomPassword();
    const [updated] = await db
      .update(users)
      .set({
        passwordHash: await hashPassword(temporaryPassword, config.bcryptCost),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(and(eq(users.id, userId), ne(users.roleKey, 'api_client')))
      .returning();
    if (!updated) throw notFound();
    await revokeAllSessions(c, userId);
    await audit(c, 'admin.password_reset', { type: 'user', id: userId });
    return c.json({ temporaryPassword });
  })

  .post('/users/:id/reset-2fa', manageUsers, async (c) => {
    const userId = idParam(c);
    const [updated] = await c.var.deps.db
      .update(users)
      .set({ twoFactorEnabled: false, totpSecret: null, totpPendingSecret: null, recoveryCodeHashes: [] })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw notFound();
    await revokeAllSessions(c, userId);
    await audit(c, 'admin.2fa_reset', { type: 'user', id: userId });
    return c.body(null, 204);
  })

  .post('/users/:id/unlock', manageUsers, async (c) => {
    const userId = idParam(c);
    await c.var.deps.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
    await audit(c, 'admin.user_unlocked', { type: 'user', id: userId });
    return c.body(null, 204);
  })

  .get('/roles', manageUsers, async (c) => c.json(await c.var.deps.db.select().from(roles).orderBy(asc(roles.key))))

  // ------------------------------------------------------------------ teams
  .get('/teams', manageCatalog, async (c) => c.json(await c.var.deps.db.select().from(teams).orderBy(asc(teams.name))))
  .post('/teams', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name, description: z.string().max(2000).optional() }));
    const [row] = await unique(() => c.var.deps.db.insert(teams).values(body).returning());
    await audit(c, 'admin.team_created', { type: 'team', id: row.id });
    return c.json(row, 201);
  })
  .patch('/teams/:id', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name: name.optional(), description: z.string().max(2000).nullable().optional() }).strict());
    const [row] = await unique(() => c.var.deps.db.update(teams).set(body).where(eq(teams.id, idParam(c))).returning());
    if (!row) throw notFound();
    return c.json(row);
  })

  // ------------------------------------------------------------------ SLA plans
  .get('/sla-plans', manageCatalog, async (c) => c.json(await c.var.deps.db.select().from(slaPlans).orderBy(asc(slaPlans.id))))
  .post('/sla-plans', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z.object({ name, firstResponseMinutes: z.number().int().min(1).max(525_600), resolutionMinutes: z.number().int().min(1).max(525_600) }),
    );
    const [row] = await unique(() => c.var.deps.db.insert(slaPlans).values(body).returning());
    await audit(c, 'admin.sla_plan_created', { type: 'sla_plan', id: row.id });
    return c.json(row, 201);
  })
  .patch('/sla-plans/:id', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z
        .object({
          name: name.optional(),
          firstResponseMinutes: z.number().int().min(1).max(525_600).optional(),
          resolutionMinutes: z.number().int().min(1).max(525_600).optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    );
    const [row] = await unique(() => c.var.deps.db.update(slaPlans).set(body).where(eq(slaPlans.id, idParam(c))).returning());
    if (!row) throw notFound();
    return c.json(row);
  })

  // ------------------------------------------------------------------ forms & custom fields
  .get('/forms', manageCatalog, async (c) => {
    const { db } = c.var.deps;
    const forms = await db.select().from(ticketForms).orderBy(asc(ticketForms.name));
    const fields = await db.select().from(customFields).orderBy(asc(customFields.sortOrder), asc(customFields.id));
    return c.json(forms.map((f) => ({ ...f, fields: fields.filter((x) => x.formId === f.id) })));
  })
  .post('/forms', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name, description: z.string().max(2000).optional() }));
    const [row] = await unique(() => c.var.deps.db.insert(ticketForms).values(body).returning());
    return c.json(row, 201);
  })
  .patch('/forms/:id', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name: name.optional(), description: z.string().max(2000).nullable().optional() }).strict());
    const [row] = await unique(() => c.var.deps.db.update(ticketForms).set(body).where(eq(ticketForms.id, idParam(c))).returning());
    if (!row) throw notFound();
    return c.json(row);
  })
  .post('/forms/:id/fields', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z.object({
        key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        label: z.string().trim().min(1).max(255),
        type: z.enum(FIELD_TYPES),
        isRequired: z.boolean().default(false),
        options: z.array(z.string().trim().min(1).max(128)).max(200).default([]),
        regex: z.string().max(255).nullable().optional(),
        visibility: z.enum(['public', 'internal']).default('public'),
        isFilterable: z.boolean().default(false),
        sortOrder: z.number().int().default(0),
      }),
    );
    if (!regexIsValid(body.regex)) throw badRequest(undefined, { errors: [{ path: 'regex', message: 'invalid regular expression' }] });
    if ((body.type === 'select' || body.type === 'multiselect') && !body.options.length) {
      throw badRequest(undefined, { errors: [{ path: 'options', message: 'required for select fields' }] });
    }
    const [row] = await unique(() => c.var.deps.db.insert(customFields).values({ ...body, formId: idParam(c) }).returning());
    await audit(c, 'admin.custom_field_created', { type: 'custom_field', id: row.id });
    return c.json(row, 201);
  })
  .patch('/fields/:id', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z
        .object({
          label: z.string().trim().min(1).max(255).optional(),
          isRequired: z.boolean().optional(),
          options: z.array(z.string().trim().min(1).max(128)).max(200).optional(),
          regex: z.string().max(255).nullable().optional(),
          visibility: z.enum(['public', 'internal']).optional(),
          isFilterable: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    );
    if (!regexIsValid(body.regex)) throw badRequest(undefined, { errors: [{ path: 'regex', message: 'invalid regular expression' }] });
    const [row] = await c.var.deps.db.update(customFields).set(body).where(eq(customFields.id, idParam(c))).returning();
    if (!row) throw notFound();
    return c.json(row);
  })

  // ------------------------------------------------------------------ help topics
  .get('/help-topics', manageCatalog, async (c) => c.json(await c.var.deps.db.select().from(helpTopics).orderBy(asc(helpTopics.name))))
  .post('/help-topics', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z.object({
        slug,
        name,
        description: z.string().max(2000).optional(),
        parentId: id.nullable().optional(),
        formId: id.nullable().optional(),
        slaPlanId: id.nullable().optional(),
        defaultTeamId: id.nullable().optional(),
        autoTags: tagList.default([]),
        isPublic: z.boolean().default(true),
      }),
    );
    const [row] = await unique(() => c.var.deps.db.insert(helpTopics).values(body).returning());
    await audit(c, 'admin.help_topic_created', { type: 'help_topic', id: row.id });
    return c.json(row, 201);
  })
  .patch('/help-topics/:id', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z
        .object({
          slug: slug.optional(),
          name: name.optional(),
          description: z.string().max(2000).nullable().optional(),
          parentId: id.nullable().optional(),
          formId: id.nullable().optional(),
          slaPlanId: id.nullable().optional(),
          defaultTeamId: id.nullable().optional(),
          autoTags: tagList.optional(),
          isPublic: z.boolean().optional(),
          isActive: z.boolean().optional(),
        })
        .strict(),
    );
    const topicId = idParam(c);
    if (body.parentId === topicId) throw badRequest(undefined, { errors: [{ path: 'parentId', message: 'cannot be itself' }] });
    const [row] = await unique(() => c.var.deps.db.update(helpTopics).set(body).where(eq(helpTopics.id, topicId)).returning());
    if (!row) throw notFound();
    return c.json(row);
  })

  // ------------------------------------------------------------------ tags
  .post('/tags', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() }));
    const [row] = await unique(() => c.var.deps.db.insert(tags).values({ ...body, name: body.name.toLowerCase() }).returning());
    return c.json(row, 201);
  })
  .patch('/tags/:id', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name: z.string().trim().min(1).max(64).optional(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() }).strict());
    const [row] = await unique(() =>
      c.var.deps.db.update(tags).set({ ...body, name: body.name?.toLowerCase() }).where(eq(tags.id, idParam(c))).returning(),
    );
    if (!row) throw notFound();
    return c.json(row);
  })
  .delete('/tags/:id', manageCatalog, async (c) => {
    await c.var.deps.db.delete(tags).where(eq(tags.id, idParam(c)));
    return c.body(null, 204);
  })

  // ------------------------------------------------------------------ canned responses
  .get('/canned-responses', manageCatalog, async (c) =>
    c.json(await c.var.deps.db.select().from(cannedResponses).orderBy(asc(cannedResponses.name))),
  )
  .post('/canned-responses', manageCatalog, async (c) => {
    const body = await parseJson(c, z.object({ name, body: z.string().trim().min(1).max(20_000), teamId: id.nullable().optional() }));
    const [row] = await c.var.deps.db.insert(cannedResponses).values(body).returning();
    return c.json(row, 201);
  })
  .patch('/canned-responses/:id', manageCatalog, async (c) => {
    const body = await parseJson(
      c,
      z.object({ name: name.optional(), body: z.string().trim().min(1).max(20_000).optional(), teamId: id.nullable().optional(), isActive: z.boolean().optional() }).strict(),
    );
    const [row] = await c.var.deps.db.update(cannedResponses).set(body).where(eq(cannedResponses.id, idParam(c))).returning();
    if (!row) throw notFound();
    return c.json(row);
  })

  // ------------------------------------------------------------------ API tokens
  .get('/api-tokens', guard({ permission: 'admin:tokens' }), async (c) => {
    const rows = await c.var.deps.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        prefix: apiTokens.prefix,
        scopes: apiTokens.scopes,
        expiresAt: apiTokens.expiresAt,
        lastUsedAt: apiTokens.lastUsedAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .orderBy(desc(apiTokens.createdAt));
    return c.json(rows);
  })
  .post('/api-tokens', guard({ permission: 'admin:tokens' }), async (c) => {
    const { db, clock } = c.var.deps;
    const auth = authOf(c);
    const body = await parseJson(
      c,
      z.object({
        name,
        scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
        expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
      }),
    );
    const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
    const token = `td_${prefix}_${randomToken(32)}`;
    const row = await db.transaction(async (tx) => {
      // Each token acts as its own api_client user, which becomes the requester of tickets it opens.
      const [client] = await tx
        .insert(users)
        .values({ email: `api-${prefix.toLowerCase()}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}@api.local`, displayName: body.name, roleKey: 'api_client', identityProvider: 'api' })
        .returning();
      const [tok] = await tx
        .insert(apiTokens)
        .values({
          name: body.name,
          prefix,
          tokenHash: sha256(token),
          userId: client.id,
          scopes: body.scopes,
          expiresAt: body.expiresInDays ? new Date(clock().getTime() + body.expiresInDays * 86_400_000) : null,
          createdBy: auth.user.id,
        })
        .returning();
      return tok;
    });
    await audit(c, 'admin.api_token_created', { type: 'api_token', id: row.id }, { scopes: body.scopes });
    // The plaintext token is shown exactly once.
    return c.json({ id: row.id, name: row.name, prefix, scopes: row.scopes, expiresAt: row.expiresAt, token }, 201);
  })
  .delete('/api-tokens/:id', guard({ permission: 'admin:tokens' }), async (c) => {
    const tokenId = idParam(c);
    const [row] = await c.var.deps.db
      .update(apiTokens)
      .set({ revokedAt: c.var.deps.clock() })
      .where(eq(apiTokens.id, tokenId))
      .returning();
    if (!row) throw notFound();
    await audit(c, 'admin.api_token_revoked', { type: 'api_token', id: tokenId });
    return c.body(null, 204);
  })

  // ------------------------------------------------------------------ settings, glossary, outbox, audit
  .get('/settings', manageSystem, async (c) =>
    c.json({ '2faEnforced': await getSetting(c.var.deps.db, 'security.2fa_enforced') }),
  )
  .patch('/settings', manageSystem, async (c) => {
    const auth = authOf(c);
    const body = await parseJson(c, z.object({ '2faEnforced': z.boolean() }).strict());
    await setSetting(c.var.deps.db, 'security.2fa_enforced', body['2faEnforced'], auth.user.id);
    await audit(c, 'admin.settings_updated', undefined, body);
    return c.json(body);
  })

  // Logo upload as base64 JSON (see services/branding.ts for the PNG checks); the read side is routes/branding.ts.
  .put('/branding/logo/:variant', manageSystem, async (c) => {
    const auth = authOf(c);
    const variant = parseWith(z.enum(LOGO_VARIANTS), c.req.param('variant'));
    const { data } = await parseJson(c, z.object({ data: z.string() }).strict());
    // Oversized or non-base64 uploads get the same friendly error as a non-PNG file.
    if (data.length > Math.ceil(LOGO_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new ApiError(400, 'invalid_logo');
    await setLogo(c.var.deps.db, variant, Buffer.from(data, 'base64'), auth.user.id);
    await audit(c, 'admin.logo_updated', undefined, { variant });
    return c.json({ logo: await logoUrls(c.var.deps.db) });
  })
  .delete('/branding/logo/:variant', manageSystem, async (c) => {
    const variant = parseWith(z.enum(LOGO_VARIANTS), c.req.param('variant'));
    await deleteLogo(c.var.deps.db, variant);
    await audit(c, 'admin.logo_removed', undefined, { variant });
    return c.json({ logo: await logoUrls(c.var.deps.db) });
  })

  .get('/glossary', manageSystem, async (c) =>
    c.json(await c.var.deps.db.select().from(glossaryTerms).orderBy(asc(glossaryTerms.locale), asc(glossaryTerms.key))),
  )
  .put('/glossary', manageSystem, async (c) => {
    const { db, glossary } = c.var.deps;
    const body = await parseJson(
      c,
      z.object({ locale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]), key: z.string().min(1).max(255), value: z.string().max(5000) }),
    );
    await db
      .insert(glossaryTerms)
      .values(body)
      .onConflictDoUpdate({ target: [glossaryTerms.locale, glossaryTerms.key], set: { value: body.value, updatedAt: new Date() } });
    await glossary.load(db);
    await audit(c, 'admin.glossary_updated', undefined, { locale: body.locale, key: body.key });
    return c.json(body);
  })
  .delete('/glossary/:id', manageSystem, async (c) => {
    const { db, glossary } = c.var.deps;
    await db.delete(glossaryTerms).where(eq(glossaryTerms.id, idParam(c)));
    await glossary.load(db);
    return c.body(null, 204);
  })

  .get('/notifications', manageSystem, async (c) => {
    const status = c.req.query('status');
    const rows = await c.var.deps.db
      .select()
      .from(notificationLogs)
      .where(status ? eq(notificationLogs.status, status) : undefined)
      .orderBy(desc(notificationLogs.createdAt))
      .limit(200);
    return c.json(rows);
  })
  .post('/notifications/:id/retry', manageSystem, async (c) => {
    const [row] = await c.var.deps.db
      .update(notificationLogs)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: c.var.deps.clock() })
      .where(and(eq(notificationLogs.id, idParam(c)), or(eq(notificationLogs.status, 'dead'), eq(notificationLogs.status, 'skipped'))))
      .returning();
    if (!row) throw notFound();
    return c.json(row);
  })

  .get('/audit-logs', guard({ permission: 'admin:audit' }), async (c) => {
    const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
    const rows = await c.var.deps.db
      .select({ log: auditLogs, actorEmail: users.email })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(100)
      .offset((page - 1) * 100);
    return c.json(rows.map((r) => ({ ...r.log, actorEmail: r.actorEmail })));
  });
