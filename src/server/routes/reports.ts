import { and, count, desc, eq, inArray, isNotNull, notInArray, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { authOf, guard } from '../auth/session.js';
import type { AppEnv } from '../context.js';
import {
  CLOSED_STATUSES,
  customFields,
  helpTopics,
  notificationLogs,
  tags,
  ticketFieldValues,
  tickets,
  ticketTags,
} from '../db/schema.js';
import { can, isStaff } from '../rbac.js';
import { audit } from '../services/audit.js';
import {
  agingCondition,
  buildTicketConditions,
  customFieldFiltersFromQuery,
  dashboardCharts,
  dashboardRange,
  dashboardRangeSchema,
  decodeFieldValue,
  listTickets,
  ticketFilterSchema,
  withinDays,
} from '../services/tickets.js';
import { parseWith } from './util.js';

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const reportRoutes = new Hono<AppEnv>()
  .get('/dashboard', guard(), async (c) => {
    const { db, clock, config } = c.var.deps;
    const auth = authOf(c);
    const now = clock();
    // Two kinds of numbers (DECISIONS D16): the current state (open, aging, SLA at risk/breached, priority,
    // workload, teams) ignores the period; the period numbers count tickets created or resolved from..to.
    const range = dashboardRange(now, config.timezone, parseWith(dashboardRangeSchema, c.req.query()));
    const base = buildTicketConditions(auth, parseWith(ticketFilterSchema, {}), now, config.timezone);
    const where = (...extra: (SQL | undefined)[]) => and(...base, ...extra);
    const open = notInArray(tickets.status, CLOSED_STATUSES);
    const createdInRange = withinDays(tickets.createdAt, range.from, range.to, config.timezone);
    const resolvedInRange = withinDays(tickets.resolvedAt, range.from, range.to, config.timezone);
    const countWhere = async (cond: SQL | undefined) =>
      (await db.select({ n: count() }).from(tickets).where(cond))[0].n;

    const [openCount, newInRange, resolvedCount, olderThan3Days, breached, atRisk] = await Promise.all([
      countWhere(where(open)),
      countWhere(where(createdInRange)),
      countWhere(where(resolvedInRange)),
      countWhere(where(agingCondition(now, 3))),
      countWhere(where(open, eq(tickets.slaStatus, 'breached'))),
      countWhere(where(open, eq(tickets.slaStatus, 'at_risk'))),
    ]);

    const byStatus = await db.select({ key: tickets.status, n: count() }).from(tickets).where(where(createdInRange)).groupBy(tickets.status);
    const byPriority = await db.select({ key: tickets.priority, n: count() }).from(tickets).where(where(open)).groupBy(tickets.priority);
    const topTags = await db
      .select({ key: tags.name, n: count() })
      .from(ticketTags)
      .innerJoin(tags, eq(tags.id, ticketTags.tagId))
      .innerJoin(tickets, eq(tickets.id, ticketTags.ticketId))
      .where(where(createdInRange))
      .groupBy(tags.name)
      .orderBy(desc(count()))
      .limit(10);
    const topHelpTopics = await db
      .select({ key: helpTopics.name, n: count() })
      .from(tickets)
      .innerJoin(helpTopics, eq(helpTopics.id, tickets.helpTopicId))
      .where(where(createdInRange))
      .groupBy(helpTopics.name)
      .orderBy(desc(count()))
      .limit(10);
    const slaOutcomes = await db
      .select({ key: tickets.slaStatus, n: count() })
      .from(tickets)
      .where(where(isNotNull(tickets.resolvedAt), resolvedInRange, inArray(tickets.slaStatus, ['met', 'breached'])))
      .groupBy(tickets.slaStatus);
    const met = slaOutcomes.find((r) => r.key === 'met')?.n ?? 0;
    const missed = slaOutcomes.find((r) => r.key === 'breached')?.n ?? 0;
    const failedNotifications = isStaff(auth.permissions)
      ? (await db.select({ n: count() }).from(notificationLogs).where(eq(notificationLogs.status, 'dead')))[0].n
      : null;

    return c.json({
      range,
      openCount,
      newInRange,
      resolvedInRange: resolvedCount,
      olderThan3Days,
      slaBreached: breached,
      slaAtRisk: atRisk,
      slaMetRate: met + missed ? Math.round((met / (met + missed)) * 1000) / 10 : null,
      byStatus,
      byPriority,
      topTags,
      topHelpTopics,
      failedNotifications,
      ...(await dashboardCharts(c.var.deps, auth, range)),
    });
  })

  .get('/reports/tickets.csv', guard({ permission: 'report:export' }), async (c) => {
    const { db, clock } = c.var.deps;
    const auth = authOf(c);
    const query = c.req.query();
    const filters = { ...parseWith(ticketFilterSchema, query), customFields: customFieldFiltersFromQuery(query) };
    const { items } = await listTickets(c.var.deps, auth, filters, { all: true });

    // Custom field columns: every visible field that has a value in the result set.
    const ids = items.map((i) => i.id);
    const values = ids.length
      ? await db
          .select({ ticketId: ticketFieldValues.ticketId, key: customFields.key, label: customFields.label, type: customFields.type, value: ticketFieldValues.value })
          .from(ticketFieldValues)
          .innerJoin(customFields, eq(customFields.id, ticketFieldValues.fieldId))
          .where(
            and(
              inArray(ticketFieldValues.ticketId, ids),
              can(auth.permissions, 'ticket:note') ? undefined : eq(customFields.visibility, 'public'),
            ),
          )
      : [];
    const fieldCols = [...new Map(values.map((v) => [v.key, v.label])).entries()].sort();
    const byTicket = new Map<number, Map<string, unknown>>();
    for (const v of values) {
      const m = byTicket.get(v.ticketId) ?? new Map();
      const decoded = decodeFieldValue(v, v.value);
      m.set(v.key, Array.isArray(decoded) ? decoded.join('; ') : decoded);
      byTicket.set(v.ticketId, m);
    }

    const header = [
      'number', 'subject', 'status', 'priority', 'help_topic', 'team', 'requester', 'assignee', 'tags',
      'sla_status', 'first_response_due_at', 'resolution_due_at', 'created_at', 'resolved_at', 'age_hours',
      ...fieldCols.map(([key]) => `cf.${key}`),
    ];
    const lines = [header.map(csvCell).join(',')];
    for (const t of items) {
      lines.push(
        [
          t.number, t.subject, t.status, t.priority, t.helpTopic, t.team, t.requester?.email, t.assignee?.email,
          t.tags.join('; '), t.sla.status, t.sla.firstResponseDueAt, t.sla.resolutionDueAt, t.createdAt,
          t.resolvedAt, t.ageHours, ...fieldCols.map(([key]) => byTicket.get(t.id)?.get(key)),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    await audit(c, 'report.exported', undefined, { rows: items.length, query });
    const stamp = clock().toISOString().slice(0, 10);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="tickets-${stamp}.csv"`);
    // UTF-8 BOM so Excel opens Chinese text correctly.
    return c.body(`﻿${lines.join('\r\n')}\r\n`);
  });
