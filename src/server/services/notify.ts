import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Deps } from '../context.js';
import { notificationLogs, users, type Ticket } from '../db/schema.js';
import { getMailSettings, resolveMailSecrets } from './settings.js';

export type Channel = 'email' | 'telegram' | 'teams';

export interface Senders {
  email?: (to: string, subject: string, body: string) => Promise<void>;
  telegram?: (chatId: string, text: string) => Promise<void>;
  teams?: (webhookUrl: string, title: string, text: string) => Promise<void>;
}

export type TicketEvent =
  | { kind: 'created'; ticket: Ticket }
  | { kind: 'assigned'; ticket: Ticket }
  | { kind: 'agent_reply'; ticket: Ticket; threadId: number; body: string }
  | { kind: 'customer_reply'; ticket: Ticket; threadId: number; body: string }
  | { kind: 'sla_breached'; ticket: Ticket };

interface Message {
  eventId: string;
  channel: Channel;
  recipient: string;
  subject: string;
  body: string;
}

const PRIORITY_KEYS = ['', 'ticket.priority.1', 'ticket.priority.2', 'ticket.priority.3', 'ticket.priority.4', 'ticket.priority.5'];

async function channelConfigured(deps: Deps, channel: Channel) {
  const { config } = deps;
  if (channel === 'email') {
    const mail = await getMailSettings(deps.db, deps.secretBox, config);
    if (mail.provider === 'env') return Boolean(config.smtp.host);
    if (mail.provider === 'smtp') return Boolean(mail.smtp.host && mail.smtp.from && !mail.smtp.passwordInvalid);
    return Boolean(mail.resend.hasApiKey && mail.resend.from && !mail.resend.apiKeyInvalid);
  }
  if (channel === 'telegram') return Boolean(config.telegramBotToken);
  return Boolean(config.teamsWebhookUrl);
}

/** Inserts messages into the outbox. Duplicate (event, channel, recipient) rows are ignored. */
export async function enqueue(deps: Deps, messages: Message[]) {
  if (!messages.length) return;
  const statuses = await Promise.all(messages.map(async (m) => ({ ...m, status: (await channelConfigured(deps, m.channel)) ? 'pending' : 'skipped' })));
  await deps.db
    .insert(notificationLogs)
    .values(
      statuses.map((m) => ({
        ...m,
        // Unconfigured channels are logged as skipped so the outbox shows what would have been sent.
        nextAttemptAt: deps.clock(),
      })),
    )
    .onConflictDoNothing();
}

/**
 * Builds the notifications for a ticket event. Only public information is included:
 * internal notes never trigger notifications, and replies to requesters contain only the reply.
 */
export async function notifyTicketEvent(deps: Deps, event: TicketEvent) {
  const { db, glossary, config } = deps;
  const t = event.ticket;
  const link = `${config.appUrl.replace(/\/$/, '')}/tickets/${t.number}`;
  const loadUser = async (id: number | null) =>
    id ? (await db.select().from(users).where(eq(users.id, id)))[0] : undefined;
  const messages: Message[] = [];

  const toUser = async (userId: number | null, key: string, extra: Record<string, string> = {}, channels: Channel[] = ['email', 'telegram']) => {
    const u = await loadUser(userId);
    if (!u || !u.isActive) return;
    const vars = {
      number: t.number,
      subject: t.subject,
      priority: glossary.t(u.locale, PRIORITY_KEYS[t.priority]),
      link,
      ...extra,
    };
    const subject = glossary.t(u.locale, `notify.${key}.subject`, vars);
    const body = glossary.t(u.locale, `notify.${key}.body`, vars);
    const eventId = `${key}:${t.id}:${'threadId' in event ? event.threadId : t.updatedAt.getTime()}`;
    if (channels.includes('email')) messages.push({ eventId, channel: 'email', recipient: u.email, subject, body });
    if (channels.includes('telegram') && u.telegramChatId) {
      messages.push({ eventId, channel: 'telegram', recipient: u.telegramChatId, subject, body: `${subject}\n${link}` });
    }
  };

  const toTeams = (key: string, eventId: string) => {
    const locale = config.defaultLocale;
    const vars = { number: t.number, subject: t.subject, priority: glossary.t(locale, PRIORITY_KEYS[t.priority]), link };
    messages.push({
      eventId,
      channel: 'teams',
      recipient: 'default',
      subject: glossary.t(locale, `notify.${key}.subject`, vars),
      body: glossary.t(locale, `notify.${key}.teams`, vars),
    });
  };

  switch (event.kind) {
    case 'created':
      toTeams('created', `created:${t.id}`);
      break;
    case 'assigned':
      await toUser(t.assigneeId, 'assigned');
      break;
    case 'agent_reply': {
      const requester = await loadUser(t.requesterId);
      // Requesters created by external systems have no inbox worth mailing unless they are real users.
      if (requester && requester.roleKey !== 'api_client') await toUser(t.requesterId, 'agent_reply', { reply: event.body }, ['email']);
      break;
    }
    case 'customer_reply':
      await toUser(t.assigneeId, 'customer_reply', { reply: event.body });
      break;
    case 'sla_breached':
      await toUser(t.assigneeId, 'sla_breached');
      toTeams('sla_breached', `sla_breached:${t.id}`);
      break;
  }
  await enqueue(deps, messages);
}

export async function defaultSenders(deps: Deps): Promise<Senders> {
  const { config } = deps;
  const senders: Senders = {};
  const mail = await resolveMailSecrets(deps.db, deps.secretBox);
  if (mail.provider === 'env') {
    if (config.smtp.host) {
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
      });
      senders.email = async (to, subject, body) => {
        await transport.sendMail({ from: config.smtp.from, to, subject, text: body });
      };
    }
  } else if (mail.provider === 'smtp') {
    if (mail.smtp.host && mail.smtp.from && !mail.smtp.passwordInvalid) {
      const transport = nodemailer.createTransport({
        host: mail.smtp.host,
        port: mail.smtp.port,
        secure: mail.smtp.secure,
        auth: mail.smtp.user ? { user: mail.smtp.user, pass: mail.smtp.password } : undefined,
      });
      senders.email = async (to, subject, body) => {
        await transport.sendMail({ from: mail.smtp.from, to, subject, text: body });
      };
    }
  } else if (mail.provider === 'resend') {
    if (mail.resend.apiKey && mail.resend.from) {
      const apiKey = mail.resend.apiKey;
      const from = mail.resend.from;
      senders.email = async (to, subject, body) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ from, to, subject, text: body }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      };
    }
  }
  if (config.telegramBotToken) {
    const token = config.telegramBotToken;
    senders.telegram = async (chatId, text) => {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    };
  }
  if (config.teamsWebhookUrl) {
    senders.teams = async (url, title, text) => {
      // Adaptive Card payload: accepted by Teams Workflows (Power Automate) webhooks.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: {
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type: 'AdaptiveCard',
                version: '1.4',
                body: [
                  { type: 'TextBlock', text: title, weight: 'Bolder', wrap: true },
                  { type: 'TextBlock', text, wrap: true },
                ],
              },
            },
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Teams HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    };
  }
  return senders;
}

/** Sends a test e-mail synchronously with the currently stored settings (never via the outbox). */
export async function sendTestEmail(deps: Deps, to: string): Promise<void> {
  const { config } = deps;
  const mail = await resolveMailSecrets(deps.db, deps.secretBox);
  const subject = 'TicketDesk test e-mail';
  const body = 'This is a test e-mail from TicketDesk.';
  if (mail.provider === 'env') {
    if (!config.smtp.host) throw new Error('email channel not configured');
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    });
    await transport.sendMail({ from: config.smtp.from, to, subject, text: body });
    return;
  }
  if (mail.provider === 'smtp') {
    if (!mail.smtp.host || !mail.smtp.from || mail.smtp.passwordInvalid) throw new Error('email channel not configured');
    const transport = nodemailer.createTransport({
      host: mail.smtp.host,
      port: mail.smtp.port,
      secure: mail.smtp.secure,
      auth: mail.smtp.user ? { user: mail.smtp.user, pass: mail.smtp.password } : undefined,
    });
    await transport.sendMail({ from: mail.smtp.from, to, subject, text: body });
    return;
  }
  if (!mail.resend.apiKey || !mail.resend.from) throw new Error('email channel not configured');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${mail.resend.apiKey}` },
    body: JSON.stringify({ from: mail.resend.from, to, subject, text: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Sends due outbox messages with exponential backoff; gives up after notifyMaxAttempts. */
export async function dispatchPending(deps: Deps, senders: Senders, batchSize = 20): Promise<number> {
  const { db, clock, config } = deps;
  // Rows left in 'sending' by a crashed process are retried.
  await db
    .update(notificationLogs)
    .set({ status: 'pending' })
    .where(and(eq(notificationLogs.status, 'sending'), lte(notificationLogs.nextAttemptAt, new Date(clock().getTime() - 300_000))));
  const due = await db
    .select()
    .from(notificationLogs)
    .where(and(eq(notificationLogs.status, 'pending'), lte(notificationLogs.nextAttemptAt, clock())))
    .orderBy(asc(notificationLogs.nextAttemptAt))
    .limit(batchSize);
  // Claim the batch so a concurrent dispatcher does not send the same rows.
  const claimed = due.length
    ? await db
        .update(notificationLogs)
        .set({ status: 'sending' })
        .where(and(inArray(notificationLogs.id, due.map((d) => d.id)), eq(notificationLogs.status, 'pending')))
        .returning()
    : [];

  for (const msg of claimed) {
    try {
      if (msg.channel === 'email') {
        if (!senders.email) throw new Error('email channel not configured');
        await senders.email(msg.recipient, msg.subject, msg.body);
      } else if (msg.channel === 'telegram') {
        if (!senders.telegram) throw new Error('telegram channel not configured');
        await senders.telegram(msg.recipient, msg.body);
      } else if (msg.channel === 'teams') {
        if (!senders.teams || !config.teamsWebhookUrl) throw new Error('teams channel not configured');
        await senders.teams(config.teamsWebhookUrl, msg.subject, msg.body);
      }
      await db
        .update(notificationLogs)
        .set({ status: 'sent', attempts: msg.attempts + 1, sentAt: clock(), lastError: null })
        .where(eq(notificationLogs.id, msg.id));
    } catch (err) {
      const attempts = msg.attempts + 1;
      const dead = attempts >= config.notifyMaxAttempts;
      await db
        .update(notificationLogs)
        .set({
          status: dead ? 'dead' : 'pending',
          attempts,
          lastError: String((err as Error).message ?? err).slice(0, 1000),
          nextAttemptAt: new Date(clock().getTime() + 30_000 * 2 ** attempts),
        })
        .where(eq(notificationLogs.id, msg.id));
    }
  }
  return claimed.length;
}
