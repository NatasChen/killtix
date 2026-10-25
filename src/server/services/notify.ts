import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Deps } from '../context.js';
import { notificationLogs, teamMembers, teams, users, type Ticket } from '../db/schema.js';
import { can, ROLE_DEFINITIONS } from '../rbac.js';
import { mailTransport, type MailTransport } from './settings.js';

export type Channel = 'email' | 'telegram' | 'teams';

export interface Senders {
  email?: (to: string, subject: string, body: string) => Promise<void>;
  telegram?: (chatId: string, text: string) => Promise<void>;
  teams?: (webhookUrl: string, title: string, text: string) => Promise<void>;
}

export type TicketEvent =
  | { kind: 'created'; ticket: Ticket }
  | { kind: 'assigned'; ticket: Ticket }
  | { kind: 'team_assigned'; ticket: Ticket; actorId: number | null }
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

function channelConfigured(deps: Deps, channel: Channel, email: MailTransport | null) {
  const { config } = deps;
  if (channel === 'email') return Boolean(email);
  if (channel === 'telegram') return Boolean(config.telegramBotToken);
  return Boolean(config.teamsWebhookUrl);
}

/** Inserts messages into the outbox. Duplicate (event, channel, recipient) rows are ignored. */
export async function enqueue(deps: Deps, messages: Message[]) {
  if (!messages.length) return;
  const email = await mailTransport(deps.db, deps.secretBox, deps.config);
  await deps.db
    .insert(notificationLogs)
    .values(
      messages.map((m) => ({
        ...m,
        // Unconfigured channels are logged as skipped so the outbox shows what would have been sent.
        status: channelConfigured(deps, m.channel, email) ? 'pending' : 'skipped',
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
    case 'team_assigned': {
      // Internal members of the ticket's team (vendors and end users only see tickets assigned to them).
      if (!t.teamId || t.assigneeId) break;
      const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, t.teamId));
      const members = await db
        .select({ id: users.id, role: users.roleKey })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, t.teamId));
      for (const m of members) {
        const perms = ROLE_DEFINITIONS[m.role]?.permissions ?? [];
        if (m.id === event.actorId || !(can(perms, 'ticket:read:team') || can(perms, 'ticket:read:all'))) continue;
        await toUser(m.id, 'team_assigned', { team: team?.name ?? '' });
      }
      break;
    }
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

/** E-mail over SMTP (environment variables or the settings page) or the Resend HTTP API. */
function emailSender(mail: MailTransport): NonNullable<Senders['email']> {
  if (mail.kind === 'smtp') {
    const transport = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
    });
    return async (to, subject, body) => {
      await transport.sendMail({ from: mail.from, to, subject, text: body });
    };
  }
  return async (to, subject, body) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mail.apiKey}` },
      body: JSON.stringify({ from: mail.from, to, subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

/** Built on every dispatch run: e-mail follows the current mail settings (DECISIONS D13). */
export async function defaultSenders(deps: Deps): Promise<Senders> {
  const { config } = deps;
  const senders: Senders = {};
  const mail = await mailTransport(deps.db, deps.secretBox, config);
  if (mail) senders.email = emailSender(mail);
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

/**
 * Sends a test e-mail right away with the saved settings (not through the outbox). Returns the error message
 * on failure, with any secret masked in case a provider echoes it back.
 */
export async function sendTestEmail(deps: Deps, to: string, locale: string): Promise<string | null> {
  const mail = await mailTransport(deps.db, deps.secretBox, deps.config);
  if (!mail) return deps.glossary.t(locale, 'error.mail_not_configured');
  try {
    await emailSender(mail)(to, deps.glossary.t(locale, 'notify.mail_test.subject'), deps.glossary.t(locale, 'notify.mail_test.body'));
    return null;
  } catch (err) {
    const secret = mail.kind === 'smtp' ? mail.password : mail.apiKey;
    const message = String((err as Error).message ?? err).slice(0, 300);
    return secret ? message.split(secret).join('***') : message;
  }
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
