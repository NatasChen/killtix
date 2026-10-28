import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditLogs, notificationLogs, systemSettings, tickets } from '../src/server/db/schema.js';
import { agingDigest, scanSla } from '../src/server/services/jobs.js';
import { defaultSenders, dispatchPending, enqueue, type Senders } from '../src/server/services/notify.js';
import { saveChannelSettings, saveMailSettings, setSetting } from '../src/server/services/settings.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
let agentId: number;

beforeAll(async () => {
  ctx = await createTestContext({ NOTIFY_MAX_ATTEMPTS: '3' });
  // every channel is set up on the settings page (DECISIONS D13); the master switch starts off
  await saveMailSettings(ctx.db, ctx.deps.secretBox, { provider: 'smtp', smtp: { host: 'smtp.test', from: 'a@example.com' } }, null);
  await saveChannelSettings(ctx.db, ctx.deps.secretBox, { telegram: { botToken: '123:abc' }, teams: { webhookUrl: 'https://teams.test/webhook' } }, null);
  await setSetting(ctx.db, 'notify.enabled', true);
  admin = await ctx.adminClient();
  agentId = (await ctx.createUser('agent@example.com', 'agent', { telegramChatId: '4242', locale: 'en-US' })).id;
  await ctx.createUser('requester@example.com', 'end_user');
});
afterAll(async () => {
  await ctx.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const outbox = (where?: ReturnType<typeof eq>) => ctx.db.select().from(notificationLogs).where(where);

describe('notification outbox', () => {
  it('queues Teams on creation and e-mail + Telegram (in the recipient locale) on assignment', async () => {
    const t = (await admin.post('/api/v1/tickets', { subject: 'Printer on fire' })).body;
    expect((await outbox(eq(notificationLogs.eventId, `created:${t.id}`))).map((m) => m.channel)).toEqual(['teams']);

    await admin.patch(`/api/v1/tickets/${t.id}`, { assigneeId: agentId });
    const assigned = (await outbox()).filter((m) => m.eventId.startsWith(`assigned:${t.id}`));
    expect(assigned.map((m) => m.channel).sort()).toEqual(['email', 'telegram']);
    expect(assigned.find((m) => m.channel === 'email')!.subject).toBe(`[#${t.number}] Assigned to you: Printer on fire`);
    expect(assigned.find((m) => m.channel === 'telegram')!.recipient).toBe('4242');
  });

  it('notifies about a reply only when the writer asks for it, with only that reply', async () => {
    const requester = await ctx.login('requester@example.com');
    const t = (await requester.post('/api/v1/tickets', { subject: 'Need help' })).body;
    const before = (await outbox()).length;
    await admin.post(`/api/v1/tickets/${t.id}/threads`, { body: 'checked the VIP list', notify: false });
    expect((await outbox()).length).toBe(before);

    await admin.post(`/api/v1/tickets/${t.id}/threads`, { body: 'Please restart.' }); // notify defaults to true
    const [mail] = (await outbox(eq(notificationLogs.recipient, 'requester@example.com')));
    expect(mail.body).toContain('Please restart.');
    expect(mail.body).not.toContain('VIP');
  });

  it('dispatches with retries and exponential backoff, then marks messages dead', async () => {
    const sent: string[] = [];
    const ok: Senders = {
      email: async (to) => void sent.push(`email:${to}`),
      telegram: async (chat) => void sent.push(`telegram:${chat}`),
      teams: async () => void sent.push('teams'),
    };
    await dispatchPending(ctx.deps, ok, 100);
    expect(sent.length).toBeGreaterThan(0);
    expect(await outbox(eq(notificationLogs.status, 'pending'))).toHaveLength(0);

    const t = (await admin.post('/api/v1/tickets', { subject: 'flaky teams' })).body;
    const failing: Senders = { teams: async () => { throw new Error('HTTP 502'); } };
    const row = async () => (await outbox(eq(notificationLogs.eventId, `created:${t.id}`)))[0];
    await dispatchPending(ctx.deps, failing);
    expect((await row()).status).toBe('pending');
    expect((await row()).attempts).toBe(1);
    // Not retried before the backoff elapses.
    await dispatchPending(ctx.deps, failing);
    expect((await row()).attempts).toBe(1);
    for (let i = 0; i < 2; i++) {
      ctx.clock.advance(10 * 60_000);
      await dispatchPending(ctx.deps, failing);
    }
    expect((await row()).status).toBe('dead');
    expect((await row()).lastError).toContain('502');
  });

  it('logs unconfigured channels as skipped instead of silently dropping them', async () => {
    const bare = await createTestContext();
    try {
      const a = await bare.adminClient();
      expect((await a.patch('/api/v1/admin/settings', { notificationsEnabled: true })).body.notificationsEnabled).toBe(true);
      const t = (await a.post('/api/v1/tickets', { subject: 'no channels' })).body;
      const [row] = await bare.db.select().from(notificationLogs).where(eq(notificationLogs.eventId, `created:${t.id}`));
      expect(row.status).toBe('skipped');
    } finally {
      await bare.close();
    }
  });
});

describe('master switch and channel settings (DECISIONS D13)', () => {
  it('starts off: notifications are logged as disabled, never sent, and not sent later when switched on', async () => {
    const fresh = await createTestContext();
    try {
      const a = await fresh.adminClient();
      expect((await a.get('/api/v1/admin/settings')).body).toEqual({ '2faEnforced': false, notificationsEnabled: false });
      await saveChannelSettings(fresh.db, fresh.deps.secretBox, { teams: { webhookUrl: 'https://teams.test/hook' } }, null);
      const sent: string[] = [];
      const senders: Senders = { teams: async (title) => void sent.push(title) };
      const row = async (eventId: string) => (await fresh.db.select().from(notificationLogs).where(eq(notificationLogs.eventId, eventId)))[0];

      const off = (await a.post('/api/v1/tickets', { subject: 'while off' })).body;
      expect((await row(`created:${off.id}`)).status).toBe('disabled');

      // queued while on, switched off before it went out: dropped as disabled, not delivered after switching back on
      await a.patch('/api/v1/admin/settings', { notificationsEnabled: true });
      const queued = (await a.post('/api/v1/tickets', { subject: 'queued' })).body;
      expect((await row(`created:${queued.id}`)).status).toBe('pending');
      await a.patch('/api/v1/admin/settings', { notificationsEnabled: false });
      expect(await dispatchPending(fresh.deps, senders)).toBe(0);
      expect((await row(`created:${queued.id}`)).status).toBe('disabled');
      await a.patch('/api/v1/admin/settings', { notificationsEnabled: true });
      await dispatchPending(fresh.deps, senders);
      expect(sent).toEqual([]);

      // an administrator can still send one on purpose
      expect((await a.post(`/api/v1/admin/notifications/${(await row(`created:${queued.id}`)).id}/retry`)).status).toBe(200);
      await dispatchPending(fresh.deps, senders);
      expect(sent).toHaveLength(1);
      expect((await row(`created:${queued.id}`)).status).toBe('sent');
    } finally {
      await fresh.close();
    }
  });

  it('sends Telegram and Teams with the saved settings, and skips a removed channel', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    });
    await enqueue(ctx.deps, [
      { eventId: 'channels-telegram', channel: 'telegram', recipient: '4242', subject: 'Hi', body: 'Hi\nlink' },
      { eventId: 'channels-teams', channel: 'teams', recipient: 'default', subject: 'Title', body: 'Text' },
    ]);
    await dispatchPending(ctx.deps, await defaultSenders(ctx.deps), 100);
    expect(calls.map((c) => c.url).sort()).toEqual(['https://api.telegram.org/bot123:abc/sendMessage', 'https://teams.test/webhook']);
    expect(calls.find((c) => c.url.includes('telegram'))!.body).toMatchObject({ chat_id: '4242', text: 'Hi\nlink' });

    expect((await admin.raw('PUT', '/api/v1/admin/settings/channels', { teams: { webhookUrl: null } })).body.teams.hasWebhookUrl).toBe(false);
    await enqueue(ctx.deps, [{ eventId: 'channels-teams-removed', channel: 'teams', recipient: 'default', subject: 'T', body: 'x' }]);
    const [removed] = await ctx.db.select().from(notificationLogs).where(eq(notificationLogs.eventId, 'channels-teams-removed'));
    expect(removed.status).toBe('skipped');
    await saveChannelSettings(ctx.db, ctx.deps.secretBox, { teams: { webhookUrl: 'https://teams.test/webhook' } }, null);
  });

  it('keeps Telegram and Teams secrets write-only, encrypted and out of the audit log', async () => {
    const put = (body: unknown) => admin.raw('PUT', '/api/v1/admin/settings/channels', body);
    for (const body of [
      { telegram: { botToken: 'not a token' } },
      { teams: { webhookUrl: 'http://teams.test/insecure' } },
      { teams: { webhookUrl: 'not a url' } },
      { slack: {} },
    ]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    const saved = await put({ telegram: { botToken: '999:secret-token' } });
    expect(saved.body).toEqual({ telegram: { hasBotToken: true, botTokenInvalid: false }, teams: { hasWebhookUrl: true, webhookUrlInvalid: false } });
    expect((await put({ telegram: { botToken: '' } })).body.telegram.hasBotToken).toBe(true); // blank keeps it
    const [row] = await ctx.db.select().from(systemSettings).where(eq(systemSettings.key, 'notify.channels'));
    expect(JSON.stringify(row.value)).not.toMatch(/secret-token|teams\.test/);
    expect(JSON.stringify((await admin.get('/api/v1/admin/settings/channels')).body)).not.toContain('secret');
    const audits = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'admin.notify_channels_updated'));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toMatch(/secret-token|teams\.test/);

    await ctx.createUser('channels-manager@example.com', 'it_manager');
    const manager = await ctx.login('channels-manager@example.com');
    expect((await manager.get('/api/v1/admin/settings/channels')).status).toBe(403);
    expect((await manager.patch('/api/v1/admin/settings', { notificationsEnabled: false })).status).toBe(403);
    await saveChannelSettings(ctx.db, ctx.deps.secretBox, { telegram: { botToken: '123:abc' } }, null);
  });
});

describe('scheduled jobs', () => {
  it('marks SLA breaches and notifies only once', async () => {
    const t = (await admin.post('/api/v1/tickets', { subject: 'slow', helpTopic: 'security-incident' })).body;
    await admin.patch(`/api/v1/tickets/${t.id}`, { assigneeId: agentId });
    ctx.clock.advance(9 * 3_600_000); // resolution SLA is 8h
    await scanSla(ctx.deps);
    await scanSla(ctx.deps);
    const [row] = await ctx.db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.slaStatus).toBe('breached');
    const breach = await outbox(and(eq(notificationLogs.eventId, `sla_breached:${t.id}`), eq(notificationLogs.channel, 'teams'))!);
    expect(breach).toHaveLength(1);
  });

  it('does not breach tickets that are paused waiting on the user', async () => {
    const t = (await admin.post('/api/v1/tickets', { subject: 'waiting', helpTopic: 'security-incident' })).body;
    await admin.patch(`/api/v1/tickets/${t.id}`, { status: 'pending_user' });
    ctx.clock.advance(24 * 3_600_000);
    await scanSla(ctx.deps);
    const [row] = await ctx.db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.slaStatus).toBe('on_track');
  });

  it('sends the daily aging digest once per day after the configured hour', async () => {
    ctx.clock.now = new Date('2026-03-10T00:30:00Z'); // 08:30 Asia/Taipei
    expect(await agingDigest(ctx.deps)).toBe(false);
    ctx.clock.now = new Date('2026-03-10T01:05:00Z'); // 09:05
    expect(await agingDigest(ctx.deps)).toBe(true);
    expect(await agingDigest(ctx.deps)).toBe(false);
    const [digest] = await outbox(eq(notificationLogs.eventId, 'aging_digest:2026-03-10'));
    expect(digest.body).toMatch(/超過 3 天未結案工單：\d+ 張/);
  });
});
