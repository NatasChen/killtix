import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, notificationLogs, users } from '../src/server/db/schema.js';
import { createTestContext, databaseAt, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
const team = { desk: 0, network: 0 };
// TeamID per team id: new tickets are routed by TeamID (DECISIONS D23)
const teamid = new Map<number, string>();
const newTeam = async (client: typeof admin, name: string) => {
  const body = (await client.post('/api/v1/admin/teams', { name })).body;
  teamid.set(body.id, body.teamid);
  return body.id as number;
};

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  team.desk = await newTeam(admin, 'Desk');
  team.network = await newTeam(admin, 'Network');
});
afterAll(async () => {
  await ctx.close();
});

const user = async (email: string, role: string, teamIds: number[] = []) => {
  const u = await ctx.createUser(email, role);
  if (teamIds.length) expect((await admin.patch(`/api/v1/admin/users/${u.id}`, { teamIds })).status).toBe(200);
  return u;
};
const ticketFor = async (teamId: number, extra: Record<string, unknown> = {}) =>
  (await admin.post('/api/v1/tickets', { subject: `for team ${teamId}`, teamid: teamid.get(teamId), ...extra })).body;
const teamMail = async (ticketId: number) =>
  (await ctx.db.select().from(notificationLogs).where(like(notificationLogs.eventId, `team_assigned:${ticketId}:%`)))
    .map((r) => r.recipient)
    .sort();

describe('upgrade: users.team_id moves to team_members, then the column is dropped (DECISIONS D14)', () => {
  // The schema after 0002 (users.team_id and team_members both exist): v0.4 data that is upgrading straight
  // through 0002–0004 has no team_members rows yet; v0.5/v0.6 already copied them at startup and set the flag.
  const legacy = async (backfilledAtStartup: boolean) => {
    const db = await databaseAt('0002_opposite_vance_astro');
    await db.query(`insert into roles (key, name) values ('agent', 'Agent')`);
    await db.query(`insert into teams (id, name) values (1, 'Desk'), (2, 'Network')`);
    await db.query(`insert into users (id, email, display_name, role_key, team_id) values (1, 'a@example.com', 'a', 'agent', 1), (2, 'b@example.com', 'b', 'agent', 2)`);
    if (backfilledAtStartup) {
      // v0.5/v0.6 copied both at startup and set the flag; an administrator then removed user 2 from Network
      await db.query(`insert into team_members (team_id, user_id) values (1, 1)`);
      await db.query(`insert into system_settings (key, value) values ('migrations.team_members_backfilled', 'true')`);
    }
    await db.upgrade();
    return db;
  };
  const state = async (db: Awaited<ReturnType<typeof legacy>>) => ({
    members: (await db.query('select team_id, user_id from team_members order by user_id')).map((r) => [r.team_id, r.user_id]),
    column: (await db.query(`select 1 from information_schema.columns where table_name = 'users' and column_name = 'team_id'`)).length,
    flag: (await db.query(`select 1 from system_settings where key = 'migrations.team_members_backfilled'`)).length,
  });

  it('copies users.team_id into team_members when upgrading straight from v0.4', async () => {
    const db = await legacy(false);
    try {
      expect(await state(db)).toEqual({ members: [[1, 1], [2, 2]], column: 0, flag: 0 });
    } finally {
      await db.close();
    }
  });

  it('does not re-add members removed after the v0.5 startup backfill', async () => {
    const db = await legacy(true);
    try {
      expect(await state(db)).toEqual({ members: [[1, 1]], column: 0, flag: 0 });
    } finally {
      await db.close();
    }
  });
});

describe('team membership', () => {
  it('reads and writes several teams through the user API, /auth/me and /catalog', async () => {
    const u = await user('two-teams@example.com', 'agent', [team.desk, team.network]);
    const listed = (await admin.get('/api/v1/admin/users?q=two-teams')).body[0];
    expect(listed.teamIds.sort()).toEqual([team.desk, team.network].sort());
    const me = (await (await ctx.login('two-teams@example.com')).get('/api/v1/auth/me')).body;
    expect(me.user.teamIds.sort()).toEqual([team.desk, team.network].sort());
    const catalog = (await admin.get('/api/v1/catalog')).body;
    expect(catalog.users.find((x: { id: number }) => x.id === u.id).teamIds.sort()).toEqual([team.desk, team.network].sort());

    expect((await admin.patch(`/api/v1/admin/users/${u.id}`, { teamIds: [] })).body.teamIds).toEqual([]);
    expect((await admin.patch(`/api/v1/admin/users/${u.id}`, { teamIds: [999999] })).status).toBe(400);
    const created = await admin.post('/api/v1/admin/users', { email: 'new-member@example.com', displayName: 'New', role: 'agent', teamIds: [team.network] });
    expect(created.body.user.teamIds).toEqual([team.network]);
  });
});

describe('team visibility (SQL scope, 404 when hidden)', () => {
  it('lets an engineer see every team they belong to, and nothing else', async () => {
    await user('both@example.com', 'agent', [team.desk, team.network]);
    const only = await user('desk-only@example.com', 'agent', [team.desk]);
    const desk = await ticketFor(team.desk);
    const network = await ticketFor(team.network);

    const both = await ctx.login('both@example.com');
    expect((await both.get(`/api/v1/tickets/${desk.number}`)).status).toBe(200);
    expect((await both.get(`/api/v1/tickets/${network.number}`)).status).toBe(200);

    const deskOnly = await ctx.login('desk-only@example.com');
    expect((await deskOnly.get(`/api/v1/tickets/${network.number}`)).status).toBe(404);
    const numbers = (await deskOnly.get('/api/v1/tickets?perPage=100')).body.items.map((t: { number: string }) => t.number);
    expect(numbers).toContain(desk.number);
    expect(numbers).not.toContain(network.number);

    // Removing the membership takes effect on the next request.
    await admin.patch(`/api/v1/admin/users/${only.id}`, { teamIds: [] });
    expect((await deskOnly.get(`/api/v1/tickets/${desk.number}`)).status).toBe(404);
  });

  it('does not open team tickets to vendors or end users in the team', async () => {
    await user('team-vendor@example.com', 'vendor', [team.desk]);
    await user('team-requester@example.com', 'end_user', [team.desk]);
    const desk = await ticketFor(team.desk);
    for (const email of ['team-vendor@example.com', 'team-requester@example.com']) {
      const client = await ctx.login(email);
      expect((await client.get(`/api/v1/tickets/${desk.number}`)).status).toBe(404);
      const numbers = (await client.get('/api/v1/tickets?perPage=100')).body.items.map((t: { number: string }) => t.number);
      expect(numbers).not.toContain(desk.number);
    }
  });

  it('filters the list by teamId=mine', async () => {
    const fresh = await createTestContext();
    const a = await fresh.adminClient();
    // another database: its team ids repeat the shared context's, so this test keeps its own TeamIDs
    const desk = (await a.post('/api/v1/admin/teams', { name: 'Desk' })).body;
    const network = (await a.post('/api/v1/admin/teams', { name: 'Network' })).body;
    const agent = await fresh.createUser('mine@example.com', 'agent');
    await a.patch(`/api/v1/admin/users/${agent.id}`, { teamIds: [desk.id] });
    const mine = (await a.post('/api/v1/tickets', { subject: 'desk', teamid: desk.teamid })).body;
    await a.post('/api/v1/tickets', { subject: 'network', teamid: network.teamid });
    await a.post('/api/v1/tickets', { subject: 'no team' });

    const client = await fresh.login('mine@example.com');
    const items = (await client.get('/api/v1/tickets?teamId=mine')).body.items;
    expect(items.map((t: { number: string }) => t.number)).toEqual([mine.number]);
    // The admin is in no team: "mine" is empty even though it can read every ticket.
    expect((await a.get('/api/v1/tickets?teamId=mine')).body.items).toEqual([]);
    await fresh.close();
  });
});

describe('TeamID (DECISIONS D23)', () => {
  const VALID = /^[a-z0-9]{32}$/;

  it('is generated when not given, lower-cased when given, unique, and audited when changed', async () => {
    const generated = (await admin.post('/api/v1/admin/teams', { name: 'TeamID auto' })).body;
    expect(generated.teamid).toMatch(VALID);
    expect(generated.teamid).not.toBe(teamid.get(team.desk));

    const code = '0B53939BF14E4D4D98D79C1DE67D6E18';
    const given = await admin.post('/api/v1/admin/teams', { name: 'TeamID given', teamid: code });
    expect(given.status).toBe(201);
    expect(given.body.teamid).toBe(code.toLowerCase());
    expect((await admin.post('/api/v1/admin/teams', { name: 'TeamID clash', teamid: code.toLowerCase() })).status).toBe(409);
    for (const bad of ['abc', 'g'.repeat(31), `${'a'.repeat(31)}-`, 'a'.repeat(33)]) {
      expect((await admin.post('/api/v1/admin/teams', { name: `TeamID ${bad}`, teamid: bad })).status, bad).toBe(400);
    }

    const changed = await admin.patch(`/api/v1/admin/teams/${generated.id}`, { teamid: 'c'.repeat(32) });
    expect(changed.body.teamid).toBe('c'.repeat(32));
    expect((await admin.patch(`/api/v1/admin/teams/${generated.id}`, { teamid: code.toLowerCase() })).status).toBe(409);
    const logged = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'admin.team_teamid_changed'), eq(auditLogs.targetId, String(generated.id))));
    expect(logged.map((r) => r.detail)).toEqual([{ from: generated.teamid, to: 'c'.repeat(32) }]);
  });

  it('is generated for every existing team when upgrading', async () => {
    const db = await databaseAt('0006_users_theme_light_only');
    try {
      await db.query(`insert into teams (name) values ('Desk'), ('Network'), ('Lab')`);
      await db.upgrade();
      const codes = (await db.query('select teamid from teams')).map((r) => r.teamid as string);
      expect(codes).toHaveLength(3);
      for (const c of codes) expect(c).toMatch(VALID);
      expect(new Set(codes).size).toBe(3);
    } finally {
      await db.close();
    }
  });
});

describe('assigning a ticket to a team', () => {
  it('needs ticket:assign and an existing team; a team alone keeps the ticket new', async () => {
    const created = await admin.post('/api/v1/tickets', { subject: 'team only', teamid: teamid.get(team.desk) });
    expect(created.status).toBe(201);
    const detail = (await admin.get(`/api/v1/tickets/${created.body.number}`)).body;
    expect(detail).toMatchObject({ status: 'new', assignee: null, team: { id: team.desk } });

    await user('requester-x@example.com', 'end_user');
    const requester = await ctx.login('requester-x@example.com');
    expect((await requester.post('/api/v1/tickets', { subject: 'x', teamid: teamid.get(team.desk) })).status).toBe(403);
    expect((await admin.post('/api/v1/tickets', { subject: 'x', teamid: '0'.repeat(32) })).status).toBe(400);
  });

  it('notifies the internal, active team members except the one assigning', async () => {
    const ops = await newTeam(admin, 'Operations');
    await user('lead@example.com', 'agent', [ops]);
    await user('peer@example.com', 'agent', [ops]);
    await user('manager@example.com', 'it_manager', [ops]);
    await user('ops-vendor@example.com', 'vendor', [ops]);
    await user('ops-user@example.com', 'end_user', [ops]);
    const inactive = await user('gone@example.com', 'agent', [ops]);
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, inactive.id));

    const lead = await ctx.login('lead@example.com');
    const ticket = (await lead.post('/api/v1/tickets', { subject: 'router down', teamid: teamid.get(ops) })).body;
    expect(await teamMail(ticket.id)).toEqual(['manager@example.com', 'peer@example.com']);

    // With an assignee only the assignee is told.
    const assigned = await ticketFor(ops, { assigneeId: (await user('owner@example.com', 'agent')).id });
    expect(await teamMail(assigned.id)).toEqual([]);

    // Moving an unassigned ticket to the team notifies it too.
    const moved = (await admin.post('/api/v1/tickets', { subject: 'moved' })).body;
    await admin.patch(`/api/v1/tickets/${moved.number}`, { teamId: ops });
    expect(await teamMail(moved.id)).toEqual(['lead@example.com', 'manager@example.com', 'peer@example.com']);
  });

  it('lets a team member claim the ticket ("I\'ll take it")', async () => {
    const claimer = await user('claimer@example.com', 'agent', [team.desk]);
    const ticket = await ticketFor(team.desk);
    const client = await ctx.login('claimer@example.com');
    const res = await client.patch(`/api/v1/tickets/${ticket.number}`, { assigneeId: claimer.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'open', assignee: { id: claimer.id } });
  });
});

describe('team members on the teams page (DECISIONS D18)', () => {
  it('lists members with their current state and the users that can still be added', async () => {
    const ops = await newTeam(admin, 'Members Ops');
    const busy = await user('tm-ops-agent@example.com', 'agent', [ops]);
    await user('tm-ops-vendor@example.com', 'vendor', [ops]);
    const gone = await user('tm-ops-gone@example.com', 'agent', [ops]);
    await admin.patch(`/api/v1/admin/users/${gone.id}`, { isActive: false });
    await ctx.createUser('tm-ops-bot@example.com', 'api_client');
    await ctx.createUser('tm-ops-off@example.com', 'agent', { isActive: false });
    await ticketFor(ops, { assigneeId: busy.id }); // open → counted
    const done = await ticketFor(ops, { assigneeId: busy.id });
    await admin.patch(`/api/v1/tickets/${done.number}`, { status: 'resolved' }); // not open → not counted

    const res = await admin.get(`/api/v1/admin/teams/${ops}/members`);
    expect(res.status).toBe(200);
    const byEmail = Object.fromEntries(res.body.members.map((m: any) => [m.email, m]));
    expect(Object.keys(byEmail).sort()).toEqual(['tm-ops-agent@example.com', 'tm-ops-gone@example.com', 'tm-ops-vendor@example.com']);
    expect(byEmail['tm-ops-agent@example.com']).toMatchObject({ role: 'agent', isActive: true, openAssigned: 1, seesTeamTickets: true });
    expect(byEmail['tm-ops-vendor@example.com']).toMatchObject({ role: 'vendor', openAssigned: 0, seesTeamTickets: false });
    expect(byEmail['tm-ops-gone@example.com'].isActive).toBe(false);

    const candidates = res.body.candidates.map((u: any) => u.email);
    expect(candidates).toContain('admin@ticket.local');
    for (const email of ['tm-ops-agent@example.com', 'tm-ops-bot@example.com', 'tm-ops-off@example.com']) expect(candidates).not.toContain(email);
    expect((await admin.get('/api/v1/admin/teams/999999/members')).status).toBe(404);
  });

  it('adds and removes members (visibility follows at once), rejects bad users and needs catalog:manage', async () => {
    const lab = await newTeam(admin, 'Members Lab');
    const agent = await user('tm-lab-agent@example.com', 'agent');
    const ticket = await ticketFor(lab);
    const client = await ctx.login('tm-lab-agent@example.com');
    expect((await client.get(`/api/v1/tickets/${ticket.number}`)).status).toBe(404);

    expect((await admin.post(`/api/v1/admin/teams/${lab}/members`, { userIds: [agent.id, agent.id] })).status).toBe(204);
    expect((await admin.post(`/api/v1/admin/teams/${lab}/members`, { userIds: [agent.id] })).status).toBe(204); // already a member
    expect((await client.get(`/api/v1/tickets/${ticket.number}`)).status).toBe(200);
    expect((await admin.get('/api/v1/admin/teams')).body.find((t: any) => t.id === lab).memberCount).toBe(1);
    expect((await client.get('/api/v1/auth/me')).body.user.teamIds).toEqual([lab]);

    expect((await admin.del(`/api/v1/admin/teams/${lab}/members/${agent.id}`)).status).toBe(204);
    expect((await client.get(`/api/v1/tickets/${ticket.number}`)).status).toBe(404);
    expect((await admin.del(`/api/v1/admin/teams/${lab}/members/${agent.id}`)).status).toBe(404);

    const bot = await ctx.createUser('tm-lab-bot@example.com', 'api_client');
    const off = await ctx.createUser('tm-lab-off@example.com', 'agent', { isActive: false });
    for (const userIds of [[bot.id], [off.id], [999999], []]) {
      expect((await admin.post(`/api/v1/admin/teams/${lab}/members`, { userIds })).status, String(userIds)).toBe(400);
    }
    expect((await admin.post('/api/v1/admin/teams/999999/members', { userIds: [agent.id] })).status).toBe(404);

    // catalog:manage: an IT manager may, an engineer may not
    await ctx.createUser('tm-lab-manager@example.com', 'it_manager');
    const manager = await ctx.login('tm-lab-manager@example.com');
    expect((await manager.post(`/api/v1/admin/teams/${lab}/members`, { userIds: [agent.id] })).status).toBe(204);
    expect((await client.get(`/api/v1/admin/teams/${lab}/members`)).status).toBe(403);
    expect((await client.del(`/api/v1/admin/teams/${lab}/members/${agent.id}`)).status).toBe(403);

    const logged = await ctx.db.select().from(auditLogs).where(and(eq(auditLogs.targetType, 'team'), eq(auditLogs.targetId, String(lab))));
    expect(logged.map((r) => r.action).filter((a) => a.startsWith('admin.team_member')).sort()).toEqual(['admin.team_member_removed', 'admin.team_members_added', 'admin.team_members_added', 'admin.team_members_added']);
  });
});
