import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSecretBox } from '../src/server/auth/crypto.js';
import { auditLogs, systemSettings } from '../src/server/db/schema.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;

beforeAll(async () => {
  ctx = await createTestContext({ SMTP_HOST: 'smtp.env.test', SMTP_FROM: 'Env <env@example.com>' });
  admin = await ctx.adminClient();
});
afterAll(async () => {
  await ctx.close();
});

const getMail = () => admin.get('/api/v1/admin/settings/email');
const putMail = (body: unknown) => admin.raw('PUT', '/api/v1/admin/settings/email', body);
const testMail = (to: string) => admin.post('/api/v1/admin/settings/email/test', { to });

describe('mail settings API', () => {
  it('defaults to env and never exposes secrets', async () => {
    const res = await getMail();
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('env');
    expect(res.body.effectiveProvider).toBe('env');
    expect(res.body.env).toEqual({ host: 'smtp.env.test', from: 'Env <env@example.com>' });
    expect(res.body.smtp.hasPassword).toBe(false);
    expect(res.body.resend.hasApiKey).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('rejects non-admins with 403', async () => {
    await ctx.createUser('it@example.com', 'it_manager');
    await ctx.createUser('agent@example.com', 'agent');
    await ctx.createUser('requester@example.com', 'end_user');
    for (const email of ['it@example.com', 'agent@example.com', 'requester@example.com']) {
      const client = await ctx.login(email);
      expect((await client.get('/api/v1/admin/settings/email')).status).toBe(403);
      expect((await client.raw('PUT', '/api/v1/admin/settings/email', { provider: 'env' })).status).toBe(403);
      expect((await client.post('/api/v1/admin/settings/email/test', { to: email })).status).toBe(403);
    }
  });

  it('validates smtp and resend inputs', async () => {
    expect((await putMail({ provider: 'smtp', smtp: { host: '', from: 'a@b.co' } })).status).toBe(400);
    expect((await putMail({ provider: 'smtp', smtp: { host: 'smtp.test', port: 0, from: 'a@b.co' } })).status).toBe(400);
    expect((await putMail({ provider: 'smtp', smtp: { host: 'smtp.test', port: 70000, from: 'a@b.co' } })).status).toBe(400);
    expect((await putMail({ provider: 'smtp', smtp: { host: 'smtp.test', from: 'not-an-email' } })).status).toBe(400);
    expect((await putMail({ provider: 'resend', resend: { from: 'a@b.co' } })).status).toBe(400);
    expect((await putMail({ provider: 'resend', resend: { apiKey: 're_123', from: 'bad' } })).status).toBe(400);
    expect((await putMail({ provider: 'resend', resend: { apiKey: 're_123', from: 'TicketDesk <no-reply@example.com>' } })).status).toBe(200);
  });

  it('stores secrets encrypted and keeps them when the field is left blank', async () => {
    const saved = await putMail({
      provider: 'smtp',
      smtp: { host: 'smtp.test', port: 465, secure: true, user: 'mailer', password: 's3cr3t-password', from: 'TicketDesk <no-reply@example.com>' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.smtp.hasPassword).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain('s3cr3t-password');

    const [row] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, 'mail.settings'));
    const stored = row.value as { smtp: { password: string } };
    expect(stored.smtp.password).not.toContain('s3cr3t-password');

    // Leave the password blank: the encrypted value must be preserved.
    const kept = await putMail({ provider: 'smtp', smtp: { host: 'smtp.test', port: 465, secure: true, user: 'mailer', from: 'TicketDesk <no-reply@example.com>' } });
    expect(kept.status).toBe(200);
    expect(kept.body.smtp.hasPassword).toBe(true);
    const [after] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, 'mail.settings'));
    expect((after.value as { smtp: { password: string } }).smtp.password).toBe(stored.smtp.password);
  });

  it('writes audit records without secrets', async () => {
    await putMail({ provider: 'resend', resend: { apiKey: 're_secret_key', from: 'TicketDesk <no-reply@example.com>' } });
    const rows = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'admin.mail_settings_updated'));
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain('re_secret_key');
    expect(JSON.stringify(rows)).not.toContain('s3cr3t-password');
  });

  it('reads with a different APP_SECRET without crashing and flags the secret as invalid', async () => {
    const other = createSecretBox('another-secret-another-secret-123456');
    const { getMailSettings } = await import('../src/server/services/settings.js');
    const view = await getMailSettings(ctx.db, other, ctx.deps.config);
    expect(view.provider).toBe('resend');
    expect(view.resend.apiKeyInvalid).toBe(true);
    expect(view.resend.hasApiKey).toBe(false);
  });

  it('rate limits the test endpoint to 5 per user per minute', async () => {
    await putMail({ provider: 'env' });
    for (let i = 0; i < 5; i++) {
      const res = await testMail('admin@ticket.local');
      expect([200, 502]).toContain(res.status);
    }
    const sixth = await testMail('admin@ticket.local');
    expect(sixth.status).toBe(429);
  });
});