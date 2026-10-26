import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationLogs, users } from '../src/server/db/schema.js';
import { createTestContext, databaseAt, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
const team = { desk: 0, network: 0 };

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  team.desk = (await admin.post('/api/v1/admin/teams', { name: 'Desk' })).body.id;
  team.network = (await admin.post('/api/v1/admin/teams', { name: 'Network' })).body.id;
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
  (await admin.post('/api/v1/tickets', { subject: `for team ${teamId}`, teamId, ...extra })).body;
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
    const desk = (await a.post('/api/v1/admin/teams', { name: 'Desk' })).body.id;
    const network = (await a.post('/api/v1/admin/teams', { name: 'Network' })).body.id;
    const agent = await fresh.createUser('mine@example.com', 'agent');
    await a.patch(`/api/v1/admin/users/${agent.id}`, { teamIds: [desk] });
    const mine = (await a.post('/api/v1/tickets', { subject: 'desk', teamId: desk })).body;
    await a.post('/api/v1/tickets', { subject: 'network', teamId: network });
    await a.post('/api/v1/tickets', { subject: 'no team' });

    const client = await fresh.login('mine@example.com');
    const items = (await client.get('/api/v1/tickets?teamId=mine')).body.items;
    expect(items.map((t: { number: string }) => t.number)).toEqual([mine.number]);
    // The admin is in no team: "mine" is empty even though it can read every ticket.
    expect((await a.get('/api/v1/tickets?teamId=mine')).body.items).toEqual([]);
    await fresh.close();
  });
});

describe('assigning a ticket to a team', () => {
  it('needs ticket:assign and an existing team; a team alone keeps the ticket new', async () => {
    const created = await admin.post('/api/v1/tickets', { subject: 'team only', teamId: team.desk });
    expect(created.status).toBe(201);
    const detail = (await admin.get(`/api/v1/tickets/${created.body.number}`)).body;
    expect(detail).toMatchObject({ status: 'new', assignee: null, team: { id: team.desk } });

    await user('requester-x@example.com', 'end_user');
    const requester = await ctx.login('requester-x@example.com');
    expect((await requester.post('/api/v1/tickets', { subject: 'x', teamId: team.desk })).status).toBe(403);
    expect((await admin.post('/api/v1/tickets', { subject: 'x', teamId: 999999 })).status).toBe(400);
  });

  it('notifies the internal, active team members except the one assigning', async () => {
    const ops = (await admin.post('/api/v1/admin/teams', { name: 'Operations' })).body.id;
    await user('lead@example.com', 'agent', [ops]);
    await user('peer@example.com', 'agent', [ops]);
    await user('manager@example.com', 'it_manager', [ops]);
    await user('ops-vendor@example.com', 'vendor', [ops]);
    await user('ops-user@example.com', 'end_user', [ops]);
    const inactive = await user('gone@example.com', 'agent', [ops]);
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, inactive.id));

    const lead = await ctx.login('lead@example.com');
    const ticket = (await lead.post('/api/v1/tickets', { subject: 'router down', teamId: ops })).body;
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
