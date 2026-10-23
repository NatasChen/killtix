import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/server/auth/crypto.js';
import { currentTotp } from '../src/server/auth/totp.js';
import { users } from '../src/server/db/schema.js';
import { seed } from '../src/server/db/seed.js';
import { ADMIN_PASSWORD, createTestContext, STRONG_PASSWORD, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const adminRow = async () => (await ctx.db.select().from(users).where(eq(users.email, 'admin@ticket.local')))[0];

describe('bootstrap admin', () => {
  it('is seeded with a real bcrypt hash of the configured password and forced change flags', async () => {
    const admin = await adminRow();
    expect(admin.roleKey).toBe('super_admin');
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.isBootstrapAdmin).toBe(true);
    expect(await verifyPassword(ADMIN_PASSWORD, admin.passwordHash!)).toBe(true);
  });

  it('gets a restricted session that blocks every business API until the password is changed', async () => {
    const client = ctx.client();
    const login = await client.post('/api/v1/auth/login', { email: 'ADMIN@ticket.local', password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.stage).toBe('password_change');

    for (const [method, path] of [
      ['GET', '/api/v1/tickets'],
      ['POST', '/api/v1/tickets'],
      ['GET', '/api/v1/dashboard'],
      ['GET', '/api/v1/admin/users'],
    ]) {
      const res = await client.raw(method, path, method === 'POST' ? { subject: 'x' } : undefined);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.code).toBe('password_change_required');
    }

    // Logging in again still yields a restricted session.
    const again = await client.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });
    expect(again.body.stage).toBe('password_change');
  });

  it('enforces the password policy and forbids reusing the initial password', async () => {
    const client = ctx.client();
    await client.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });
    const weak = await client.post('/api/v1/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('password_policy');
    expect(weak.body.rules).toEqual(expect.arrayContaining(['min_length', 'uppercase', 'digit', 'symbol']));

    const same = await client.post('/api/v1/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: ADMIN_PASSWORD });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('password_reused');

    const wrongCurrent = await client.post('/api/v1/auth/change-password', { currentPassword: 'nope', newPassword: STRONG_PASSWORD });
    expect(wrongCurrent.body.code).toBe('invalid_current_password');
  });

  it('clears the flags, revokes other sessions and unlocks the app after a successful change', async () => {
    const other = ctx.client();
    await other.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });
    const client = ctx.client();
    await client.post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });

    const res = await client.post('/api/v1/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: STRONG_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('full');
    const admin = await adminRow();
    expect(admin.mustChangePassword).toBe(false);
    expect(admin.isBootstrapAdmin).toBe(false);

    expect((await client.get('/api/v1/tickets')).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    // The old password no longer works.
    const old = await ctx.client().post('/api/v1/auth/login', { email: 'admin@ticket.local', password: ADMIN_PASSWORD });
    expect(old.status).toBe(401);
  });

  it('seeding again never resets a changed password or duplicates the admin', async () => {
    await seed(ctx.db, ctx.deps.config);
    const all = await ctx.db.select().from(users).where(eq(users.roleKey, 'super_admin'));
    expect(all).toHaveLength(1);
    expect(await verifyPassword(STRONG_PASSWORD, all[0].passwordHash!)).toBe(true);
    expect(all[0].mustChangePassword).toBe(false);
  });

  it('rejects the last five passwords', async () => {
    const client = await ctx.adminClient();
    const res = await client.post('/api/v1/auth/change-password', { currentPassword: STRONG_PASSWORD, newPassword: ADMIN_PASSWORD });
    expect(res.body.code).toBe('password_reused');
  });
});

describe('login protection', () => {
  it('returns the same error for unknown accounts and wrong passwords', async () => {
    await ctx.createUser('someone@example.com', 'agent');
    const unknown = await ctx.client().post('/api/v1/auth/login', { email: 'ghost@example.com', password: 'x' });
    const wrong = await ctx.client().post('/api/v1/auth/login', { email: 'someone@example.com', password: 'x' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.code).toBe(wrong.body.code);
  });

  it('locks the account after 5 failures, even for the right password, then unlocks after 15 minutes', async () => {
    await ctx.createUser('locked@example.com', 'agent');
    for (let i = 0; i < 5; i++) {
      await ctx.client().post('/api/v1/auth/login', { email: 'locked@example.com', password: 'wrong' });
    }
    const blocked = await ctx.client().post('/api/v1/auth/login', { email: 'locked@example.com', password: STRONG_PASSWORD });
    expect(blocked.status).toBe(401);
    ctx.clock.advance(16 * 60_000);
    const ok = await ctx.client().post('/api/v1/auth/login', { email: 'locked@example.com', password: STRONG_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('rate-limits login attempts per client IP', async () => {
    const limited = await createTestContext({ LOGIN_RATE_LIMIT_PER_MIN: '3' });
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await limited.client().post('/api/v1/auth/login', { email: 'x@example.com', password: 'x' })).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });

  it('rejects cookie-authenticated writes without the CSRF header', async () => {
    const client = await ctx.adminClient();
    const res = await ctx.app.request('/api/v1/tickets', {
      method: 'POST',
      headers: { cookie: client.cookie!, 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'csrf' }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('csrf_failed');
  });
});

describe('two-factor authentication', () => {
  it('enrols TOTP, then requires a code (or a one-time recovery code) at login', async () => {
    await ctx.createUser('mfa@example.com', 'agent');
    const client = await ctx.login('mfa@example.com');
    const setup = await client.post('/api/v1/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const bad = await client.post('/api/v1/auth/2fa/enable', { code: '000000' });
    expect(bad.body.code).toBe('invalid_totp');
    const enable = await client.post('/api/v1/auth/2fa/enable', { code: currentTotp(setup.body.secret, ctx.clock.now) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);

    // Secret is encrypted at rest.
    const [row] = await ctx.db.select().from(users).where(eq(users.email, 'mfa@example.com'));
    expect(row.totpSecret).not.toContain(setup.body.secret);

    const second = ctx.client();
    const login = await second.post('/api/v1/auth/login', { email: 'mfa@example.com', password: STRONG_PASSWORD });
    expect(login.body.stage).toBe('mfa_verify');
    expect((await second.get('/api/v1/tickets')).body.code).toBe('mfa_required');
    const verify = await second.post('/api/v1/auth/2fa/verify', { code: currentTotp(setup.body.secret, ctx.clock.now) });
    expect(verify.body.stage).toBe('full');
    expect((await second.get('/api/v1/tickets')).status).toBe(200);

    const recovery = enable.body.recoveryCodes[0];
    const third = ctx.client();
    await third.post('/api/v1/auth/login', { email: 'mfa@example.com', password: STRONG_PASSWORD });
    expect((await third.post('/api/v1/auth/2fa/verify', { recoveryCode: recovery })).body.stage).toBe('full');
    const fourth = ctx.client();
    await fourth.post('/api/v1/auth/login', { email: 'mfa@example.com', password: STRONG_PASSWORD });
    expect((await fourth.post('/api/v1/auth/2fa/verify', { recoveryCode: recovery })).status).toBe(400);
  });

  it('forces enrolment for everyone when the global switch is on', async () => {
    const admin = await ctx.adminClient();
    expect((await admin.patch('/api/v1/admin/settings', { '2faEnforced': true })).status).toBe(200);
    await ctx.createUser('enforced@example.com', 'end_user');
    const client = ctx.client();
    const login = await client.post('/api/v1/auth/login', { email: 'enforced@example.com', password: STRONG_PASSWORD });
    expect(login.body.stage).toBe('mfa_enroll');
    expect((await client.get('/api/v1/tickets')).body.code).toBe('mfa_enrollment_required');
    const setup = await client.post('/api/v1/auth/2fa/setup');
    const enable = await client.post('/api/v1/auth/2fa/enable', { code: currentTotp(setup.body.secret, ctx.clock.now) });
    expect(enable.body.stage).toBe('full');
    expect((await client.get('/api/v1/tickets')).status).toBe(200);
    await admin.patch('/api/v1/admin/settings', { '2faEnforced': false });
  });
});
