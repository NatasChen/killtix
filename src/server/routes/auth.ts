import { desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import QRCode from 'qrcode';
import { z } from 'zod';
import { checkPasswordPolicy, hashPassword, randomToken, verifyPassword } from '../auth/crypto.js';
import {
  authOf,
  clearSessionCookie,
  guard,
  issueSession,
  nextStage,
  replaceSession,
  revokeAllSessions,
} from '../auth/session.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpUri, verifyTotp } from '../auth/totp.js';
import { passwordHistory, sessions, users, type User } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { clientIp, type AppContext, type AppEnv } from '../context.js';
import { SUPPORTED_LOCALES } from '../i18n/index.js';
import { audit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { parseJson, publicUserWithTeams, rateLimit } from './util.js';

const PASSWORD_HISTORY_DEPTH = 5;
// Compared against when the e-mail is unknown so response time does not reveal account existence.
let dummyHash: Promise<string> | undefined;
const getDummyHash = (cost: number) => (dummyHash ??= hashPassword(randomToken(), cost));

const anyStage = guard({ stages: ['full', 'password_change', 'mfa_verify', 'mfa_enroll'] });

async function reloadUser(c: AppContext, id: number): Promise<User> {
  const [user] = await c.var.deps.db.select().from(users).where(eq(users.id, id));
  return user;
}

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    const { db, config, clock } = c.var.deps;
    await rateLimit(c, `login:${clientIp(c)}`, config.loginRateLimitPerMin);
    const body = await parseJson(c, z.object({ email: z.string().max(255), password: z.string().max(256) }));
    const email = body.email.trim().toLowerCase();
    const now = clock();
    const [user] = await db.select().from(users).where(eq(users.email, email));

    const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? (await getDummyHash(config.bcryptCost)));
    const locked = user?.lockedUntil != null && user.lockedUntil > now;
    if (!user || !user.passwordHash || !user.isActive || locked || !passwordOk) {
      if (user && !locked && !passwordOk) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= config.loginMaxFailedAttempts;
        await db
          .update(users)
          .set({
            failedLoginCount: lock ? 0 : failed,
            lockedUntil: lock ? new Date(now.getTime() + config.lockoutMinutes * 60_000) : null,
          })
          .where(eq(users.id, user.id));
        if (lock) await audit(c, 'auth.locked', { type: 'user', id: user.id }, undefined, user.id);
      }
      await audit(c, 'auth.login_failed', undefined, { email }, user?.id ?? null);
      // Same response for unknown user, wrong password, locked or disabled account.
      throw new ApiError(401, 'invalid_credentials');
    }

    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
    const stage = await nextStage(c, user, false);
    await issueSession(c, user, stage);
    await audit(c, 'auth.login', { type: 'user', id: user.id }, { stage }, user.id);
    return c.json({ stage, user: await publicUserWithTeams(c.var.deps.db, user) });
  })

  .post('/logout', anyStage, async (c) => {
    const auth = authOf(c);
    if (auth.sessionHash) await c.var.deps.db.delete(sessions).where(eq(sessions.tokenHash, auth.sessionHash));
    clearSessionCookie(c);
    return c.body(null, 204);
  })

  .get('/me', anyStage, async (c) => {
    const auth = authOf(c);
    return c.json({ stage: auth.stage, permissions: auth.permissions, user: await publicUserWithTeams(c.var.deps.db, auth.user) });
  })

  .patch('/me', guard(), async (c) => {
    const auth = authOf(c);
    const body = await parseJson(
      c,
      z.object({
        displayName: z.string().trim().min(1).max(128).optional(),
        locale: z.enum(SUPPORTED_LOCALES as [string, ...string[]]).optional(),
        theme: z.enum(['light', 'dark']).optional(),
        telegramChatId: z.string().trim().max(64).regex(/^-?\d*$/).nullable().optional(),
      }),
    );
    const patch = { ...body, telegramChatId: body.telegramChatId === '' ? null : body.telegramChatId };
    await c.var.deps.db.update(users).set(patch).where(eq(users.id, auth.user.id));
    return c.json({ user: await publicUserWithTeams(c.var.deps.db, await reloadUser(c, auth.user.id)) });
  })

  .post('/change-password', guard({ stages: ['full', 'password_change'] }), async (c) => {
    const { db, config, clock } = c.var.deps;
    const auth = authOf(c);
    const body = await parseJson(
      c,
      z.object({ currentPassword: z.string().max(256), newPassword: z.string().max(256) }),
    );
    const user = auth.user;
    if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new ApiError(400, 'invalid_current_password');
    }
    const violations = checkPasswordPolicy(body.newPassword, { minLength: 12 });
    if (violations.length) throw new ApiError(400, 'password_policy', undefined, { rules: violations });

    const history = await db
      .select()
      .from(passwordHistory)
      .where(eq(passwordHistory.userId, user.id))
      .orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id));
    const previous = [user.passwordHash, ...history.slice(0, PASSWORD_HISTORY_DEPTH - 1).map((h) => h.passwordHash)];
    for (const hash of previous) {
      if (await verifyPassword(body.newPassword, hash)) throw new ApiError(400, 'password_reused');
    }

    const newHash = await hashPassword(body.newPassword, config.bcryptCost);
    await db.transaction(async (tx) => {
      await tx.insert(passwordHistory).values({ userId: user.id, passwordHash: user.passwordHash! });
      const stale = history.slice(PASSWORD_HISTORY_DEPTH - 1).map((h) => h.id);
      if (stale.length) await tx.delete(passwordHistory).where(inArray(passwordHistory.id, stale));
      await tx
        .update(users)
        .set({
          passwordHash: newHash,
          mustChangePassword: false,
          isBootstrapAdmin: false,
          passwordUpdatedAt: clock(),
        })
        .where(eq(users.id, user.id));
    });

    // Every existing session (other browsers, stolen cookies) is invalidated.
    await revokeAllSessions(c, user.id);
    const updated = await reloadUser(c, user.id);
    // A user who was already fully signed in has passed MFA in this session.
    const stage = await nextStage(c, updated, auth.stage === 'full');
    await issueSession(c, updated, stage);
    await audit(c, 'auth.password_changed', { type: 'user', id: user.id });
    return c.json({ stage, user: await publicUserWithTeams(c.var.deps.db, updated) });
  })

  .post('/2fa/setup', guard({ stages: ['full', 'mfa_enroll'] }), async (c) => {
    const { db, secretBox } = c.var.deps;
    const auth = authOf(c);
    if (auth.user.twoFactorEnabled) throw new ApiError(409, 'mfa_already_enabled');
    const secret = generateTotpSecret();
    await db.update(users).set({ totpPendingSecret: secretBox.encrypt(secret) }).where(eq(users.id, auth.user.id));
    const otpauthUrl = totpUri(secret, auth.user.email);
    return c.json({ secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) });
  })

  .post('/2fa/enable', guard({ stages: ['full', 'mfa_enroll'] }), async (c) => {
    const { db, secretBox, clock } = c.var.deps;
    const auth = authOf(c);
    const { code } = await parseJson(c, z.object({ code: z.string().max(16) }));
    await rateLimit(c, `mfa:${auth.user.id}`, 5);
    const pending = auth.user.totpPendingSecret && secretBox.decrypt(auth.user.totpPendingSecret);
    if (!pending || !verifyTotp(pending, code, clock())) throw new ApiError(400, 'invalid_totp');
    const recovery = generateRecoveryCodes();
    await db
      .update(users)
      .set({
        twoFactorEnabled: true,
        totpSecret: auth.user.totpPendingSecret,
        totpPendingSecret: null,
        recoveryCodeHashes: recovery.hashes,
      })
      .where(eq(users.id, auth.user.id));
    const updated = await reloadUser(c, auth.user.id);
    await replaceSession(c, updated, 'full');
    await audit(c, 'auth.2fa_enabled', { type: 'user', id: auth.user.id });
    return c.json({ stage: 'full', recoveryCodes: recovery.plain, user: await publicUserWithTeams(c.var.deps.db, updated) });
  })

  .post('/2fa/verify', guard({ stages: ['mfa_verify'] }), async (c) => {
    const { db, secretBox, clock } = c.var.deps;
    const auth = authOf(c);
    const body = await parseJson(
      c,
      z.object({ code: z.string().max(16).optional(), recoveryCode: z.string().max(32).optional() }),
    );
    await rateLimit(c, `mfa:${auth.user.id}`, 5);
    const user = auth.user;
    let ok = false;
    if (body.code && user.totpSecret) {
      ok = verifyTotp(secretBox.decrypt(user.totpSecret), body.code, clock());
    } else if (body.recoveryCode) {
      const hash = hashRecoveryCode(body.recoveryCode);
      if (user.recoveryCodeHashes.includes(hash)) {
        ok = true;
        await db
          .update(users)
          .set({ recoveryCodeHashes: user.recoveryCodeHashes.filter((h) => h !== hash) })
          .where(eq(users.id, user.id));
        await audit(c, 'auth.recovery_code_used', { type: 'user', id: user.id });
      }
    }
    if (!ok) {
      await audit(c, 'auth.2fa_failed', { type: 'user', id: user.id });
      throw new ApiError(400, 'invalid_totp');
    }
    const stage = await nextStage(c, user, true);
    await replaceSession(c, user, stage);
    return c.json({ stage, user: await publicUserWithTeams(c.var.deps.db, user) });
  })

  .post('/2fa/disable', guard(), async (c) => {
    const { db, secretBox, clock } = c.var.deps;
    const auth = authOf(c);
    const body = await parseJson(c, z.object({ password: z.string().max(256), code: z.string().max(16) }));
    if (await getSetting(db, 'security.2fa_enforced')) throw new ApiError(403, 'mfa_enforced');
    const user = auth.user;
    const passwordOk = user.passwordHash != null && (await verifyPassword(body.password, user.passwordHash));
    const codeOk = user.totpSecret != null && verifyTotp(secretBox.decrypt(user.totpSecret), body.code, clock());
    if (!passwordOk || !codeOk) throw new ApiError(400, 'invalid_totp');
    await db
      .update(users)
      .set({ twoFactorEnabled: false, totpSecret: null, totpPendingSecret: null, recoveryCodeHashes: [] })
      .where(eq(users.id, user.id));
    await audit(c, 'auth.2fa_disabled', { type: 'user', id: user.id });
    return c.json({ user: await publicUserWithTeams(c.var.deps.db, await reloadUser(c, user.id)) });
  });
