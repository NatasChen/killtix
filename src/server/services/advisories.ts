import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AuthContext, Deps } from '../context.js';
import {
  ACTION_PLANS,
  ACTION_STATUSES,
  ADVISORY_SEVERITIES,
  ADVISORY_STATUSES,
  advisories,
  advisoryNumberSeq,
  advisoryTargets,
  advisoryUpdates,
  teamMembers,
  teams,
  users,
  type Advisory,
  type AdvisoryTarget,
} from '../db/schema.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { can } from '../rbac.js';
import { enqueue, teamMembersWith } from './notify.js';
import { localToday } from './tickets.js';

type Actor = Pick<AuthContext, 'user' | 'permissions'>;

export const canManageAdvisories = (perms: string[]) => can(perms, 'advisory:manage');
export const canRespondAdvisories = (perms: string[]) => can(perms, 'advisory:respond');

// ---------------------------------------------------------------------------
// Visibility, applied in SQL like ticketScope() (AGENTS.md rule 1): HQ (advisory:manage) sees every advisory and
// every team's answer; a responder sees published or closed advisories sent to one of their teams, and only
// their own teams' answers. Anything else is a 404.
// ---------------------------------------------------------------------------
const memberOf = (actor: Actor, teamColumn: typeof advisoryTargets.teamId) =>
  exists(sql`(select 1 from ${teamMembers} where ${and(eq(teamMembers.userId, actor.user.id), eq(teamMembers.teamId, teamColumn))})`);

export function advisoryScope(actor: Actor): SQL | undefined {
  if (canManageAdvisories(actor.permissions)) return undefined;
  if (!canRespondAdvisories(actor.permissions)) return sql`false`;
  return and(
    ne(advisories.status, 'draft'),
    exists(
      sql`(select 1 from ${advisoryTargets} where ${and(eq(advisoryTargets.advisoryId, advisories.id), memberOf(actor, advisoryTargets.teamId))})`,
    ),
  )!;
}

export function targetScope(actor: Actor): SQL | undefined {
  if (canManageAdvisories(actor.permissions)) return undefined;
  return memberOf(actor, advisoryTargets.teamId);
}

/** Finished from HQ's point of view: not exposed, or exposed and remediated (or the risk accepted). */
const completeCond = or(
  eq(advisoryTargets.exposure, 'not_affected'),
  and(eq(advisoryTargets.exposure, 'affected'), eq(advisoryTargets.actionStatus, 'done')),
)!;
export const isComplete = (t: Pick<AdvisoryTarget, 'exposure' | 'actionStatus'>) =>
  t.exposure === 'not_affected' || (t.exposure === 'affected' && t.actionStatus === 'done');

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const longText = z.string().max(100_000);
const fields = {
  source: z.string().trim().max(255).nullable().optional(),
  severity: z.enum(ADVISORY_SEVERITIES).optional(),
  summary: longText.optional(),
  cves: z
    .array(z.string().trim().toUpperCase().regex(/^CVE-\d{4}-\d{4,}$/, 'CVE-YYYY-NNNN'))
    .max(200)
    .transform((v) => [...new Set(v)])
    .optional(),
  affectedProducts: longText.optional(),
  iocs: longText.optional(),
  references: longText.optional(),
  recommendation: longText.optional(),
  responseDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  teamIds: z
    .array(z.number().int().positive())
    .max(500)
    .transform((v) => [...new Set(v)])
    .optional(),
};
export const createAdvisorySchema = z
  .object({ title: z.string().trim().min(1).max(512), ...fields, publish: z.boolean().default(false) })
  .strict();
export const updateAdvisorySchema = z.object({ title: z.string().trim().min(1).max(512).optional(), ...fields }).strict();

export const respondSchema = z
  .object({
    exposure: z.enum(['investigating', 'not_affected', 'affected']),
    affectedScope: z.string().trim().max(20_000).default(''),
    actionPlan: z.enum(ACTION_PLANS).nullable().optional(),
    actionDetail: z.string().trim().max(20_000).default(''),
    actionStatus: z.enum(ACTION_STATUSES).nullable().optional(),
    targetDate: z.iso.date().nullable().optional(),
    note: z.string().trim().max(5_000).default(''),
  })
  .strict();

export const advisoryFilterSchema = z.object({
  status: z.enum(ADVISORY_STATUSES).optional(),
  // todo: advisories where one of my teams still owes an answer or a remediation
  todo: z.enum(['1']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

function yearIn(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(date);
}

const dueOf = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** Teams an advisory is sent to must exist and be active (D27); teams already on it may since have been deactivated. */
async function assertTeams(deps: Deps, teamIds: number[], already: number[] = []) {
  const fresh = teamIds.filter((id) => !already.includes(id));
  if (!fresh.length) return;
  const found = await deps.db.select({ id: teams.id, archivedAt: teams.archivedAt }).from(teams).where(inArray(teams.id, fresh));
  const missing = fresh.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw badRequest(undefined, { errors: missing.map((id) => ({ path: 'teamIds', message: `unknown team ${id}` })) });
  if (found.some((f) => f.archivedAt)) throw new ApiError(400, 'team_inactive');
}

// ---------------------------------------------------------------------------
// HQ: create, edit, publish, close, reopen, delete, remind
// ---------------------------------------------------------------------------
export async function loadVisibleAdvisory(deps: Deps, actor: Actor, idOrNumber: string): Promise<Advisory> {
  const key = /^\d+$/.test(idOrNumber) ? eq(advisories.id, Number(idOrNumber)) : eq(advisories.number, idOrNumber);
  const [row] = await deps.db.select().from(advisories).where(and(key, advisoryScope(actor)));
  if (!row) throw notFound();
  return row;
}

export async function createAdvisory(deps: Deps, actor: Actor, input: z.infer<typeof createAdvisorySchema>) {
  const { db, clock, config } = deps;
  const { teamIds = [], publish, responseDueAt, ...rest } = input;
  await assertTeams(deps, teamIds);
  const now = clock();
  const advisory = await db.transaction(async (tx) => {
    const [{ seq }] = await tx
      .select({ seq: sql<string>`nextval(${sql.raw(`'${advisoryNumberSeq.seqName}'`)})` })
      .from(sql`(select 1) as one`);
    const [row] = await tx
      .insert(advisories)
      .values({
        ...rest,
        number: `ADV-${yearIn(config.timezone, now)}-${String(seq).padStart(4, '0')}`,
        responseDueAt: dueOf(responseDueAt) ?? null,
        createdBy: actor.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (teamIds.length) await tx.insert(advisoryTargets).values(teamIds.map((teamId) => ({ advisoryId: row.id, teamId, createdAt: now, updatedAt: now })));
    return row;
  });
  return publish ? publishAdvisory(deps, actor, advisory) : advisory;
}

export async function updateAdvisory(deps: Deps, actor: Actor, advisory: Advisory, input: z.infer<typeof updateAdvisorySchema>) {
  const { db, clock } = deps;
  if (advisory.status === 'closed') throw new ApiError(409, 'advisory_closed');
  const { teamIds, responseDueAt, ...rest } = input;
  const now = clock();
  // checked before the transaction: a query on deps.db inside it would wait for the transaction's own connection
  if (teamIds) {
    const current = await db.select({ teamId: advisoryTargets.teamId }).from(advisoryTargets).where(eq(advisoryTargets.advisoryId, advisory.id));
    await assertTeams(deps, teamIds, current.map((t) => t.teamId));
  }
  let added: AdvisoryTarget[] = [];
  const updated = await db.transaction(async (tx) => {
    if (teamIds) {
      const current = await tx.select().from(advisoryTargets).where(eq(advisoryTargets.advisoryId, advisory.id));
      const removed = current.filter((c) => !teamIds.includes(c.teamId));
      // once sent, a team that has answered stays: its answer is part of the record
      if (removed.some((r) => r.exposure !== 'pending')) throw new ApiError(409, 'advisory_target_answered');
      if (removed.length) await tx.delete(advisoryTargets).where(inArray(advisoryTargets.id, removed.map((r) => r.id)));
      const newIds = teamIds.filter((id) => !current.some((c) => c.teamId === id));
      if (newIds.length) {
        added = await tx
          .insert(advisoryTargets)
          .values(newIds.map((teamId) => ({ advisoryId: advisory.id, teamId, createdAt: now, updatedAt: now })))
          .returning();
      }
    }
    const due = dueOf(responseDueAt);
    const [row] = await tx
      .update(advisories)
      .set({ ...rest, ...(due !== undefined ? { responseDueAt: due } : {}), updatedAt: now })
      .where(eq(advisories.id, advisory.id))
      .returning();
    return row;
  });
  // teams added to a published advisory are told right away, like the first ones
  if (updated.status === 'published') for (const target of added) await notifyTarget(deps, updated, target, 'advisory_published', actor.user.id);
  return updated;
}

export async function publishAdvisory(deps: Deps, actor: Actor, advisory: Advisory) {
  const { db, clock } = deps;
  if (advisory.status !== 'draft') throw new ApiError(409, 'advisory_not_draft');
  const targets = await db.select().from(advisoryTargets).where(eq(advisoryTargets.advisoryId, advisory.id));
  const errors = [
    ...(targets.length ? [] : [{ path: 'teamIds', message: 'choose at least one team' }]),
    ...(advisory.responseDueAt ? [] : [{ path: 'responseDueAt', message: 'is required to publish' }]),
  ];
  if (errors.length) throw badRequest(undefined, { errors });
  const now = clock();
  const [row] = await db
    .update(advisories)
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where(eq(advisories.id, advisory.id))
    .returning();
  for (const target of targets) await notifyTarget(deps, row, target, 'advisory_published', actor.user.id);
  return row;
}

export async function setAdvisoryStatus(deps: Deps, advisory: Advisory, to: 'closed' | 'published') {
  const from = to === 'closed' ? 'published' : 'closed';
  if (advisory.status !== from) throw new ApiError(409, to === 'closed' ? 'advisory_not_published' : 'advisory_not_closed');
  const now = deps.clock();
  const [row] = await deps.db
    .update(advisories)
    .set({ status: to, closedAt: to === 'closed' ? now : null, updatedAt: now })
    .where(eq(advisories.id, advisory.id))
    .returning();
  return row;
}

export async function deleteAdvisory(deps: Deps, advisory: Advisory) {
  if (advisory.status !== 'draft') throw new ApiError(409, 'advisory_not_draft');
  await deps.db.delete(advisories).where(eq(advisories.id, advisory.id));
}

/** Reminds the teams that have not finished (no answer yet, still investigating, or remediation not done). */
export async function remindAdvisory(deps: Deps, actor: Actor, advisory: Advisory, teamIds?: number[]) {
  if (advisory.status !== 'published') throw new ApiError(409, 'advisory_not_published');
  const targets = (await deps.db.select().from(advisoryTargets).where(eq(advisoryTargets.advisoryId, advisory.id))).filter(
    (t) => !isComplete(t) && (!teamIds?.length || teamIds.includes(t.teamId)),
  );
  const stamp = deps.clock().getTime();
  for (const target of targets) await notifyTarget(deps, advisory, target, 'advisory_reminder', actor.user.id, `${stamp}`);
  return targets.length;
}

// ---------------------------------------------------------------------------
// Teams: answer
// ---------------------------------------------------------------------------
export async function respondToAdvisory(deps: Deps, actor: Actor, advisory: Advisory, teamId: number, input: z.infer<typeof respondSchema>) {
  const { db, clock } = deps;
  const [target] = await db
    .select()
    .from(advisoryTargets)
    .where(and(eq(advisoryTargets.advisoryId, advisory.id), eq(advisoryTargets.teamId, teamId), targetScope(actor)));
  if (!target) throw notFound();
  if (!canManageAdvisories(actor.permissions) && !canRespondAdvisories(actor.permissions)) throw forbidden();
  if (advisory.status === 'closed') throw new ApiError(409, 'advisory_closed');
  if (advisory.status !== 'published') throw new ApiError(409, 'advisory_not_published');

  // Exposed: how and by when it is handled is required; not exposed: nothing else applies.
  const affected = input.exposure === 'affected';
  const errors: { path: string; message: string }[] = [];
  if (affected) {
    if (!input.actionPlan) errors.push({ path: 'actionPlan', message: 'is required when affected' });
    if (!input.actionStatus) errors.push({ path: 'actionStatus', message: 'is required when affected' });
    if (!input.targetDate && input.actionStatus !== 'done') errors.push({ path: 'targetDate', message: 'is required until done' });
  }
  if (errors.length) throw badRequest(undefined, { errors });
  const keep = input.exposure !== 'not_affected';
  const answer = {
    exposure: input.exposure,
    affectedScope: keep ? input.affectedScope : '',
    actionPlan: keep ? (input.actionPlan ?? null) : null,
    actionDetail: keep ? input.actionDetail : '',
    actionStatus: keep ? (input.actionStatus ?? null) : null,
    targetDate: keep ? (input.targetDate ?? null) : null,
  };
  const now = clock();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(advisoryTargets)
      .set({ ...answer, respondedBy: actor.user.id, respondedAt: now, updatedAt: now })
      .where(eq(advisoryTargets.id, target.id))
      .returning();
    await tx.insert(advisoryUpdates).values({ ...answer, targetId: target.id, authorId: actor.user.id, note: input.note, createdAt: now });
    return row;
  });
  // HQ's channel hears when a team turns out to be exposed
  if (affected && target.exposure !== 'affected') await notifyTeamsChannel(deps, advisory, updated, 'advisory_affected');
  return updated;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const n = (cond: SQL) => sql<number>`(count(*) filter (where ${cond}))::int`;

/** Per-advisory counts of the targets the actor can see. */
async function progressOf(deps: Deps, actor: Actor, ids: number[]) {
  if (!ids.length) return new Map<number, Progress>();
  const now = deps.clock();
  const today = localToday(now, deps.config.timezone);
  const rows = await deps.db
    .select({
      advisoryId: advisoryTargets.advisoryId,
      total: count(),
      responded: n(ne(advisoryTargets.exposure, 'pending')),
      affected: n(eq(advisoryTargets.exposure, 'affected')),
      complete: n(completeCond),
      // overdue counts only matter while the advisory is published
      overdueResponse: n(and(eq(advisoryTargets.exposure, 'pending'), sql`${advisories.responseDueAt} < ${now.toISOString()}::timestamptz`)!),
      overdueAction: n(and(eq(advisoryTargets.exposure, 'affected'), ne(advisoryTargets.actionStatus, 'done'), lt(advisoryTargets.targetDate, today))!),
    })
    .from(advisoryTargets)
    .innerJoin(advisories, eq(advisories.id, advisoryTargets.advisoryId))
    .where(and(inArray(advisoryTargets.advisoryId, ids), targetScope(actor)))
    .groupBy(advisoryTargets.advisoryId);
  return new Map(rows.map((r) => [r.advisoryId, r]));
}
type Progress = { total: number; responded: number; affected: number; complete: number; overdueResponse: number; overdueAction: number };
const NO_PROGRESS: Progress = { total: 0, responded: 0, affected: 0, complete: 0, overdueResponse: 0, overdueAction: 0 };

export function advisorySummary(a: Advisory) {
  return {
    id: a.id,
    number: a.number,
    title: a.title,
    severity: a.severity,
    status: a.status,
    cves: a.cves,
    responseDueAt: a.responseDueAt,
    publishedAt: a.publishedAt,
    closedAt: a.closedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export async function listAdvisories(deps: Deps, actor: Actor, filters: z.infer<typeof advisoryFilterSchema>) {
  const { db } = deps;
  const conds: (SQL | undefined)[] = [advisoryScope(actor)];
  if (filters.status) conds.push(eq(advisories.status, filters.status));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conds.push(or(ilike(advisories.title, pattern), ilike(advisories.number, pattern), ilike(sql`${advisories.cves}::text`, pattern)));
  }
  if (filters.todo) {
    conds.push(
      eq(advisories.status, 'published'),
      exists(
        sql`(select 1 from ${advisoryTargets} where ${and(
          eq(advisoryTargets.advisoryId, advisories.id),
          memberOf(actor, advisoryTargets.teamId),
          sql`not (${completeCond})`,
        )})`,
      ),
    );
  }
  const where = and(...conds);
  const [{ total }] = await db.select({ total: count() }).from(advisories).where(where);
  const rows = await db
    .select()
    .from(advisories)
    .where(where)
    // drafts and published ones first (HQ's work), then by newest
    .orderBy(sql`case ${advisories.status} when 'closed' then 1 else 0 end`, desc(advisories.createdAt), desc(advisories.id))
    .limit(filters.perPage)
    .offset((filters.page - 1) * filters.perPage);
  const ids = rows.map((r) => r.id);
  const progress = await progressOf(deps, actor, ids);
  // a responder also gets their own teams' answers on the list
  const mine =
    ids.length && !canManageAdvisories(actor.permissions)
      ? await db
          .select({ advisoryId: advisoryTargets.advisoryId, teamId: advisoryTargets.teamId, team: teams.name, exposure: advisoryTargets.exposure, actionStatus: advisoryTargets.actionStatus })
          .from(advisoryTargets)
          .innerJoin(teams, eq(teams.id, advisoryTargets.teamId))
          .where(and(inArray(advisoryTargets.advisoryId, ids), targetScope(actor)))
          .orderBy(asc(teams.name))
      : [];
  return {
    items: rows.map((r) => ({
      ...advisorySummary(r),
      progress: progress.get(r.id) ?? NO_PROGRESS,
      myTeams: mine.filter((m) => m.advisoryId === r.id).map(({ advisoryId: _, ...m }) => m),
    })),
    total,
    page: filters.page,
    perPage: filters.perPage,
  };
}

const responder = alias(users, 'responder');
const creator = alias(users, 'creator');

export async function advisoryDetail(deps: Deps, actor: Actor, advisory: Advisory) {
  const { db } = deps;
  const manage = canManageAdvisories(actor.permissions);
  const [author] = advisory.createdBy
    ? await db.select({ id: creator.id, displayName: creator.displayName }).from(creator).where(eq(creator.id, advisory.createdBy))
    : [];
  const targets = await db
    .select({ target: advisoryTargets, team: teams.name, responder: { id: responder.id, displayName: responder.displayName } })
    .from(advisoryTargets)
    .innerJoin(teams, eq(teams.id, advisoryTargets.teamId))
    .leftJoin(responder, eq(responder.id, advisoryTargets.respondedBy))
    .where(and(eq(advisoryTargets.advisoryId, advisory.id), targetScope(actor)))
    .orderBy(asc(teams.name));
  const history = targets.length
    ? await db
        .select({ update: advisoryUpdates, author: { id: users.id, displayName: users.displayName } })
        .from(advisoryUpdates)
        .leftJoin(users, eq(users.id, advisoryUpdates.authorId))
        .where(inArray(advisoryUpdates.targetId, targets.map((t) => t.target.id)))
        .orderBy(desc(advisoryUpdates.createdAt), desc(advisoryUpdates.id))
    : [];
  const myTeams = manage
    ? []
    : (await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, actor.user.id))).map((r) => r.teamId);
  const now = deps.clock();
  const today = localToday(now, deps.config.timezone);
  return {
    ...advisorySummary(advisory),
    source: advisory.source,
    summary: advisory.summary,
    affectedProducts: advisory.affectedProducts,
    iocs: advisory.iocs,
    references: advisory.references,
    recommendation: advisory.recommendation,
    createdBy: author ?? null,
    progress: (await progressOf(deps, actor, [advisory.id])).get(advisory.id) ?? NO_PROGRESS,
    targets: targets.map(({ target: t, team, responder: r }) => ({
      id: t.id,
      teamId: t.teamId,
      team,
      exposure: t.exposure,
      affectedScope: t.affectedScope,
      actionPlan: t.actionPlan,
      actionDetail: t.actionDetail,
      actionStatus: t.actionStatus,
      targetDate: t.targetDate,
      respondedAt: t.respondedAt,
      respondedBy: r?.id ? r : null,
      complete: isComplete(t),
      overdue:
        advisory.status === 'published' &&
        ((t.exposure === 'pending' && !!advisory.responseDueAt && advisory.responseDueAt < now) ||
          (t.exposure === 'affected' && t.actionStatus !== 'done' && !!t.targetDate && t.targetDate < today)),
      // HQ may also record an answer given another way (phone, mail) on a team's behalf
      canRespond: advisory.status === 'published' && (manage || (canRespondAdvisories(actor.permissions) && myTeams.includes(t.teamId))),
      history: history
        .filter((h) => h.update.targetId === t.id)
        .map(({ update: u, author: a }) => ({
          id: u.id,
          exposure: u.exposure,
          affectedScope: u.affectedScope,
          actionPlan: u.actionPlan,
          actionDetail: u.actionDetail,
          actionStatus: u.actionStatus,
          targetDate: u.targetDate,
          note: u.note,
          createdAt: u.createdAt,
          author: a?.id ? a : null,
        })),
    })),
    canManage: manage,
  };
}

/** The team table as CSV rows (HQ). */
export async function advisoryCsvRows(deps: Deps, actor: Actor, advisory: Advisory) {
  const detail = await advisoryDetail(deps, actor, advisory);
  return detail.targets.map((t) => [
    advisory.number,
    advisory.title,
    advisory.severity,
    t.team,
    t.exposure,
    t.affectedScope,
    t.actionPlan,
    t.actionDetail,
    t.actionStatus,
    t.targetDate,
    t.complete,
    t.overdue,
    t.respondedBy?.displayName,
    t.respondedAt,
  ]);
}

/** Dashboard card: what still needs attention — every team's for HQ, one's own teams' for responders. */
export async function advisoryDashboard(deps: Deps, actor: Actor) {
  const manage = canManageAdvisories(actor.permissions);
  if (!manage && !canRespondAdvisories(actor.permissions)) return null;
  const now = deps.clock();
  const today = localToday(now, deps.config.timezone);
  const [row] = await deps.db
    .select({
      openAdvisories: sql<number>`count(distinct ${advisories.id})::int`,
      awaitingResponse: n(eq(advisoryTargets.exposure, 'pending')),
      affectedOpen: n(and(eq(advisoryTargets.exposure, 'affected'), or(isNull(advisoryTargets.actionStatus), ne(advisoryTargets.actionStatus, 'done')))!),
      overdue: n(
        or(
          and(eq(advisoryTargets.exposure, 'pending'), sql`${advisories.responseDueAt} < ${now.toISOString()}::timestamptz`),
          and(eq(advisoryTargets.exposure, 'affected'), ne(advisoryTargets.actionStatus, 'done'), lt(advisoryTargets.targetDate, today)),
        )!,
      ),
    })
    .from(advisoryTargets)
    .innerJoin(advisories, eq(advisories.id, advisoryTargets.advisoryId))
    .where(and(eq(advisories.status, 'published'), targetScope(actor)));
  return { scope: manage ? ('all' as const) : ('mine' as const), ...row };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
type AdvisoryKey = 'advisory_published' | 'advisory_reminder' | 'advisory_due_soon' | 'advisory_overdue' | 'advisory_action_overdue';

function vars(deps: Deps, a: Advisory, locale: string, extra: Record<string, string> = {}) {
  const { glossary, config } = deps;
  const due = a.responseDueAt
    ? new Intl.DateTimeFormat(locale, { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(a.responseDueAt)
    : '—';
  return {
    number: a.number,
    title: a.title,
    severity: glossary.t(locale, `ui.advisory.severity.${a.severity}`),
    cves: a.cves.join(', ') || '—',
    due,
    link: `${config.appUrl.replace(/\/$/, '')}/advisories/${a.number}`,
    ...extra,
  };
}

/** E-mail and Telegram to the members of the target's team who answer advisories (vendors never do). */
export async function notifyTarget(deps: Deps, a: Advisory, target: AdvisoryTarget, key: AdvisoryKey, actorId: number | null, suffix = '') {
  const { db, glossary } = deps;
  const ids = await teamMembersWith(deps, target.teamId, actorId, (perms) => can(perms, 'advisory:respond'));
  if (!ids.length) return;
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, target.teamId));
  const people = await db.select().from(users).where(inArray(users.id, ids));
  const eventId = `${key}:${target.id}${suffix ? `:${suffix}` : ''}`;
  const messages = people.flatMap((u) => {
    const v = vars(deps, a, u.locale, { team: team?.name ?? '', targetDate: target.targetDate ?? '—' });
    const subject = glossary.t(u.locale, `notify.${key}.subject`, v);
    const body = glossary.t(u.locale, `notify.${key}.body`, v);
    return [
      { eventId, channel: 'email' as const, recipient: u.email, subject, body },
      ...(u.telegramChatId ? [{ eventId, channel: 'telegram' as const, recipient: u.telegramChatId, subject, body: `${subject}\n${v.link}` }] : []),
    ];
  });
  await enqueue(deps, messages);
}

/** HQ's Teams channel: a team found itself exposed, or a team missed the deadline. */
async function notifyTeamsChannel(deps: Deps, a: Advisory, target: AdvisoryTarget, key: 'advisory_affected' | 'advisory_overdue', suffix = '') {
  const { db, glossary, config } = deps;
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, target.teamId));
  const v = vars(deps, a, config.defaultLocale, { team: team?.name ?? '' });
  await enqueue(deps, [
    {
      eventId: `${key}:${target.id}${suffix ? `:${suffix}` : ''}`,
      channel: 'teams',
      recipient: 'default',
      subject: glossary.t(config.defaultLocale, `notify.${key}.subject`, v),
      body: glossary.t(config.defaultLocale, `notify.${key}.teams`, v),
    },
  ]);
}

/**
 * Background job (every few minutes): for published advisories, remind teams a day before the answer is due,
 * tell them (and HQ's channel) once it is overdue, and tell them when a planned remediation date has passed.
 * Each message goes out once: the outbox ignores a repeated (event, channel, recipient).
 */
export async function scanAdvisories(deps: Deps) {
  const { db, clock, config } = deps;
  const now = clock();
  const today = localToday(now, config.timezone);
  const soon = new Date(now.getTime() + 86_400_000);
  const rows = await db
    .select({ advisory: advisories, target: advisoryTargets })
    .from(advisoryTargets)
    .innerJoin(advisories, eq(advisories.id, advisoryTargets.advisoryId))
    .where(and(eq(advisories.status, 'published'), notInArray(advisoryTargets.exposure, ['not_affected'])));
  let sent = 0;
  for (const { advisory: a, target: t } of rows) {
    if (t.exposure === 'pending' && a.responseDueAt) {
      // keyed by the deadline, so moving the deadline starts the reminders over
      const due = String(a.responseDueAt.getTime());
      if (a.responseDueAt < now) {
        await notifyTarget(deps, a, t, 'advisory_overdue', null, due);
        await notifyTeamsChannel(deps, a, t, 'advisory_overdue', due);
        sent++;
      } else if (a.responseDueAt < soon) {
        await notifyTarget(deps, a, t, 'advisory_due_soon', null, due);
        sent++;
      }
    } else if (t.exposure === 'affected' && t.actionStatus !== 'done' && t.targetDate && t.targetDate < today) {
      // keyed by the date, so a team that moves its date and misses it again is told again
      await notifyTarget(deps, a, t, 'advisory_action_overdue', null, t.targetDate);
      sent++;
    }
  }
  return sent;
}
