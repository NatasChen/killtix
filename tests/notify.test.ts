import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationLogs, tickets } from '../src/server/db/schema.js';
import { agingDigest, scanSla } from '../src/server/services/jobs.js';
import { dispatchPending, type Senders } from '../src/server/services/notify.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
let agentId: number;

beforeAll(async () => {
  ctx = await createTestContext({
    SMTP_HOST: 'smtp.test',
    TELEGRAM_BOT_TOKEN: '123:abc',
    TEAMS_WEBHOOK_URL: 'https://teams.test/webhook',
    NOTIFY_MAX_ATTEMPTS: '3',
  });
  admin = await ctx.adminClient();
  agentId = (await ctx.createUser('agent@example.com', 'agent', { telegramChatId: '4242', locale: 'en-US' })).id;
  await ctx.createUser('requester@example.com', 'end_user');
});
afterAll(async () => {
  await ctx.close();
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

  it('never notifies about internal notes and only sends the public reply to the requester', async () => {
    const requester = await ctx.login('requester@example.com');
    const t = (await requester.post('/api/v1/tickets', { subject: 'Need help' })).body;
    const before = (await outbox()).length;
    await admin.post(`/api/v1/tickets/${t.id}/threads`, { type: 'internal_note', body: 'internal: user is VIP' });
    expect((await outbox()).length).toBe(before);

    await admin.post(`/api/v1/tickets/${t.id}/threads`, { body: 'Please restart.' });
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
      const t = (await a.post('/api/v1/tickets', { subject: 'no channels' })).body;
      const [row] = await bare.db.select().from(notificationLogs).where(eq(notificationLogs.eventId, `created:${t.id}`));
      expect(row.status).toBe('skipped');
    } finally {
      await bare.close();
    }
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
