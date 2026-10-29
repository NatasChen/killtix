import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AuthContext, Deps } from '../context.js';
import {
  CLOSED_STATUSES,
  customFields,
  helpTopics,
  slaPlans,
  tags,
  teamMembers,
  teams,
  ticketFieldValues,
  ticketNumberSeq,
  tickets,
  ticketTags,
  ticketThreads,
  ticketWatchers,
  users,
  type CustomField,
  type Ticket,
  type TicketStatus,
} from '../db/schema.js';
import type { DB } from '../db/client.js';
import { ApiError, badRequest, forbidden, notFound } from '../errors.js';
import { can, isStaff, ticketScope } from '../rbac.js';
import { notifyTicketEvent } from './notify.js';

type Actor = Pick<AuthContext, 'user' | 'permissions' | 'tokenId'>;

export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['open', 'pending_user', 'resolved', 'closed'],
  open: ['pending_user', 'resolved', 'closed'],
  pending_user: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: ['open'],
};

export const PRIORITY_ALIASES: Record<string, number> = { lowest: 1, low: 2, normal: 3, high: 4, critical: 5 };

export const prioritySchema = z.union([
  z.number().int().min(1).max(5),
  z.enum(Object.keys(PRIORITY_ALIASES) as [string, ...string[]]).transform((v) => PRIORITY_ALIASES[v]),
]);

// ---------------------------------------------------------------------------
// "Older than N days and not closed" — the single definition used by the ticket list,
// dashboard, CSV export and the daily digest. Strictly older: a ticket created exactly
// N*24h ago is NOT included.
// ---------------------------------------------------------------------------
export const agingCutoff = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

export const agingCondition = (now: Date, days: number) =>
  and(notInArray(tickets.status, CLOSED_STATUSES), lt(tickets.createdAt, agingCutoff(now, days)))!;

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------
function normalizeFieldValue(field: CustomField, raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null;
  const fail = (msg: string): never => {
    throw badRequest(undefined, { errors: [{ path: `customFields.${field.key}`, message: msg }] });
  };
  switch (field.type) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string') fail('must be a string');
      const value = (raw as string).trim();
      if (value.length > 10_000) fail('too long');
      if (field.regex && !new RegExp(field.regex).test(value)) fail('does not match the required format');
      return value;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) fail('must be a number');
      return String(n);
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
        fail('must be a date (YYYY-MM-DD)');
      }
      return raw as string;
    }
    case 'select': {
      if (typeof raw !== 'string' || !field.options.includes(raw)) fail('is not one of the allowed options');
      return raw as string;
    }
    case 'multiselect': {
      const values = Array.isArray(raw) ? raw : [raw];
      if (!values.every((v) => typeof v === 'string' && field.options.includes(v))) {
        fail('contains values that are not allowed options');
      }
      return JSON.stringify([...new Set(values as string[])].sort());
    }
    case 'checkbox': {
      if (typeof raw !== 'boolean' && raw !== 'true' && raw !== 'false') fail('must be a boolean');
      return String(raw === true || raw === 'true');
    }
    case 'email': {
      if (!z.email().safeParse(raw).success) fail('must be an e-mail address');
      return String(raw).toLowerCase();
    }
    case 'url': {
      if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw) || !z.url().safeParse(raw).success) {
        fail('must be an http(s) URL');
      }
      return raw as string;
    }
  }
  return fail('unsupported field type');
}

export function decodeFieldValue(field: Pick<CustomField, 'type'>, value: string): unknown {
  if (field.type === 'multiselect') return JSON.parse(value);
  if (field.type === 'checkbox') return value === 'true';
  if (field.type === 'number') return Number(value);
  return value;
}

async function validateCustomFields(db: DB, formId: number | null, staff: boolean, input: Record<string, unknown>) {
  const fields = formId
    ? await db
        .select()
        .from(customFields)
        .where(and(eq(customFields.formId, formId), eq(customFields.isActive, true)))
    : [];
  const writable = fields.filter((f) => staff || f.visibility === 'public');
  const unknown = Object.keys(input).filter((k) => !writable.some((f) => f.key === k));
  if (unknown.length) {
    throw badRequest(undefined, { errors: unknown.map((k) => ({ path: `customFields.${k}`, message: 'unknown field' })) });
  }
  const values: { fieldId: number; value: string }[] = [];
  for (const field of writable) {
    const value = normalizeFieldValue(field, input[field.key]);
    if (value === null) {
      // Internal fields are filled in by staff later, so only public fields are mandatory at creation.
      if (field.isRequired && field.visibility === 'public') {
        throw badRequest(undefined, { errors: [{ path: `customFields.${field.key}`, message: 'is required' }] });
      }
      continue;
    }
    values.push({ fieldId: field.id, value });
  }
  return values;
}

async function upsertTags(db: DB, names: string[]): Promise<number[]> {
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!clean.length) return [];
  await db.insert(tags).values(clean.map((name) => ({ name }))).onConflictDoNothing();
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, clean));
  return rows.map((r) => r.id);
}

async function existingTagIds(db: DB, names: string[]): Promise<number[]> {
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!clean.length) return [];
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, clean));
  return rows.map((r) => r.id);
}

function yearIn(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric' }).format(date);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
/** A team's TeamID (DECISIONS D23): 32 lower-case letters and digits; upper case is accepted and lowered. */
export const teamidSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{32}$/, '32 letters and digits');
// replaced by teamid (v0.12.0): rejected rather than ignored, so an integration still sending them notices
const replacedByTeamid = z.never({ error: 'replaced by teamid' }).optional();

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(512),
  description: z.string().max(100_000).default(''),
  priority: prioritySchema.default(3),
  helpTopicId: z.number().int().positive().optional(),
  helpTopic: z.string().max(64).optional(), // slug, convenient for external systems
  customFields: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  requesterId: z.number().int().positive().optional(),
  requester: z.object({ email: z.email().max(255), name: z.string().trim().min(1).max(128).optional() }).optional(),
  externalId: z.string().trim().min(1).max(255).optional(),
  assigneeId: z.number().int().positive().optional(), // web form; needs ticket:assign
  // Team by its TeamID; default: the help topic's team. Needs ticket:assign, except through an API token:
  // external systems may route a ticket to a team, but not to a person.
  teamid: teamidSchema.optional(),
  team: replacedByTeamid,
  teamId: replacedByTeamid,
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

const ASSIGNABLE_ROLES = ['super_admin', 'it_manager', 'agent', 'vendor'];

/** A team by its id (the web ticket page) or its TeamID (creating a ticket); 400 when there is none. */
async function resolveTeamId(db: DB, by: { id: number } | { teamid: string }): Promise<number> {
  const byId = 'id' in by;
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(byId ? eq(teams.id, by.id) : eq(teams.teamid, by.teamid));
  if (!team) throw badRequest(undefined, { errors: [{ path: byId ? 'teamId' : 'teamid', message: 'unknown team' }] });
  return team.id;
}

/** Only active staff and vendor accounts can be assignees. */
async function assertAssignable(db: DB, userId: number) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.isActive || !ASSIGNABLE_ROLES.includes(u.roleKey)) {
    throw badRequest(undefined, { errors: [{ path: 'assigneeId', message: 'user cannot be assigned' }] });
  }
}

export async function createTicket(
  deps: Deps,
  actor: Actor,
  input: CreateTicketInput,
  source: 'web' | 'api',
): Promise<{ ticket: Ticket; created: boolean }> {
  const { db, clock, config } = deps;
  const staff = isStaff(actor.permissions);
  const externalSource = actor.tokenId ? `token:${actor.tokenId}` : null;
  const externalId = externalSource ? (input.externalId ?? null) : null;

  if (externalSource && externalId) {
    const [existing] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.externalSource, externalSource), eq(tickets.externalId, externalId)));
    if (existing) return { ticket: existing, created: false };
  }

  // Help topic → form, SLA plan, team, auto tags
  let topic: typeof helpTopics.$inferSelect | undefined;
  if (input.helpTopicId || input.helpTopic) {
    [topic] = await db
      .select()
      .from(helpTopics)
      .where(
        and(
          input.helpTopicId ? eq(helpTopics.id, input.helpTopicId) : eq(helpTopics.slug, input.helpTopic!),
          eq(helpTopics.isActive, true),
        ),
      );
    if (!topic || (!staff && !topic.isPublic && source === 'web')) {
      throw badRequest(undefined, { errors: [{ path: 'helpTopic', message: 'unknown help topic' }] });
    }
  }
  let slaPlanId = topic?.slaPlanId ?? null;
  if (!slaPlanId) {
    const [plan] = await db.select({ id: slaPlans.id }).from(slaPlans).where(eq(slaPlans.isActive, true)).orderBy(asc(slaPlans.id)).limit(1);
    slaPlanId = plan?.id ?? null;
  }
  const [plan] = slaPlanId ? await db.select().from(slaPlans).where(eq(slaPlans.id, slaPlanId)) : [];

  const formId = topic?.formId ?? null;
  const fieldValues = await validateCustomFields(db, formId, staff || source === 'api', input.customFields);

  // Requester: staff and API clients may open tickets on behalf of someone else.
  let requesterId = actor.user.id;
  if (input.requesterId || input.requester) {
    if (!staff && source !== 'api') throw forbidden();
    if (input.requesterId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.requesterId));
      if (!u) throw badRequest(undefined, { errors: [{ path: 'requesterId', message: 'unknown user' }] });
      requesterId = u.id;
    } else {
      const email = input.requester!.email.toLowerCase();
      await db
        .insert(users)
        .values({ email, displayName: input.requester!.name ?? email, roleKey: 'end_user', identityProvider: 'external' })
        .onConflictDoNothing();
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      requesterId = u.id;
    }
  }

  if (input.assigneeId) {
    if (!can(actor.permissions, 'ticket:assign')) throw forbidden();
    await assertAssignable(db, input.assigneeId);
  }
  let teamId = topic?.defaultTeamId ?? null;
  if (input.teamid) {
    if (source !== 'api' && !can(actor.permissions, 'ticket:assign')) throw forbidden();
    teamId = await resolveTeamId(db, { teamid: input.teamid });
  }

  const now = clock();
  // Free-form tags are created by staff/API; end users may only pick existing tags.
  const requestedTagIds =
    staff || source === 'api' ? await upsertTags(db, input.tags) : await existingTagIds(db, input.tags);
  const tagIds = [...new Set([...requestedTagIds, ...(await upsertTags(db, topic?.autoTags ?? []))])];

  let ticket: Ticket;
  try {
    ticket = await db.transaction(async (tx) => {
      const [{ seq }] = await tx
        .select({ seq: sql<string>`nextval(${sql.raw(`'${ticketNumberSeq.seqName}'`)})` })
        .from(sql`(select 1) as one`);
      const number = `TCK-${yearIn(config.timezone, now)}-${String(seq).padStart(6, '0')}`;
      const [row] = await tx
        .insert(tickets)
        .values({
          number,
          subject: input.subject,
          description: input.description,
          priority: input.priority,
          helpTopicId: topic?.id ?? null,
          formId,
          slaPlanId,
          requesterId,
          teamId,
          // assigned on creation: someone is already working on it, as when assigning later
          ...(input.assigneeId ? { assigneeId: input.assigneeId, status: 'open' as const } : {}),
          source,
          externalSource,
          externalId,
          firstResponseDueAt: plan ? new Date(now.getTime() + plan.firstResponseMinutes * 60_000) : null,
          resolutionDueAt: plan ? new Date(now.getTime() + plan.resolutionMinutes * 60_000) : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (fieldValues.length) {
        await tx.insert(ticketFieldValues).values(fieldValues.map((v) => ({ ...v, ticketId: row.id })));
      }
      if (tagIds.length) await tx.insert(ticketTags).values(tagIds.map((tagId) => ({ ticketId: row.id, tagId })));
      await tx.insert(ticketThreads).values({
        ticketId: row.id,
        authorId: actor.user.id,
        type: 'system_event',
        visibility: 'internal',
        body: JSON.stringify({ event: 'created', source }),
        source,
        createdAt: now,
      });
      if (row.assigneeId) {
        await tx.insert(ticketThreads).values({
          ticketId: row.id,
          authorId: actor.user.id,
          type: 'system_event',
          visibility: 'internal',
          body: JSON.stringify({ event: 'assignee', from: null, to: row.assigneeId }),
          createdAt: now,
        });
      }
      return row;
    });
  } catch (err) {
    // Two concurrent requests with the same idempotency key: return the winner.
    if (externalSource && externalId && isUniqueViolation(err)) {
      const [existing] = await db
        .select()
        .from(tickets)
        .where(and(eq(tickets.externalSource, externalSource), eq(tickets.externalId, externalId)));
      if (existing) return { ticket: existing, created: false };
    }
    throw err;
  }

  await notifyTicketEvent(deps, { kind: 'created', ticket });
  if (ticket.assigneeId) await notifyTicketEvent(deps, { kind: 'assigned', ticket });
  else if (ticket.teamId) await notifyTicketEvent(deps, { kind: 'team_assigned', ticket, actorId: actor.user.id });
  return { ticket, created: true };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// List / filter
// ---------------------------------------------------------------------------
/** Comma-separated query parameter, each item validated by `schema`. */
const csv = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const parts = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
      const parsed = z.array(schema).safeParse(parts);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'invalid value' });
        return z.NEVER;
      }
      return parsed.data as z.output<T>[];
    });

export const ticketFilterSchema = z.object({
  status: csv(z.enum(['new', 'open', 'pending_user', 'resolved', 'closed'])),
  priority: csv(z.coerce.number().int().min(1).max(5)),
  tags: csv(z.string().max(64)),
  tagsMode: z.enum(['any', 'all']).default('any'),
  helpTopicId: z.coerce.number().int().positive().optional(),
  teamId: z.union([z.literal('mine'), z.coerce.number().int().positive()]).optional(), // mine = any of my teams
  requesterId: z.coerce.number().int().positive().optional(),
  assignee: z.union([z.enum(['me', 'none']), z.coerce.number().int().positive()]).optional(),
  slaStatus: z.enum(['on_track', 'at_risk', 'breached', 'met']).optional(),
  olderThanDays: z.coerce.number().int().min(1).max(3650).optional(),
  // created on or after / on or before these local calendar days (config.timezone), inclusive
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['created_at', '-created_at', 'updated_at', '-updated_at', 'priority', '-priority']).default('-created_at'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});
export type TicketFilters = z.infer<typeof ticketFilterSchema> & {
  /** custom field filters: key → { op, value } */
  customFields?: { key: string; op: 'equals' | 'contains'; value: string }[];
};

/** Extracts `cf.<key>=value` (equals) and `cfc.<key>=value` (contains) query parameters. */
export function customFieldFiltersFromQuery(query: Record<string, string>): TicketFilters['customFields'] {
  const out: NonNullable<TicketFilters['customFields']> = [];
  for (const [name, value] of Object.entries(query)) {
    const m = name.match(/^(cf|cfc)\.([A-Za-z0-9_-]{1,64})$/);
    if (m && value !== '') out.push({ key: m[2], op: m[1] === 'cf' ? 'equals' : 'contains', value: value.slice(0, 200) });
  }
  return out;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** The instant a local calendar day (YYYY-MM-DD, `plusDays` later) starts in `timezone`; computed in SQL. */
export const localDayStart = (date: string, timezone: string, plusDays = 0) =>
  sql`((${date}::date + ${plusDays}::int)::timestamp at time zone ${timezone})`;

/** `column` falls on one of the local calendar days from..to (inclusive). */
export const withinDays = (column: typeof tickets.createdAt | typeof tickets.resolvedAt, from: string, to: string, timezone: string) =>
  and(gte(column, localDayStart(from, timezone)), lt(column, localDayStart(to, timezone, 1)))!;

export function buildTicketConditions(actor: Actor, filters: TicketFilters, now: Date, timezone: string): SQL[] {
  const conds: SQL[] = [];
  const scope = ticketScope(actor.user, actor.permissions, actor.tokenId);
  if (scope) conds.push(scope);
  if (filters.status.length) conds.push(inArray(tickets.status, filters.status));
  if (filters.priority.length) conds.push(inArray(tickets.priority, filters.priority));
  if (filters.helpTopicId) conds.push(eq(tickets.helpTopicId, filters.helpTopicId));
  if (filters.teamId === 'mine') {
    conds.push(
      exists(
        sql`(select 1 from ${teamMembers} where ${and(eq(teamMembers.userId, actor.user.id), eq(teamMembers.teamId, tickets.teamId))})`,
      ),
    );
  } else if (filters.teamId) conds.push(eq(tickets.teamId, filters.teamId));
  if (filters.requesterId) conds.push(eq(tickets.requesterId, filters.requesterId));
  if (filters.assignee === 'me') conds.push(eq(tickets.assigneeId, actor.user.id));
  else if (filters.assignee === 'none') conds.push(isNull(tickets.assigneeId));
  else if (typeof filters.assignee === 'number') conds.push(eq(tickets.assigneeId, filters.assignee));
  if (filters.slaStatus) conds.push(eq(tickets.slaStatus, filters.slaStatus));
  if (filters.olderThanDays) conds.push(agingCondition(now, filters.olderThanDays));
  if (filters.createdFrom) conds.push(gte(tickets.createdAt, localDayStart(filters.createdFrom, timezone)));
  if (filters.createdTo) conds.push(lt(tickets.createdAt, localDayStart(filters.createdTo, timezone, 1)));
  if (filters.q) {
    const pattern = `%${escapeLike(filters.q)}%`;
    conds.push(or(ilike(tickets.subject, pattern), ilike(tickets.number, pattern))!);
  }
  if (filters.tags.length) {
    const names = filters.tags.map((t) => t.toLowerCase());
    const matching = sql`(select count(distinct ${tags.id}) from ${ticketTags} join ${tags} on ${tags.id} = ${ticketTags.tagId}
      where ${ticketTags.ticketId} = ${tickets.id} and ${inArray(tags.name, names)})`;
    conds.push(filters.tagsMode === 'all' ? sql`${matching} = ${names.length}` : sql`${matching} > 0`);
  }
  for (const f of filters.customFields ?? []) {
    const fieldMatch = and(
      eq(customFields.key, f.key),
      eq(customFields.isFilterable, true),
      isStaff(actor.permissions) ? undefined : eq(customFields.visibility, 'public'),
    );
    const valueMatch =
      f.op === 'equals'
        ? or(eq(ticketFieldValues.value, f.value), ilike(ticketFieldValues.value, `%${escapeLike(JSON.stringify(f.value))}%`))
        : ilike(ticketFieldValues.value, `%${escapeLike(f.value)}%`);
    conds.push(
      exists(
        sql`(select 1 from ${ticketFieldValues} join ${customFields} on ${customFields.id} = ${ticketFieldValues.fieldId}
          where ${ticketFieldValues.ticketId} = ${tickets.id} and ${fieldMatch} and ${valueMatch})`,
      ),
    );
  }
  return conds;
}

// ---------------------------------------------------------------------------
// Dashboard charts (GET /reports/dashboard). Every query starts from buildTicketConditions(), so
// each user only counts the tickets they can see; "older than 3 days" is agingCondition().
// ---------------------------------------------------------------------------
export const AGING_BUCKET_KEYS = ['0-1', '1-3', '3-7', '7-14', '14+'] as const;

const DAY_MS = 86_400_000;
const shiftDate = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

/** Today's calendar date (YYYY-MM-DD) in `timezone`. */
export const localToday = (now: Date, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The last `days` calendar dates (YYYY-MM-DD) in `timezone`, oldest first, ending today. */
export function recentDates(now: Date, timezone: string, days: number): string[] {
  const today = localToday(now, timezone);
  return Array.from({ length: days }, (_, i) => shiftDate(today, i - (days - 1)));
}

export const DASHBOARD_DEFAULT_DAYS = 30;
export const DASHBOARD_MAX_DAYS = 366;
/** Longer ranges are charted per week (Monday start) instead of per day. */
export const DASHBOARD_DAILY_MAX_DAYS = 92;

export const dashboardRangeSchema = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
export type DashboardRange = { from: string; to: string; days: number; unit: 'day' | 'week' };

/**
 * The dashboard period: local calendar days from..to, inclusive. Defaults to the last 30 days ending today;
 * only `to` given → the 30 days ending then; only `from` given → from then until today.
 */
export function dashboardRange(now: Date, timezone: string, query: z.infer<typeof dashboardRangeSchema>): DashboardRange {
  const to = query.to ?? localToday(now, timezone);
  const from = query.from ?? shiftDate(to, 1 - DASHBOARD_DEFAULT_DAYS);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  if (days < 1) throw badRequest(undefined, { errors: [{ path: 'from', message: 'from must not be after to' }] });
  if (days > DASHBOARD_MAX_DAYS) throw badRequest(undefined, { errors: [{ path: 'to', message: `at most ${DASHBOARD_MAX_DAYS} days` }] });
  return { from, to, days, unit: days > DASHBOARD_DAILY_MAX_DAYS ? 'week' : 'day' };
}

export async function dashboardCharts(deps: Deps, actor: Actor, range: DashboardRange) {
  const { db, clock, config } = deps;
  const now = clock();
  const base = buildTicketConditions(actor, ticketFilterSchema.parse({}), now, config.timezone);
  const where = (...extra: (SQL | undefined)[]) => and(...base, ...extra);
  const open = notInArray(tickets.status, CLOSED_STATUSES);
  const countWhere = async (cond: SQL | undefined) => (await db.select({ n: count() }).from(tickets).where(cond))[0].n;

  // Created / resolved per local calendar day of the range, grouped by the day string in SQL; zero-filled
  // in code. Ranges over 92 days are summed per week, each point dated by its first day inside the range.
  const perDay = async (column: typeof tickets.createdAt | typeof tickets.resolvedAt) => {
    const rows = await db
      .select({ day: sql<string>`to_char(${column} at time zone ${config.timezone}, 'YYYY-MM-DD')`, n: count() })
      .from(tickets)
      .where(where(isNotNull(column), withinDays(column, range.from, range.to, config.timezone)))
      .groupBy(sql`1`);
    return new Map(rows.map((r) => [r.day, r.n]));
  };
  const [created, resolved] = await Promise.all([perDay(tickets.createdAt), perDay(tickets.resolvedAt)]);
  const trend: { date: string; created: number; resolved: number }[] = [];
  for (let i = 0; i < range.days; i++) {
    const date = shiftDate(range.from, i);
    const monday = new Date(Date.parse(date)).getUTCDay() === 1;
    if (range.unit === 'day' || i === 0 || monday) trend.push({ date, created: 0, resolved: 0 });
    const point = trend[trend.length - 1];
    point.created += created.get(date) ?? 0;
    point.resolved += resolved.get(date) ?? 0;
  }

  // Open tickets by age: (0,1], (1,3], (3,7], (7,14], (14,∞) days. Everything above 3 days goes through
  // agingCondition(), so 3-7 + 7-14 + 14+ always equals the dashboard's olderThan3Days.
  const over3 = agingCondition(now, 3);
  const [d1, d3, d7, d14] = [1, 3, 7, 14].map((d) => agingCutoff(now, d));
  const bucketConds = [
    and(open, gte(tickets.createdAt, d1)),
    and(open, lt(tickets.createdAt, d1), gte(tickets.createdAt, d3)),
    and(over3, gte(tickets.createdAt, d7)),
    and(over3, lt(tickets.createdAt, d7), gte(tickets.createdAt, d14)),
    and(over3, lt(tickets.createdAt, d14)),
  ];
  const counts = await Promise.all(bucketConds.map((c) => countWhere(where(c))));
  const agingBuckets = AGING_BUCKET_KEYS.map((key, i) => ({ key, n: counts[i] }));

  // Open tickets per assignee (top 10 + unassigned) and per team (+ no team); staff only.
  let workload: { assigneeId: number | null; name: string | null; n: number }[] | null = null;
  let byTeam: { teamId: number | null; name: string | null; n: number }[] | null = null;
  if (isStaff(actor.permissions)) {
    const people = await db
      .select({ assigneeId: tickets.assigneeId, name: users.displayName, n: count() })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.assigneeId))
      .where(where(open))
      .groupBy(tickets.assigneeId, users.displayName)
      .orderBy(desc(count()), asc(users.displayName))
      .limit(10);
    const unassigned = await countWhere(where(open, isNull(tickets.assigneeId)));
    workload = [...people, { assigneeId: null, name: null, n: unassigned }];

    const groups = await db
      .select({ teamId: tickets.teamId, name: teams.name, n: count() })
      .from(tickets)
      .innerJoin(teams, eq(teams.id, tickets.teamId))
      .where(where(open))
      .groupBy(tickets.teamId, teams.name)
      .orderBy(desc(count()), asc(teams.name));
    const noTeam = await countWhere(where(open, isNull(tickets.teamId)));
    byTeam = [...groups, { teamId: null, name: null, n: noTeam }];
  }
  return { trend, agingBuckets, workload, byTeam };
}

const requesterUser = alias(users, 'requester');
const assigneeUser = alias(users, 'assignee');

export async function listTickets(deps: Deps, actor: Actor, filters: TicketFilters, opts: { all?: boolean } = {}) {
  const { db, clock } = deps;
  const where = and(...buildTicketConditions(actor, filters, clock(), deps.config.timezone));
  const sortCol = { created_at: tickets.createdAt, updated_at: tickets.updatedAt, priority: tickets.priority }[
    filters.sort.replace('-', '') as 'created_at'
  ];
  const order = filters.sort.startsWith('-') ? desc(sortCol) : asc(sortCol);

  const [{ total }] = await db.select({ total: count() }).from(tickets).where(where);
  let query = db
    .select({
      ticket: tickets,
      requester: { id: requesterUser.id, displayName: requesterUser.displayName, email: requesterUser.email },
      assignee: { id: assigneeUser.id, displayName: assigneeUser.displayName, email: assigneeUser.email },
      helpTopicName: helpTopics.name,
      teamName: teams.name,
    })
    .from(tickets)
    .leftJoin(requesterUser, eq(requesterUser.id, tickets.requesterId))
    .leftJoin(assigneeUser, eq(assigneeUser.id, tickets.assigneeId))
    .leftJoin(helpTopics, eq(helpTopics.id, tickets.helpTopicId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .where(where)
    .orderBy(order, desc(tickets.id))
    .$dynamic();
  if (opts.all) query = query.limit(50_000);
  else query = query.limit(filters.perPage).offset((filters.page - 1) * filters.perPage);
  const rows = await query;

  const tagMap = await tagsFor(db, rows.map((r) => r.ticket.id));
  const items = rows.map((r) => ({
    ...ticketSummary(r.ticket, clock()),
    requester: r.requester?.id ? r.requester : null,
    assignee: r.assignee?.id ? r.assignee : null,
    helpTopic: r.helpTopicName,
    team: r.teamName,
    tags: tagMap.get(r.ticket.id) ?? [],
  }));
  return { items, total, page: filters.page, perPage: filters.perPage };
}

export function ticketSummary(t: Ticket, now: Date) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    source: t.source,
    externalId: t.externalId,
    sla: {
      status: t.slaStatus,
      firstResponseDueAt: t.firstResponseDueAt,
      resolutionDueAt: t.resolutionDueAt,
      firstRespondedAt: t.firstRespondedAt,
      paused: t.slaPausedAt != null,
    },
    ageHours: Math.floor((now.getTime() - t.createdAt.getTime()) / 3_600_000),
    reopenCount: t.reopenCount,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
  };
}

async function tagsFor(db: DB, ticketIds: number[]) {
  const map = new Map<number, string[]>();
  if (!ticketIds.length) return map;
  const rows = await db
    .select({ ticketId: ticketTags.ticketId, name: tags.name })
    .from(ticketTags)
    .innerJoin(tags, eq(tags.id, ticketTags.tagId))
    .where(inArray(ticketTags.ticketId, ticketIds))
    .orderBy(asc(tags.name));
  for (const r of rows) map.set(r.ticketId, [...(map.get(r.ticketId) ?? []), r.name]);
  return map;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
/** Loads a ticket the actor may see, by id or number. Invisible tickets are a 404 (no existence leak). */
export async function loadVisibleTicket(deps: Deps, actor: Actor, idOrNumber: string): Promise<Ticket> {
  const key = /^\d+$/.test(idOrNumber) ? eq(tickets.id, Number(idOrNumber)) : eq(tickets.number, idOrNumber);
  const [row] = await deps.db
    .select()
    .from(tickets)
    .where(and(key, ticketScope(actor.user, actor.permissions, actor.tokenId)));
  if (!row) throw notFound();
  return row;
}

export async function ticketDetail(deps: Deps, actor: Actor, ticket: Ticket) {
  const { db, clock } = deps;
  const staff = isStaff(actor.permissions);
  const [requester] = ticket.requesterId
    ? await db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, ticket.requesterId))
    : [];
  const [assignee] = ticket.assigneeId
    ? await db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, ticket.assigneeId))
    : [];
  const [topic] = ticket.helpTopicId ? await db.select().from(helpTopics).where(eq(helpTopics.id, ticket.helpTopicId)) : [];
  const [team] = ticket.teamId ? await db.select().from(teams).where(eq(teams.id, ticket.teamId)) : [];
  const [slaPlan] = ticket.slaPlanId ? await db.select().from(slaPlans).where(eq(slaPlans.id, ticket.slaPlanId)) : [];

  const threads = await db
    .select({
      id: ticketThreads.id,
      type: ticketThreads.type,
      visibility: ticketThreads.visibility,
      body: ticketThreads.body,
      source: ticketThreads.source,
      createdAt: ticketThreads.createdAt,
      author: { id: users.id, displayName: users.displayName },
    })
    .from(ticketThreads)
    .leftJoin(users, eq(users.id, ticketThreads.authorId))
    .where(
      and(eq(ticketThreads.ticketId, ticket.id), staff ? undefined : eq(ticketThreads.visibility, 'public')),
    )
    .orderBy(asc(ticketThreads.createdAt), asc(ticketThreads.id));

  const fields = await db
    .select({ field: customFields, value: ticketFieldValues.value })
    .from(customFields)
    .leftJoin(
      ticketFieldValues,
      and(eq(ticketFieldValues.fieldId, customFields.id), eq(ticketFieldValues.ticketId, ticket.id)),
    )
    .where(
      and(
        ticket.formId ? eq(customFields.formId, ticket.formId) : sql`false`,
        eq(customFields.isActive, true),
        staff ? undefined : eq(customFields.visibility, 'public'),
      ),
    )
    .orderBy(asc(customFields.sortOrder), asc(customFields.id));

  const watchers = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(ticketWatchers)
    .innerJoin(users, eq(users.id, ticketWatchers.userId))
    .where(eq(ticketWatchers.ticketId, ticket.id));

  return {
    ...ticketSummary(ticket, clock()),
    description: ticket.description,
    requester: requester ?? null,
    assignee: assignee ?? null,
    helpTopic: topic ? { id: topic.id, slug: topic.slug, name: topic.name } : null,
    team: team ? { id: team.id, name: team.name, teamid: team.teamid } : null,
    slaPlan: slaPlan ? { id: slaPlan.id, name: slaPlan.name } : null,
    tags: (await tagsFor(db, [ticket.id])).get(ticket.id) ?? [],
    customFields: fields.map(({ field, value }) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      visibility: field.visibility,
      options: field.options,
      value: value == null ? null : decodeFieldValue(field, value),
    })),
    threads: threads.map((t) => ({ ...t, author: t.author?.id ? t.author : null })),
    watchers,
    allowedTransitions: can(actor.permissions, 'ticket:update') ? STATUS_TRANSITIONS[ticket.status] : [],
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
/** Computes the column changes for a status transition, including SLA pause/resume. */
export function statusChange(ticket: Ticket, to: TicketStatus, now: Date): Partial<Ticket> {
  if (!STATUS_TRANSITIONS[ticket.status].includes(to)) {
    throw new ApiError(409, 'invalid_transition', `${ticket.status} → ${to}`);
  }
  const patch: Partial<Ticket> = { status: to };
  // Resume the SLA clock: shift due dates by the time spent waiting on the user.
  if (ticket.status === 'pending_user' && ticket.slaPausedAt) {
    const pausedMs = now.getTime() - ticket.slaPausedAt.getTime();
    const shift = (d: Date | null) => (d ? new Date(d.getTime() + pausedMs) : d);
    patch.resolutionDueAt = shift(ticket.resolutionDueAt);
    if (!ticket.firstRespondedAt) patch.firstResponseDueAt = shift(ticket.firstResponseDueAt);
    patch.slaPausedAt = null;
  }
  if (to === 'pending_user') patch.slaPausedAt = now;
  const resolutionDue = patch.resolutionDueAt ?? ticket.resolutionDueAt;
  if ((to === 'resolved' || to === 'closed') && !ticket.resolvedAt) {
    patch.resolvedAt = now;
    patch.slaStatus = ticket.slaStatus === 'breached' || (resolutionDue && now > resolutionDue) ? 'breached' : 'met';
  }
  if (to === 'closed') patch.closedAt = now;
  if (to === 'open' && (ticket.status === 'resolved' || ticket.status === 'closed')) {
    patch.reopenCount = ticket.reopenCount + 1;
    patch.resolvedAt = null;
    patch.closedAt = null;
    patch.slaStatus = resolutionDue && now > resolutionDue ? 'breached' : 'on_track';
  }
  return patch;
}

export const updateTicketSchema = z
  .object({
    status: z.enum(['new', 'open', 'pending_user', 'resolved', 'closed']).optional(),
    priority: prioritySchema.optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    helpTopicId: z.number().int().positive().nullable().optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
    teamId: z.number().int().positive().nullable().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export async function updateTicket(
  deps: Deps,
  actor: Actor,
  ticket: Ticket,
  input: z.infer<typeof updateTicketSchema>,
) {
  const { db, clock } = deps;
  const now = clock();
  const perms = actor.permissions;
  const need = (p: string) => {
    if (!can(perms, p)) throw forbidden();
  };
  const patch: Partial<Ticket> = {};
  const events: Record<string, unknown>[] = [];

  if (input.status !== undefined && input.status !== ticket.status) {
    need('ticket:update');
    Object.assign(patch, statusChange(ticket, input.status, now));
    events.push({ event: 'status', from: ticket.status, to: input.status });
  }
  if (input.priority !== undefined && input.priority !== ticket.priority) {
    need('ticket:triage');
    patch.priority = input.priority;
    events.push({ event: 'priority', from: ticket.priority, to: input.priority });
  }
  if (input.helpTopicId !== undefined && input.helpTopicId !== ticket.helpTopicId) {
    need('ticket:triage');
    if (input.helpTopicId) {
      const [topic] = await db.select().from(helpTopics).where(eq(helpTopics.id, input.helpTopicId));
      if (!topic) throw badRequest(undefined, { errors: [{ path: 'helpTopicId', message: 'unknown help topic' }] });
    }
    patch.helpTopicId = input.helpTopicId;
    events.push({ event: 'help_topic', to: input.helpTopicId });
  }
  if (input.assigneeId !== undefined && input.assigneeId !== ticket.assigneeId) {
    need('ticket:assign');
    if (input.assigneeId) await assertAssignable(db, input.assigneeId);
    patch.assigneeId = input.assigneeId;
    if (input.assigneeId && ticket.status === 'new' && !patch.status) patch.status = 'open';
    events.push({ event: 'assignee', from: ticket.assigneeId, to: input.assigneeId });
  }
  if (input.teamId !== undefined && input.teamId !== ticket.teamId) {
    need('ticket:assign');
    if (input.teamId) await resolveTeamId(db, { id: input.teamId });
    patch.teamId = input.teamId;
    events.push({ event: 'team', from: ticket.teamId, to: input.teamId });
  }
  let fieldValues: { fieldId: number; value: string }[] | undefined;
  if (input.customFields) {
    need('ticket:triage');
    // Partial update: validate against the merged set of current and new values.
    const current = await db
      .select({ key: customFields.key, type: customFields.type, value: ticketFieldValues.value })
      .from(ticketFieldValues)
      .innerJoin(customFields, eq(customFields.id, ticketFieldValues.fieldId))
      .where(eq(ticketFieldValues.ticketId, ticket.id));
    const merged = Object.fromEntries(current.map((c) => [c.key, decodeFieldValue(c, c.value)]));
    fieldValues = await validateCustomFields(db, ticket.formId, true, { ...merged, ...input.customFields });
    events.push({ event: 'custom_fields', keys: Object.keys(input.customFields) });
  }
  let tagIds: number[] | undefined;
  if (input.tags) {
    need('ticket:triage');
    tagIds = await upsertTags(db, input.tags);
    events.push({ event: 'tags', to: input.tags });
  }

  if (!events.length) return ticket;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tickets)
      .set({ ...patch, updatedAt: now })
      .where(eq(tickets.id, ticket.id))
      .returning();
    if (tagIds) {
      await tx.delete(ticketTags).where(eq(ticketTags.ticketId, ticket.id));
      if (tagIds.length) await tx.insert(ticketTags).values(tagIds.map((tagId) => ({ ticketId: ticket.id, tagId })));
    }
    if (fieldValues) {
      await tx.delete(ticketFieldValues).where(eq(ticketFieldValues.ticketId, ticket.id));
      if (fieldValues.length) await tx.insert(ticketFieldValues).values(fieldValues.map((v) => ({ ...v, ticketId: ticket.id })));
    }
    for (const e of events) {
      await tx.insert(ticketThreads).values({
        ticketId: ticket.id,
        authorId: actor.user.id,
        type: 'system_event',
        visibility: 'internal',
        body: JSON.stringify(e),
        createdAt: now,
      });
    }
    return row;
  });

  if (patch.assigneeId) await notifyTicketEvent(deps, { kind: 'assigned', ticket: updated });
  // A team without an assignee yet: its members pick it up (the "claim" button sets the assignee).
  else if (patch.teamId && !updated.assigneeId) await notifyTicketEvent(deps, { kind: 'team_assigned', ticket: updated, actorId: actor.user.id });
  return updated;
}

// ---------------------------------------------------------------------------
// Threads (replies)
// ---------------------------------------------------------------------------
// Every reply is visible to everyone who can see the ticket; the writer only decides whether it is
// notified (DECISIONS D12). New internal notes are no longer accepted: strict() turns the old
// `type: 'internal_note'` into a 400 instead of silently publishing the text.
export const threadSchema = z
  .object({
    body: z.string().trim().min(1).max(100_000),
    notify: z.boolean().default(true),
  })
  .strict();

export async function addThread(deps: Deps, actor: Actor, ticket: Ticket, input: z.infer<typeof threadSchema>) {
  const { db, clock } = deps;
  const now = clock();
  const staff = isStaff(actor.permissions);
  if (!can(actor.permissions, 'ticket:reply')) throw forbidden();
  if (ticket.status === 'closed') throw new ApiError(409, 'ticket_closed');

  // Staff (and assigned vendors) answer the requester; everyone else writes as the customer.
  const isAgentSide = staff || (ticket.assigneeId === actor.user.id && actor.user.id !== ticket.requesterId);
  const type = isAgentSide ? 'agent_reply' : 'customer_message';
  const patch: Partial<Ticket> = {};
  if (type === 'agent_reply') {
    if (!ticket.firstRespondedAt) patch.firstRespondedAt = now;
    if (ticket.status === 'new') Object.assign(patch, statusChange(ticket, 'open', now));
  } else if (type === 'customer_message') {
    // A customer reply resumes a waiting ticket or reopens a resolved one.
    if (ticket.status === 'pending_user' || ticket.status === 'resolved') {
      Object.assign(patch, statusChange(ticket, 'open', now));
    }
  }

  const { thread, updated } = await db.transaction(async (tx) => {
    const [thread] = await tx
      .insert(ticketThreads)
      .values({
        ticketId: ticket.id,
        authorId: actor.user.id,
        type,
        visibility: 'public',
        body: input.body,
        createdAt: now,
      })
      .returning();
    const [updated] = await tx
      .update(tickets)
      .set({ ...patch, updatedAt: now })
      .where(eq(tickets.id, ticket.id))
      .returning();
    return { thread, updated };
  });

  if (input.notify) {
    const kind = type === 'agent_reply' ? 'agent_reply' : 'customer_reply';
    await notifyTicketEvent(deps, { kind, ticket: updated, threadId: thread.id, body: input.body });
  }
  return { thread, ticket: updated };
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------
export async function addWatcher(deps: Deps, ticket: Ticket, userId: number) {
  const [u] = await deps.db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.isActive) throw badRequest(undefined, { errors: [{ path: 'userId', message: 'unknown user' }] });
  await deps.db.insert(ticketWatchers).values({ ticketId: ticket.id, userId }).onConflictDoNothing();
}

export async function removeWatcher(deps: Deps, ticket: Ticket, userId: number) {
  await deps.db.delete(ticketWatchers).where(and(eq(ticketWatchers.ticketId, ticket.id), eq(ticketWatchers.userId, userId)));
}
