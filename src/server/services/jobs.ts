import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Deps } from '../context.js';
import { tickets } from '../db/schema.js';
import { setSetting, getSetting } from './settings.js';
import { enqueue, notifyTicketEvent } from './notify.js';
import { agingCondition } from './tickets.js';

const ACTIVE = ['new', 'open'] as const; // pending_user is paused, resolved/closed are final

/**
 * Updates sla_status for running tickets and notifies once per breach.
 *  breached: first response or resolution is past due
 *  at_risk:  less than 25% of the resolution window remains
 */
export async function scanSla(deps: Deps) {
  const { db, clock } = deps;
  const now = clock();
  const breachedRows = await db
    .update(tickets)
    .set({ slaStatus: 'breached' })
    .where(
      and(
        inArray(tickets.status, [...ACTIVE]),
        or(
          lt(tickets.resolutionDueAt, now),
          and(isNull(tickets.firstRespondedAt), lt(tickets.firstResponseDueAt, now)),
        ),
        or(eq(tickets.slaStatus, 'on_track'), eq(tickets.slaStatus, 'at_risk')),
      ),
    )
    .returning();

  await db
    .update(tickets)
    .set({ slaStatus: 'at_risk' })
    .where(
      and(
        inArray(tickets.status, [...ACTIVE]),
        eq(tickets.slaStatus, 'on_track'),
        sql`${tickets.resolutionDueAt} - (${tickets.resolutionDueAt} - ${tickets.createdAt}) * 0.25 < ${now.toISOString()}::timestamptz`,
      ),
    );

  for (const ticket of breachedRows) {
    if (ticket.slaBreachNotifiedAt) continue;
    await notifyTicketEvent(deps, { kind: 'sla_breached', ticket });
    await db.update(tickets).set({ slaBreachNotifiedAt: now }).where(eq(tickets.id, ticket.id));
  }
  return breachedRows.length;
}

/** Once a day after AGING_DIGEST_HOUR (app timezone): post the "> 3 days unresolved" count to Teams. */
export async function agingDigest(deps: Deps) {
  const { db, clock, config, glossary } = deps;
  const now = clock();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (Number(parts.hour) < config.agingDigestHour) return false;
  if ((await getSetting(db, 'jobs.aging_digest_last_run')) === today) return false;
  await setSetting(db, 'jobs.aging_digest_last_run', today);

  const [{ n }] = await db.select({ n: count() }).from(tickets).where(agingCondition(now, 3));
  const locale = config.defaultLocale;
  const link = `${config.appUrl.replace(/\/$/, '')}/tickets?olderThanDays=3`;
  await enqueue(deps, [
    {
      eventId: `aging_digest:${today}`,
      channel: 'teams',
      recipient: 'default',
      subject: glossary.t(locale, 'notify.aging_digest.subject', { date: today }),
      body: glossary.t(locale, 'notify.aging_digest.teams', { count: n, link }),
    },
  ]);
  return true;
}
