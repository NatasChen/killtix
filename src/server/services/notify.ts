import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Deps } from '../context.js';
import { notificationLogs, teamMembers, teams, users, type Ticket } from '../db/schema.js';
import { can, ROLE_DEFINITIONS } from '../rbac.js';
import { getSetting, mailTransport, notifyTransports, type MailTransport, type NotifyTransports } from './settings.js';

export type Channel = 'email' | 'telegram' | 'teams';

export interface Senders {
  email?: (to: string, subject: string, body: string) => Promise<void>;
  telegram?: (chatId: string, text: string) => Promise<void>;
  teams?: (title: string, text: string) => Promise<void>;
}

export type TicketEvent =
  | { kind: 'created'; ticket: Ticket }
  | { kind: 'assigned'; ticket: Ticket }
  | { kind: 'team_assigned'; ticket: Ticket; actorId: number | null }
  | { kind: 'agent_reply'; ticket: Ticket; threadId: number; body: string; actorId: number | null }
  | { kind: 'customer_reply'; ticket: Ticket; threadId: number; body: string; actorId: number | null }
  | { kind: 'sla_breached'; ticket: Ticket }
  | { kind: 'sla_at_risk'; ticket: Ticket }
  | { kind: 'nudge'; ticket: Ticket; threadId: number; actorId: number; actor: string; message: string };

interface Message {
  eventId: string;
  channel: Channel;
  recipient: string;
  subject: string;
  body: string;
}

const PRIORITY_KEYS = ['', 'ticket.priority.1', 'ticket.priority.2', 'ticket.priority.3', 'ticket.priority.4', 'ticket.priority.5'];

function channelConfigured(channel: Channel, transports: NotifyTransports) {
  if (channel === 'email') return Boolean(transports.email);
  if (channel === 'telegram') return Boolean(transports.telegramBotToken);
  return Boolean(transports.teamsWebhookUrl);
}

/** Inserts messages into the outbox. Duplicate (event, channel, recipient) rows are ignored. */
export async function enqueue(deps: Deps, messages: Message[]) {
  if (!messages.length) return;
  const transports = await notifyTransports(deps.db, deps.secretBox);
  await deps.db
    .insert(notificationLogs)
    .values(
      messages.map((m) => ({
        ...m,
        // Logged even when not sent, so the outbox shows what would have gone out: 'disabled' while the
        // master switch is off, 'skipped' for a channel that is not configured.
        status: !transports.enabled ? 'disabled' : channelConfigured(m.channel, transports) ? 'pending' : 'skipped',
        nextAttemptAt: deps.clock(),
      })),
    )
    .onConflictDoNothing();
}

/**
 * Internal members of a team who see its tickets (vendors and end users only see tickets assigned to them),
 * except `exceptId`.
 */
export function teamRecipients(deps: Pick<Deps, 'db'>, teamId: number, exceptId: number | null) {
  return teamMembersWith(deps, teamId, exceptId, (perms) => can(perms, 'ticket:read:team') || can(perms, 'ticket:read:all'));
}

/** Active members of `teamId` whose role passes `allowed`, except `exceptId`. */
export async function teamMembersWith(deps: Pick<Deps, 'db'>, teamId: number, exceptId: number | null, allowed: (perms: string[]) => boolean) {
  const members = await deps.db
    .select({ id: users.id, role: users.roleKey, active: users.isActive })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId));
  return members.filter((m) => m.active && m.id !== exceptId && allowed(ROLE_DEFINITIONS[m.role]?.permissions ?? [])).map((m) => m.id);
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
    // at most one "at risk" warning per ticket and recipient (the outbox ignores duplicates)
    const once = event.kind === 'sla_at_risk' ? 'once' : t.updatedAt.getTime();
    const eventId = `${key}:${t.id}:${'threadId' in event ? event.threadId : once}`;
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

  const teamName = async (teamId: number) =>
    (await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)))[0]?.name ?? '';

  /** The ticket's assignee, or — while nobody has claimed it — the internal members of its team; never `actorId`. */
  const toHandlers = async (key: string, actorId: number | null, extra: Record<string, string> = {}, skip: (number | null)[] = []) => {
    const excluded = new Set([actorId, ...skip]);
    if (t.assigneeId) {
      if (!excluded.has(t.assigneeId)) await toUser(t.assigneeId, key, extra);
      return;
    }
    if (!t.teamId) return;
    const team = await teamName(t.teamId);
    for (const id of await teamRecipients(deps, t.teamId, actorId)) if (!excluded.has(id)) await toUser(id, key, { team, ...extra });
  };

  switch (event.kind) {
    case 'created':
      toTeams('created', `created:${t.id}`);
      break;
    case 'assigned':
      await toUser(t.assigneeId, 'assigned');
      break;
    case 'team_assigned': {
      if (!t.teamId || t.assigneeId) break;
      const team = await teamName(t.teamId);
      for (const id of await teamRecipients(deps, t.teamId, event.actorId)) await toUser(id, 'team_assigned', { team });
      break;
    }
    case 'agent_reply': {
      const requester = await loadUser(t.requesterId);
      // Requesters created by external systems have no inbox worth mailing unless they are real users.
      if (requester && requester.roleKey !== 'api_client') await toUser(t.requesterId, 'agent_reply', { reply: event.body }, ['email']);
      // Whoever handles the ticket also hears about replies written by someone else (e.g. HQ asking for a status
      // update on a ticket the SOC opened): the assignee, or the team while nobody has claimed it.
      await toHandlers('staff_reply', event.actorId, { reply: event.body }, [t.requesterId]);
      break;
    }
    case 'customer_reply':
      await toHandlers('customer_reply', event.actorId, { reply: event.body });
      break;
    case 'sla_breached':
      await toHandlers('sla_breached', null);
      toTeams('sla_breached', `sla_breached:${t.id}`);
      break;
    case 'sla_at_risk':
      await toHandlers('sla_at_risk', null);
      break;
    case 'nudge':
      await toHandlers('nudge', event.actorId, { actor: event.actor, message: event.message });
      break;
  }
  await enqueue(deps, messages);
}

/** E-mail over SMTP or the Resend HTTP API (settings page). */
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

/** Built on every dispatch run from the current settings page values (DECISIONS D13). */
export async function defaultSenders(deps: Deps): Promise<Senders> {
  const senders: Senders = {};
  const { email, telegramBotToken, teamsWebhookUrl } = await notifyTransports(deps.db, deps.secretBox);
  if (email) senders.email = emailSender(email);
  if (telegramBotToken) {
    const token = telegramBotToken;
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
  if (teamsWebhookUrl) {
    const url = teamsWebhookUrl;
    senders.teams = async (title, text) => {
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
  const mail = await mailTransport(deps.db, deps.secretBox);
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

/**
 * Sends due outbox messages with exponential backoff; gives up after notifyMaxAttempts. While the master switch
 * is off nothing is sent: messages queued before it was turned off are marked 'disabled', so turning it back on
 * does not deliver a backlog of stale notifications.
 */
export async function dispatchPending(deps: Deps, senders: Senders, batchSize = 20): Promise<number> {
  const { db, clock, config } = deps;
  if (!(await getSetting(db, 'notify.enabled'))) {
    await db
      .update(notificationLogs)
      .set({ status: 'disabled' })
      .where(and(eq(notificationLogs.status, 'pending'), lte(notificationLogs.nextAttemptAt, clock())));
    return 0;
  }
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
        if (!senders.teams) throw new Error('teams channel not configured');
        await senders.teams(msg.subject, msg.body);
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
