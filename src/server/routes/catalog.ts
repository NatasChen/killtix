import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { authOf, guard } from '../auth/session.js';
import type { AppEnv } from '../context.js';
import { cannedResponses, customFields, helpTopics, slaPlans, tags, teams, teamMembers, ticketForms, users } from '../db/schema.js';
import { forbidden } from '../errors.js';
import { can, isStaff } from '../rbac.js';

/** Read-only lookups used to build forms and filters. */
export const catalogRoutes = new Hono<AppEnv>()
  .get('/help-topics', guard({ tokenScope: 'tickets:write' }), async (c) => {
    const auth = authOf(c);
    const staff = isStaff(auth.permissions) || auth.via === 'token';
    const rows = await c.var.deps.db
      .select()
      .from(helpTopics)
      .where(and(eq(helpTopics.isActive, true), staff ? undefined : eq(helpTopics.isPublic, true)))
      .orderBy(asc(helpTopics.name));
    const formIds = [...new Set(rows.map((r) => r.formId).filter((id): id is number => id != null))];
    const fields = formIds.length
      ? await c.var.deps.db
          .select()
          .from(customFields)
          .where(
            and(
              inArray(customFields.formId, formIds),
              eq(customFields.isActive, true),
              staff ? undefined : eq(customFields.visibility, 'public'),
            ),
          )
          .orderBy(asc(customFields.sortOrder), asc(customFields.id))
      : [];
    return c.json(
      rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        parentId: t.parentId,
        fields: fields
          .filter((f) => f.formId === t.formId)
          .map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            isRequired: f.isRequired,
            options: f.options,
            visibility: f.visibility,
            isFilterable: f.isFilterable,
          })),
      })),
    );
  })

  // Team names and TeamIDs for routing a new ticket (`teamid`): API tokens, and people who may assign.
  .get('/teams', guard({ tokenScope: 'tickets:write' }), async (c) => {
    const auth = authOf(c);
    if (auth.via !== 'token' && !can(auth.permissions, 'ticket:assign')) throw forbidden();
    return c.json(await c.var.deps.db.select({ teamid: teams.teamid, name: teams.name }).from(teams).orderBy(asc(teams.name)));
  })

  .get('/catalog', guard(), async (c) => {
    const { db } = c.var.deps;
    const auth = authOf(c);
    const allTags = await db.select().from(tags).orderBy(asc(tags.name));
    if (!isStaff(auth.permissions)) return c.json({ tags: allTags });
    const filterableFields = await db
      .select({ key: customFields.key, label: customFields.label, type: customFields.type, options: customFields.options, form: ticketForms.name })
      .from(customFields)
      .innerJoin(ticketForms, eq(ticketForms.id, customFields.formId))
      .where(and(eq(customFields.isFilterable, true), eq(customFields.isActive, true)));
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email, role: users.roleKey })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.roleKey, ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user'])))
      .orderBy(asc(users.displayName));
    const memberships = await db
      .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(inArray(teamMembers.userId, userRows.map((u) => u.id)));
    const teamIdsByUser = new Map<number, number[]>();
    for (const m of memberships) teamIdsByUser.set(m.userId, [...(teamIdsByUser.get(m.userId) ?? []), m.teamId]);
    return c.json({
      tags: allTags,
      teams: await db.select().from(teams).orderBy(asc(teams.name)),
      slaPlans: await db.select().from(slaPlans).where(eq(slaPlans.isActive, true)),
      cannedResponses: await db.select().from(cannedResponses).where(eq(cannedResponses.isActive, true)).orderBy(asc(cannedResponses.name)),
      users: userRows.map((u) => ({ ...u, teamIds: teamIdsByUser.get(u.id) ?? [] })),
      filterableFields,
    });
  });
