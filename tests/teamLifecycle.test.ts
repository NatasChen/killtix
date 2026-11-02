import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, helpTopics, teamMembers, teams, tickets } from '../src/server/db/schema.js';
import { createTestContext, type TestContext } from './helpers.js';

/** Deactivating and deleting teams (DECISIONS D27): system administrators only, empty teams only. */
let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
let agentId: number;

const newTeam = async (name: string) => (await admin.post('/api/v1/admin/teams', { name })).body as { id: number; teamid: string };
const usage = async (id: number) => (await admin.get(`/api/v1/admin/teams/${id}/usage`)).body;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  agentId = (await ctx.createUser('agent@example.com', 'agent')).id;
  await ctx.createUser('manager@example.com', 'it_manager');
});
afterAll(async () => {
  await ctx.close();
});

describe('deleting and deactivating teams', () => {
  it('is for system administrators only', async () => {
    const team = await newTeam('Managers cannot');
    const manager = await ctx.login('manager@example.com');
    expect((await manager.get(`/api/v1/admin/teams/${team.id}/usage`)).status).toBe(403);
    expect((await manager.post(`/api/v1/admin/teams/${team.id}/archive`)).status).toBe(403);
    expect((await manager.del(`/api/v1/admin/teams/${team.id}`)).status).toBe(403);
    expect((await manager.get('/api/v1/admin/teams')).status).toBe(200); // still manages the catalog
  });

  it('deletes an unused team, with an audit entry', async () => {
    const team = await newTeam('Created by mistake');
    expect((await usage(team.id)).blockers).toEqual({ archive: [], delete: [] });
    expect((await admin.del(`/api/v1/admin/teams/${team.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(teams).where(eq(teams.id, team.id))).toHaveLength(0);
    const [log] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'admin.team_deleted'));
    expect(log.detail).toEqual({ name: 'Created by mistake', teamid: team.teamid });
    expect((await admin.del(`/api/v1/admin/teams/${team.id}`)).status).toBe(404);
  });

  it('requires members removed, open tickets moved and help topics changed first', async () => {
    const team = await newTeam('Busy team');
    await admin.post(`/api/v1/admin/teams/${team.id}/members`, { userIds: [agentId] });
    const ticket = (await admin.post('/api/v1/tickets', { subject: 'still open', teamid: team.teamid })).body;
    const [topic] = await ctx.db.select().from(helpTopics).where(eq(helpTopics.slug, 'general'));
    await admin.patch(`/api/v1/admin/help-topics/${topic.id}`, { defaultTeamId: team.id });

    const report = await usage(team.id);
    expect(report.usage).toMatchObject({ members: 1, openTickets: 1, tickets: 1, helpTopics: [topic.name] });
    expect(report.blockers.archive).toEqual(['members', 'open_tickets', 'help_topics']);
    expect(report.blockers.delete).toEqual(['members', 'open_tickets', 'help_topics', 'tickets']);
    for (const res of [await admin.post(`/api/v1/admin/teams/${team.id}/archive`), await admin.del(`/api/v1/admin/teams/${team.id}`)]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('team_in_use');
    }

    // clear the way: remove the member, move the ticket, change the help topic
    await admin.del(`/api/v1/admin/teams/${team.id}/members/${agentId}`);
    const other = await newTeam('Takes over');
    await admin.patch(`/api/v1/tickets/${ticket.id}`, { teamId: other.id });
    await admin.patch(`/api/v1/admin/help-topics/${topic.id}`, { defaultTeamId: null });
    expect((await usage(team.id)).blockers).toEqual({ archive: [], delete: [] });
  });

  it('keeps a team with history: deactivating instead of deleting, and reactivating', async () => {
    const team = await newTeam('Had tickets');
    const ticket = (await admin.post('/api/v1/tickets', { subject: 'done long ago', teamid: team.teamid })).body;
    await admin.patch(`/api/v1/tickets/${ticket.id}`, { status: 'closed' });

    const del = await admin.del(`/api/v1/admin/teams/${team.id}`);
    expect(del.status).toBe(409);
    expect(del.body.blockers).toEqual(['tickets']);

    const archived = await admin.post(`/api/v1/admin/teams/${team.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();
    // the closed ticket keeps its team
    expect((await admin.get(`/api/v1/tickets/${ticket.id}`)).body.team).toMatchObject({ id: team.id, name: 'Had tickets' });
    expect((await admin.post(`/api/v1/admin/teams/${team.id}/archive`)).body.code).toBe('team_inactive');

    expect((await admin.post(`/api/v1/admin/teams/${team.id}/restore`)).body.archivedAt).toBeNull();
    expect((await admin.post(`/api/v1/admin/teams/${team.id}/restore`)).body.code).toBe('team_active');
    const actions = (await ctx.db.select().from(auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.team_archived', 'admin.team_restored']));
  });

  it('offers a deactivated team nowhere new: tickets (web and API), members, help topics, advisories, pickers, dashboard', async () => {
    const team = await newTeam('Retired');
    await admin.post(`/api/v1/admin/teams/${team.id}/archive`);
    const code = async (res: Promise<{ body: any }>) => (await res).body.code;

    expect(await code(admin.post('/api/v1/tickets', { subject: 'x', teamid: team.teamid }))).toBe('team_inactive');
    const ticket = (await admin.post('/api/v1/tickets', { subject: 'reassign' })).body;
    expect(await code(admin.patch(`/api/v1/tickets/${ticket.id}`, { teamId: team.id }))).toBe('team_inactive');
    expect(await code(admin.post(`/api/v1/admin/teams/${team.id}/members`, { userIds: [agentId] }))).toBe('team_inactive');
    const [topic] = await ctx.db.select().from(helpTopics).where(eq(helpTopics.slug, 'general'));
    expect(await code(admin.patch(`/api/v1/admin/help-topics/${topic.id}`, { defaultTeamId: team.id }))).toBe('team_inactive');
    expect(await code(admin.post('/api/v1/advisories', { title: 'x', teamIds: [team.id] }))).toBe('team_inactive');

    const names = (rows: { name: string }[]) => rows.map((r) => r.name);
    expect(names((await admin.get('/api/v1/catalog')).body.teams)).not.toContain('Retired');
    expect(names((await admin.get('/api/v1/admin/teams?active=1')).body)).not.toContain('Retired');
    const all = (await admin.get('/api/v1/admin/teams')).body;
    expect(all[all.length - 1]).toMatchObject({ name: 'Retired' }); // listed last on the teams page
    expect(names((await admin.get('/api/v1/dashboard')).body.byTeam)).not.toContain('Retired');

    // an external system routing to it gets a clear error instead of "unknown team"
    const tokenRes = await admin.post('/api/v1/admin/api-tokens', { name: 'soc', scopes: ['tickets:write', 'tickets:read'] });
    const soc = ctx.tokenClient(tokenRes.body.token);
    expect(names((await soc.get('/api/v1/teams')).body)).not.toContain('Retired');
    const res = await soc.post('/api/v1/tickets', { subject: 'alert', teamid: team.teamid });
    expect([res.status, res.body.code]).toEqual([400, 'team_inactive']);
    expect(await ctx.db.select().from(tickets).where(eq(tickets.subject, 'alert'))).toHaveLength(0);
  });

  it('blocks deactivating while a published advisory waits for the team, keeps the advisory history from deletion', async () => {
    const team = await newTeam('Advisory team');
    const adv = (
      await admin.post('/api/v1/advisories', { title: 'pending answer', responseDueAt: '2026-04-01T00:00:00Z', teamIds: [team.id], publish: true })
    ).body;
    expect((await usage(team.id)).blockers.archive).toEqual(['advisories']);
    await admin.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.id}`, { exposure: 'not_affected' });
    const report = await usage(team.id);
    expect(report.blockers).toEqual({ archive: [], delete: ['advisory_history'] });
    expect((await admin.post(`/api/v1/admin/teams/${team.id}/archive`)).status).toBe(200);
    // the advisory still shows the deactivated team's answer
    expect((await admin.get(`/api/v1/advisories/${adv.id}`)).body.targets.map((t: any) => t.team)).toEqual(['Advisory team']);
    expect(await ctx.db.select().from(teamMembers).where(eq(teamMembers.teamId, team.id))).toHaveLength(0);
  });
});
