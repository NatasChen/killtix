import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSecretBox } from '../src/server/auth/crypto.js';
import { auditLogs, notificationLogs, systemSettings } from '../src/server/db/schema.js';
import { defaultSenders, dispatchPending, enqueue } from '../src/server/services/notify.js';
import { getMailSettings, setSetting } from '../src/server/services/settings.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;

beforeAll(async () => {
  ctx = await createTestContext({ SMTP_HOST: 'smtp.env.test', SMTP_FROM: 'Env <env@example.com>' });
  await setSetting(ctx.db, 'notify.enabled', true);
  admin = await ctx.adminClient();
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const getMail = () => admin.get('/api/v1/admin/settings/email');
const putMail = (body: unknown) => admin.raw('PUT', '/api/v1/admin/settings/email', body);
const testMail = (to: string) => admin.post('/api/v1/admin/settings/email/test', { to });
const RESEND = { provider: 'resend', resend: { apiKey: 're_secret_key', from: 'TicketDesk <no-reply@example.com>' } };

/** Fake Resend API: records each call and answers with `status`. */
function fakeFetch(status = 200, text = '{"id":"x"}') {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(text, { status });
  });
  return calls;
}

/** Fake SMTP: captures the transport options and the sent mails without opening a connection. */
function fakeSmtp() {
  const sent: { options: unknown; mail: Record<string, unknown> }[] = [];
  vi.spyOn(nodemailer, 'createTransport').mockImplementation(
    (options: unknown) => ({ sendMail: async (mail: Record<string, unknown>) => void sent.push({ options, mail }) }) as never,
  );
  return sent;
}

describe('mail settings', () => {
  it('starts unconfigured and ignores the old SMTP_* environment variables (DECISIONS D13)', async () => {
    const res = await getMail();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'smtp',
      effective: null,
      smtp: { host: '', port: 587, secure: false, user: '', from: '', hasPassword: false, passwordInvalid: false },
      resend: { from: '', hasApiKey: false, apiKeyInvalid: false },
    });
  });

  it('treats a saved "environment variables" choice from before as not configured', async () => {
    const legacy = await createTestContext({ SMTP_HOST: 'smtp.env.test' });
    try {
      await legacy.db.insert(systemSettings).values({ key: 'mail.settings', value: { provider: 'env' } });
      const res = await (await legacy.adminClient()).get('/api/v1/admin/settings/email');
      expect(res.body).toMatchObject({ provider: 'smtp', effective: null });
    } finally {
      await legacy.close();
    }
  });

  it('is only for system administrators', async () => {
    await ctx.createUser('mail-manager@example.com', 'it_manager');
    const manager = await ctx.login('mail-manager@example.com');
    expect((await manager.get('/api/v1/admin/settings/email')).status).toBe(403);
    expect((await manager.raw('PUT', '/api/v1/admin/settings/email', { provider: 'smtp' })).status).toBe(403);
    expect((await manager.post('/api/v1/admin/settings/email/test', { to: 'x@example.com' })).status).toBe(403);
  });

  it('validates the input', async () => {
    const from = 'a@b.co';
    for (const body of [
      { provider: 'smtp', smtp: { host: '', from } },
      { provider: 'smtp', smtp: { host: 'smtp.test' } },
      { provider: 'smtp', smtp: { host: 'smtp.test', port: 0, from } },
      { provider: 'smtp', smtp: { host: 'smtp.test', port: 65536, from } },
      { provider: 'smtp', smtp: { host: 'smtp.test', from: 'not-an-email' } },
      { provider: 'resend', resend: { from } }, // first Resend setup needs the key
      { provider: 'resend', resend: { apiKey: 're_1', from: 'Name <bad>' } },
      { provider: 'sendgrid' },
      { provider: 'env' },
    ]) {
      expect((await putMail(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await getMail()).body.effective).toBeNull();
  });

  it('stores secrets encrypted, never returns them, and keeps them when left blank', async () => {
    const smtp = { host: 'smtp.test', port: 465, secure: true, user: 'mailer', from: 'TicketDesk <no-reply@example.com>' };
    const saved = await putMail({ provider: 'smtp', smtp: { ...smtp, password: 's3cr3t-password' } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ effective: 'smtp', smtp: { hasPassword: true } });

    const [row] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, 'mail.settings'));
    const boxed = (row.value as { smtp: { password: string } }).smtp.password;
    expect(boxed).not.toContain('s3cr3t-password');
    expect(ctx.deps.secretBox.decrypt(boxed)).toBe('s3cr3t-password');

    expect((await putMail({ provider: 'smtp', smtp: { ...smtp, password: '' } })).body.smtp.hasPassword).toBe(true);
    const [after] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, 'mail.settings'));
    expect((after.value as { smtp: { password: string } }).smtp.password).toBe(boxed);

    expect(JSON.stringify((await getMail()).body)).not.toContain(boxed);
    const audits = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'admin.mail_settings_updated'));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toMatch(/s3cr3t|re_secret/);
  });

  it('sends outbox e-mail through Resend after switching, and through SMTP again after switching back', async () => {
    expect((await putMail(RESEND)).status).toBe(200);
    const calls = fakeFetch();
    await enqueue(ctx.deps, [{ eventId: 'mail-resend', channel: 'email', recipient: 'to@example.com', subject: 'Hi', body: 'Text' }]);
    await dispatchPending(ctx.deps, await defaultSenders(ctx.deps));
    expect(calls).toEqual([
      {
        url: 'https://api.resend.com/emails',
        headers: expect.objectContaining({ authorization: 'Bearer re_secret_key' }),
        body: { from: 'TicketDesk <no-reply@example.com>', to: 'to@example.com', subject: 'Hi', text: 'Text' },
      },
    ]);
    const [log] = await ctx.db.select().from(notificationLogs).where(eq(notificationLogs.eventId, 'mail-resend'));
    expect(log.status).toBe('sent');

    // back to SMTP: the password saved earlier is kept
    expect((await putMail({ provider: 'smtp', smtp: { host: 'smtp.ui.test', from: 'TicketDesk <no-reply@example.com>' } })).status).toBe(200);
    const sent = fakeSmtp();
    await enqueue(ctx.deps, [{ eventId: 'mail-smtp', channel: 'email', recipient: 'to@example.com', subject: 'Hi', body: 'Text' }]);
    await dispatchPending(ctx.deps, await defaultSenders(ctx.deps));
    expect(sent).toHaveLength(1);
    expect(sent[0].options).toMatchObject({ host: 'smtp.ui.test', auth: { user: 'mailer', pass: 's3cr3t-password' } });
    expect(sent[0].mail).toMatchObject({ from: 'TicketDesk <no-reply@example.com>', to: 'to@example.com' });
    expect(calls).toHaveLength(1);
  });

  it('treats secrets that no longer decrypt as not configured', async () => {
    await putMail(RESEND);
    const view = await getMailSettings(ctx.db, createSecretBox('another-secret-another-secret-123456'));
    expect(view.resend).toMatchObject({ hasApiKey: false, apiKeyInvalid: true });
    expect(view.effective).toBeNull();
  });

  it('sends a test e-mail with the saved settings, reports failures without secrets, and is rate limited', async () => {
    const limited = await createTestContext();
    const client = await limited.adminClient();
    await client.raw('PUT', '/api/v1/admin/settings/email', RESEND);
    const send = () => client.post('/api/v1/admin/settings/email/test', { to: 'admin@example.com' });

    const calls = fakeFetch();
    expect((await send()).body).toEqual({ ok: true });
    expect(calls[0].body).toMatchObject({ to: 'admin@example.com' });

    fakeFetch(401, 'invalid key re_secret_key');
    const failed = await send();
    expect(failed.status).toBe(200);
    expect(failed.body.ok).toBe(false);
    expect(failed.body.error).toContain('Resend HTTP 401');
    expect(failed.body.error).not.toContain('re_secret_key');

    for (let i = 0; i < 3; i++) await send();
    expect((await send()).status).toBe(429);
    await limited.close();
  });

  it('reports a test e-mail as not configured instead of trying to send', async () => {
    const bare = await createTestContext();
    const res = await (await bare.adminClient()).post('/api/v1/admin/settings/email/test', { to: 'admin@example.com' });
    expect(res.body).toEqual({ ok: false, error: expect.any(String) });
    await bare.close();
  });
});
