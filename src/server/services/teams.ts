import { and, count, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { Deps } from '../context.js';
import type { DB } from '../db/client.js';
import { advisories, advisoryTargets, cannedResponses, CLOSED_STATUSES, helpTopics, teamMembers, teams, tickets } from '../db/schema.js';
import { ApiError, badRequest, notFound } from '../errors.js';

/*
 * Deactivating and deleting teams (DECISIONS D27), system administrators only.
 *  - Both need an empty team: no members, no unresolved tickets, not a help topic's default team, and no unfinished
 *    answer on a published advisory. The administrator removes or moves these first.
 *  - Deleting also needs a team that was never used: no tickets at all and no advisory history. A team with history
 *    can only be deactivated: it stays on its tickets and advisories, but is no longer offered anywhere new.
 */

export type Blocker = 'members' | 'open_tickets' | 'help_topics' | 'advisories' | 'tickets' | 'advisory_history';

export interface TeamUsage {
  members: number;
  openTickets: number;
  tickets: number;
  helpTopics: string[];
  advisoryTargets: number;
  unfinishedAdvisories: number;
}

export async function teamUsage(db: DB, teamId: number): Promise<TeamUsage> {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  const [members, openTickets, allTickets, topics, targets, unfinished] = await Promise.all([
    n(db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId))),
    n(db.select({ n: count() }).from(tickets).where(and(eq(tickets.teamId, teamId), notInArray(tickets.status, CLOSED_STATUSES)))),
    n(db.select({ n: count() }).from(tickets).where(eq(tickets.teamId, teamId))),
    db.select({ name: helpTopics.name }).from(helpTopics).where(eq(helpTopics.defaultTeamId, teamId)),
    n(db.select({ n: count() }).from(advisoryTargets).where(eq(advisoryTargets.teamId, teamId))),
    // the same "finished" rule as the advisory pages: not affected, or affected and done
    n(
      db
        .select({ n: count() })
        .from(advisoryTargets)
        .innerJoin(advisories, eq(advisories.id, advisoryTargets.advisoryId))
        .where(
          and(
            eq(advisoryTargets.teamId, teamId),
            eq(advisories.status, 'published'),
            sql`not (${or(
              eq(advisoryTargets.exposure, 'not_affected'),
              and(eq(advisoryTargets.exposure, 'affected'), eq(advisoryTargets.actionStatus, 'done')),
            )})`,
          ),
        ),
    ),
  ]);
  return { members, openTickets, tickets: allTickets, helpTopics: topics.map((t) => t.name), advisoryTargets: targets, unfinishedAdvisories: unfinished };
}

export function blockers(usage: TeamUsage) {
  const archive: Blocker[] = [];
  if (usage.members) archive.push('members');
  if (usage.openTickets) archive.push('open_tickets');
  if (usage.helpTopics.length) archive.push('help_topics');
  if (usage.unfinishedAdvisories) archive.push('advisories');
  const remove: Blocker[] = [...archive];
  if (usage.tickets) remove.push('tickets');
  if (usage.advisoryTargets) remove.push('advisory_history');
  return { archive, delete: remove };
}

async function loadTeam(db: DB, teamId: number) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) throw notFound();
  return team;
}

/** What still uses the team and what that blocks; shown before the administrator confirms. */
export async function teamUsageReport(deps: Deps, teamId: number) {
  const team = await loadTeam(deps.db, teamId);
  const usage = await teamUsage(deps.db, teamId);
  return { team: { id: team.id, name: team.name, archivedAt: team.archivedAt }, usage, blockers: blockers(usage) };
}

export async function archiveTeam(deps: Deps, teamId: number) {
  const team = await loadTeam(deps.db, teamId);
  if (team.archivedAt) throw new ApiError(409, 'team_inactive');
  const usage = await teamUsage(deps.db, teamId);
  const blocked = blockers(usage).archive;
  if (blocked.length) throw new ApiError(409, 'team_in_use', undefined, { blockers: blocked, usage });
  const [row] = await deps.db.update(teams).set({ archivedAt: deps.clock() }).where(eq(teams.id, teamId)).returning();
  return row;
}

export async function restoreTeam(deps: Deps, teamId: number) {
  const team = await loadTeam(deps.db, teamId);
  if (!team.archivedAt) throw new ApiError(409, 'team_active');
  const [row] = await deps.db.update(teams).set({ archivedAt: null }).where(eq(teams.id, teamId)).returning();
  return row;
}

export async function deleteTeam(deps: Deps, teamId: number) {
  const team = await loadTeam(deps.db, teamId);
  const usage = await teamUsage(deps.db, teamId);
  const blocked = blockers(usage).delete;
  if (blocked.length) throw new ApiError(409, 'team_in_use', undefined, { blockers: blocked, usage });
  await deps.db.transaction(async (tx) => {
    await tx.update(cannedResponses).set({ teamId: null }).where(eq(cannedResponses.teamId, teamId));
    await tx.delete(teams).where(eq(teams.id, teamId));
  });
  return team;
}

/**
 * Teams picked for something new (a ticket, a member, a help topic default, an advisory) must exist and be active:
 * unknown ids are 400 with the field path, deactivated ones 400 team_inactive.
 */
export async function assertActiveTeams(db: DB, teamIds: number[], path = 'teamIds') {
  const ids = [...new Set(teamIds)];
  if (!ids.length) return;
  const rows = await db.select({ id: teams.id, archivedAt: teams.archivedAt }).from(teams).where(inArray(teams.id, ids));
  if (rows.length !== ids.length) throw badRequest(undefined, { errors: [{ path, message: 'unknown team' }] });
  if (rows.some((r) => r.archivedAt)) throw new ApiError(400, 'team_inactive');
}

/** SQL condition: the team is active. */
export const activeTeam = isNull(teams.archivedAt);
