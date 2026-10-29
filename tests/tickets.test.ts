import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationLogs, teamMembers, tickets, ticketThreads, users } from '../src/server/db/schema.js';
import { createTestContext, type TestContext } from './helpers.js';

let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;
let ids: Record<string, number>;
const HOUR = 3_600_000;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  const team = (await admin.post('/api/v1/admin/teams', { name: 'Service Desk' })).body;
  const otherTeam = (await admin.post('/api/v1/admin/teams', { name: 'Network' })).body;
  const agent = await ctx.createUser('agent@example.com', 'agent');
  const otherAgent = await ctx.createUser('agent2@example.com', 'agent');
  // Team visibility comes from team_members.
  await ctx.db.insert(teamMembers).values([
    { teamId: team.id, userId: agent.id },
    { teamId: otherTeam.id, userId: otherAgent.id },
  ]);
  ids = {
    team: team.id,
    otherTeam: otherTeam.id,
    agent: agent.id,
    otherAgent: otherAgent.id,
    vendor: (await ctx.createUser('vendor@example.com', 'vendor')).id,
    vendor2: (await ctx.createUser('vendor2@example.com', 'vendor')).id,
    user: (await ctx.createUser('user@example.com', 'end_user')).id,
    user2: (await ctx.createUser('user2@example.com', 'end_user')).id,
  };
});
afterAll(async () => {
  await ctx.close();
});

async function createAs(email: string, body: Record<string, unknown>) {
  const client = await ctx.login(email);
  const res = await client.post('/api/v1/tickets', body);
  expect(res.status, res.text).toBe(201);
  return res.body;
}

describe('ticket lifecycle', () => {
  it('creates a ticket with number, SLA due dates and help-topic defaults', async () => {
    const t = await createAs('user@example.com', { subject: 'VPN broken', description: 'cannot connect', helpTopic: 'general', priority: 'high' });
    expect(t.number).toMatch(/^TCK-2026-\d{6}$/);
    expect(t.priority).toBe(4);
    expect(t.status).toBe('new');
    // 標準 SLA: first response 4h, resolution 3d
    expect(new Date(t.sla.firstResponseDueAt).getTime() - ctx.clock.now.getTime()).toBe(4 * HOUR);
    expect(new Date(t.sla.resolutionDueAt).getTime() - ctx.clock.now.getTime()).toBe(72 * HOUR);
  });

  it('enforces the status machine (409 on illegal transitions) and counts reopens', async () => {
    const t = await createAs('user@example.com', { subject: 'state machine' });
    const agentClient = await ctx.login('agent@example.com');
    await admin.patch(`/api/v1/tickets/${t.id}`, { teamId: ids.team });
    expect((await agentClient.patch(`/api/v1/tickets/${t.id}`, { status: 'resolved' })).status).toBe(200);
    expect((await agentClient.patch(`/api/v1/tickets/${t.id}`, { status: 'pending_user' })).status).toBe(409);
    const reopened = await agentClient.patch(`/api/v1/tickets/${t.id}`, { status: 'open' });
    expect(reopened.body.reopenCount).toBe(1);
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it('pauses the SLA clock while waiting on the user and shifts due dates on resume', async () => {
    const t = await createAs('user@example.com', { subject: 'pause me', helpTopic: 'general' });
    const due = new Date(t.sla.resolutionDueAt).getTime();
    await admin.patch(`/api/v1/tickets/${t.id}`, { status: 'pending_user' });
    ctx.clock.advance(5 * HOUR);
    // The requester's reply resumes the ticket.
    const user = await ctx.login('user@example.com');
    expect((await user.post(`/api/v1/tickets/${t.id}/threads`, { body: 'here is the info' })).status).toBe(201);
    const detail = (await admin.get(`/api/v1/tickets/${t.id}`)).body;
    expect(detail.status).toBe('open');
    expect(new Date(detail.sla.resolutionDueAt).getTime()).toBe(due + 5 * HOUR);
  });

  it('records first response on the first public agent reply and moves new → open', async () => {
    const t = await createAs('user@example.com', { subject: 'first response' });
    const reply = await admin.post(`/api/v1/tickets/${t.id}/threads`, { body: 'looking into it' });
    expect(reply.body.type).toBe('agent_reply');
    const detail = (await admin.get(`/api/v1/tickets/${t.id}`)).body;
    expect(detail.status).toBe('open');
    expect(detail.sla.firstRespondedAt).not.toBeNull();
  });

  it('lets staff assign on creation: the ticket opens assigned and the assignee is notified', async () => {
    const t = (await admin.post('/api/v1/tickets', { subject: 'assigned on creation', assigneeId: ids.agent })).body;
    const detail = (await admin.get(`/api/v1/tickets/${t.id}`)).body;
    expect(detail.assignee.id).toBe(ids.agent);
    expect(detail.status).toBe('open');
    const mails = await ctx.db.select().from(notificationLogs).where(eq(notificationLogs.recipient, 'agent@example.com'));
    expect(mails.some((m) => m.eventId.startsWith(`assigned:${t.id}:`))).toBe(true);
  });

  it('rejects assignment on creation without ticket:assign or to a user who cannot be assigned', async () => {
    const user = await ctx.login('user@example.com');
    expect((await user.post('/api/v1/tickets', { subject: 'pick my own agent', assigneeId: ids.agent })).status).toBe(403);
    expect((await admin.post('/api/v1/tickets', { subject: 'to an end user', assigneeId: ids.user2 })).status).toBe(400);
  });
});

describe('RBAC and IDOR protection', () => {
  let assigned: number, watched: number, foreign: number, teamTicket: number;
  beforeAll(async () => {
    assigned = (await createAs('user@example.com', { subject: 'assigned to vendor' })).id;
    watched = (await createAs('user@example.com', { subject: 'vendor2 watches' })).id;
    foreign = (await createAs('user2@example.com', { subject: 'someone else' })).id;
    teamTicket = (await createAs('user2@example.com', { subject: 'network queue' })).id;
    await admin.patch(`/api/v1/tickets/${assigned}`, { assigneeId: ids.vendor });
    await admin.post(`/api/v1/tickets/${watched}/watchers`, { userId: ids.vendor2 });
    await admin.patch(`/api/v1/tickets/${teamTicket}`, { teamId: ids.otherTeam });
    // Internal notes can no longer be written (D12); one written before that change must stay staff-only.
    const [author] = await ctx.db.select().from(users).where(eq(users.email, 'admin@ticket.local'));
    await ctx.db.insert(ticketThreads).values({ ticketId: assigned, authorId: author.id, type: 'internal_note', visibility: 'internal', body: 'SECRET internal note' });
  });

  it('vendors see only tickets assigned to them or that they watch; others are 404', async () => {
    const vendor = await ctx.login('vendor@example.com');
    const list = (await vendor.get('/api/v1/tickets')).body;
    expect(list.items.map((t: any) => t.id)).toEqual([assigned]);
    expect((await vendor.get(`/api/v1/tickets/${foreign}`)).status).toBe(404);
    expect((await vendor.patch(`/api/v1/tickets/${foreign}`, { status: 'resolved' })).status).toBe(404);
    expect((await vendor.post(`/api/v1/tickets/${foreign}/threads`, { body: 'x' })).status).toBe(404);

    const vendor2 = await ctx.login('vendor2@example.com');
    expect((await vendor2.get(`/api/v1/tickets/${watched}`)).status).toBe(200);
    expect((await vendor2.get(`/api/v1/tickets/${assigned}`)).status).toBe(404);
  });

  it('removing a watcher revokes access immediately', async () => {
    await admin.del(`/api/v1/tickets/${watched}/watchers/${ids.vendor2}`);
    const vendor2 = await ctx.login('vendor2@example.com');
    expect((await vendor2.get(`/api/v1/tickets/${watched}`)).status).toBe(404);
  });

  it('never exposes earlier internal notes to vendors or requesters', async () => {
    for (const email of ['vendor@example.com', 'user@example.com']) {
      const client = await ctx.login(email);
      const detail = await client.get(`/api/v1/tickets/${assigned}`);
      expect(detail.status).toBe(200);
      expect(detail.text).not.toContain('SECRET internal note');
    }
    const staffView = await admin.get(`/api/v1/tickets/${assigned}`);
    expect(staffView.text).toContain('SECRET internal note');
  });

  it('accepts no new internal notes and forbids triage fields to non-staff', async () => {
    const vendor = await ctx.login('vendor@example.com');
    // the old request shape is rejected rather than silently published as a reply
    expect((await admin.post(`/api/v1/tickets/${assigned}/threads`, { type: 'internal_note', body: 'x' })).status).toBe(400);
    expect((await vendor.patch(`/api/v1/tickets/${assigned}`, { priority: 5 })).status).toBe(403);
    expect((await vendor.patch(`/api/v1/tickets/${assigned}`, { assigneeId: ids.vendor2 })).status).toBe(403);
    // Assigned vendors may move the status.
    expect((await vendor.patch(`/api/v1/tickets/${assigned}`, { status: 'resolved' })).status).toBe(200);
  });

  it('agents see their team queue but not other teams', async () => {
    const agent = await ctx.login('agent2@example.com');
    expect((await agent.get(`/api/v1/tickets/${teamTicket}`)).status).toBe(200);
    expect((await agent.get(`/api/v1/tickets/${foreign}`)).status).toBe(404);
  });

  it('end users see only their own tickets', async () => {
    const user2 = await ctx.login('user2@example.com');
    const items = (await user2.get('/api/v1/tickets?perPage=100')).body.items;
    expect(items.every((t: any) => t.requester.email === 'user2@example.com')).toBe(true);
    expect((await user2.get(`/api/v1/tickets/${assigned}`)).status).toBe(404);
  });

  it('only super admins reach the admin API', async () => {
    const manager = await ctx.createUser('manager@example.com', 'it_manager');
    const client = await ctx.login(manager.email);
    expect((await client.get('/api/v1/admin/users')).status).toBe(403);
    expect((await client.get('/api/v1/admin/help-topics')).status).toBe(200); // catalog:manage
  });
});

describe('"older than 3 days and not closed" filter', () => {
  it('excludes a ticket exactly 72h old and includes one 72h + 1s old', async () => {
    const fresh = await createTestContext();
    try {
      const a = await fresh.adminClient();
      const mk = async (subject: string, ageMs: number, status = 'open') => {
        const t = (await a.post('/api/v1/tickets', { subject })).body;
        await fresh.db
          .update(tickets)
          .set({ createdAt: new Date(fresh.clock.now.getTime() - ageMs), status: status as any })
          .where(eq(tickets.id, t.id));
        return t.id;
      };
      const exact = await mk('exactly 72h', 72 * HOUR);
      const over = await mk('72h + 1s', 72 * HOUR + 1000);
      const old = await mk('5 days', 120 * HOUR);
      await mk('5 days but resolved', 120 * HOUR, 'resolved');
      await mk('5 days but closed', 120 * HOUR, 'closed');
      await mk('1 day', 24 * HOUR);

      const list = (await a.get('/api/v1/tickets?olderThanDays=3&perPage=100')).body;
      expect(list.items.map((t: any) => t.id).sort()).toEqual([over, old].sort());
      expect(list.items.map((t: any) => t.id)).not.toContain(exact);

      // Dashboard and CSV use the same definition.
      expect((await a.get('/api/v1/dashboard')).body.olderThan3Days).toBe(2);
      const csv = await a.get('/api/v1/reports/tickets.csv?olderThanDays=3');
      expect(csv.text.trim().split('\r\n')).toHaveLength(3); // header + 2 rows
    } finally {
      await fresh.close();
    }
  });
});

describe('tags and custom fields', () => {
  let formId: number;
  beforeAll(async () => {
    formId = (await admin.post('/api/v1/admin/forms', { name: 'Incident form' })).body.id;
    await admin.post(`/api/v1/admin/forms/${formId}/fields`, { key: 'affected_host', label: 'Host', type: 'text', isRequired: true, isFilterable: true, regex: '^[A-Z0-9-]+$' });
    await admin.post(`/api/v1/admin/forms/${formId}/fields`, { key: 'env', label: 'Env', type: 'select', options: ['prod', 'dev'], isFilterable: true });
    await admin.post(`/api/v1/admin/forms/${formId}/fields`, { key: 'root_cause', label: 'Root cause', type: 'textarea', visibility: 'internal' });
    await admin.post('/api/v1/admin/help-topics', { slug: 'incident', name: 'Incident', formId });
  });

  it('validates required fields, regex and options', async () => {
    const user = await ctx.login('user@example.com');
    const missing = await user.post('/api/v1/tickets', { subject: 'x', helpTopic: 'incident' });
    expect(missing.status).toBe(400);
    expect(missing.body.errors[0].path).toBe('customFields.affected_host');
    const badRegex = await user.post('/api/v1/tickets', { subject: 'x', helpTopic: 'incident', customFields: { affected_host: 'bad host!' } });
    expect(badRegex.status).toBe(400);
    const badOption = await user.post('/api/v1/tickets', { subject: 'x', helpTopic: 'incident', customFields: { affected_host: 'H1', env: 'qa' } });
    expect(badOption.status).toBe(400);
    // End users cannot set internal fields.
    const internal = await user.post('/api/v1/tickets', { subject: 'x', helpTopic: 'incident', customFields: { affected_host: 'H1', root_cause: 'x' } });
    expect(internal.status).toBe(400);
  });

  it('filters by custom field values and by tags (any / all)', async () => {
    const a = (await admin.post('/api/v1/tickets', { subject: 'cf-a', helpTopic: 'incident', customFields: { affected_host: 'EDR-0421', env: 'prod' }, tags: ['edr', 'ransomware'] })).body;
    const b = (await admin.post('/api/v1/tickets', { subject: 'cf-b', helpTopic: 'incident', customFields: { affected_host: 'WEB-01', env: 'dev' }, tags: ['edr'] })).body;
    const byHost = (await admin.get('/api/v1/tickets?cf.affected_host=EDR-0421')).body.items;
    expect(byHost.map((t: any) => t.id)).toEqual([a.id]);
    const byEnv = (await admin.get('/api/v1/tickets?cf.env=dev')).body.items;
    expect(byEnv.map((t: any) => t.id)).toEqual([b.id]);
    const anyTag = (await admin.get('/api/v1/tickets?tags=edr,ransomware&tagsMode=any')).body.items.map((t: any) => t.id);
    expect(anyTag).toEqual(expect.arrayContaining([a.id, b.id]));
    const allTags = (await admin.get('/api/v1/tickets?tags=edr,ransomware&tagsMode=all')).body.items.map((t: any) => t.id);
    expect(allTags).toEqual([a.id]);
  });

  it('exports CSV with BOM, custom field columns and formula-injection protection', async () => {
    await admin.post('/api/v1/tickets', { subject: '=HYPERLINK("http://evil")', helpTopic: 'incident', customFields: { affected_host: 'H2' } });
    const csv = await admin.get('/api/v1/reports/tickets.csv?q=HYPERLINK');
    expect(csv.status).toBe(200);
    const raw = new Uint8Array(await (await ctx.app.request('/api/v1/reports/tickets.csv', { headers: { cookie: admin.cookie! } })).arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.text).toContain('cf.affected_host');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const user = await ctx.login('user@example.com');
    expect((await user.get('/api/v1/reports/tickets.csv')).status).toBe(403);
  });
});

describe('SOC integration via API token', () => {
  let token: string;
  beforeAll(async () => {
    const res = await admin.post('/api/v1/admin/api-tokens', { name: 'SOC', scopes: ['tickets:write', 'tickets:read'] });
    expect(res.status).toBe(201);
    token = res.body.token;
  });

  it('creates tickets idempotently with Idempotency-Key', async () => {
    const soc = ctx.tokenClient(token);
    const body = {
      subject: '[SOC] ransomware on EDR-0421',
      helpTopic: 'security-incident',
      priority: 5,
      requester: { email: 'soc@example.com', name: 'SOC Bot' },
      tags: ['ransomware'],
    };
    const first = await soc.post('/api/v1/tickets', body, { 'Idempotency-Key': 'SOC-2026-0001' });
    expect(first.status).toBe(201);
    expect(first.body.sla.resolutionDueAt).toBeTruthy();
    const replay = await soc.post('/api/v1/tickets', body, { 'Idempotency-Key': 'SOC-2026-0001' });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body.id).toBe(first.body.id);

    const detail = (await admin.get(`/api/v1/tickets/${first.body.id}`)).body;
    expect(detail.tags).toEqual(expect.arrayContaining(['ransomware', 'security']));
    expect(detail.requester.email).toBe('soc@example.com');
    expect((await soc.get(`/api/v1/tickets/${first.body.id}`)).status).toBe(200);
  });

  it('routes a ticket to a team by its TeamID and notifies its members, but cannot pick an assignee', async () => {
    const soc = ctx.tokenClient(token);
    const teams = await soc.get('/api/v1/teams');
    expect(teams.status).toBe(200);
    const teamidOf = (name: string): string => teams.body.find((t: { name: string }) => t.name === name).teamid;
    expect(Object.keys(teams.body[0]).sort()).toEqual(['name', 'teamid']);
    expect(teamidOf('Service Desk')).toMatch(/^[a-z0-9]{32}$/);

    // upper case is accepted
    const routed = await soc.post('/api/v1/tickets', { subject: '[SOC] phishing wave', teamid: teamidOf('Service Desk').toUpperCase(), tags: ['phishing'] });
    expect(routed.status).toBe(201);
    const detail = (await admin.get(`/api/v1/tickets/${routed.body.id}`)).body;
    expect(detail.team).toEqual({ id: ids.team, name: 'Service Desk', teamid: teamidOf('Service Desk') });
    expect(detail.tags).toEqual(['phishing']);
    const mails = await ctx.db.select().from(notificationLogs).where(eq(notificationLogs.recipient, 'agent@example.com'));
    expect(mails.some((m) => m.eventId.startsWith(`team_assigned:${routed.body.id}:`))).toBe(true);

    // an explicit team wins over the help topic's default team
    const explicit = await soc.post('/api/v1/tickets', { subject: '[SOC] lateral movement', helpTopic: 'security-incident', teamid: teamidOf('Network') });
    expect((await admin.get(`/api/v1/tickets/${explicit.body.id}`)).body.team.id).toBe(ids.otherTeam);

    expect((await soc.post('/api/v1/tickets', { subject: 'x', teamid: '0'.repeat(32) })).status).toBe(400);
    expect((await soc.post('/api/v1/tickets', { subject: 'x', teamid: 'Network' })).status).toBe(400);
    // the keys teamid replaced are rejected rather than ignored, so an old integration notices
    const old = await soc.post('/api/v1/tickets', { subject: 'x', team: 'Network' });
    expect(old.status).toBe(400);
    expect(old.body.errors[0].path).toBe('team');
    expect((await soc.post('/api/v1/tickets', { subject: 'x', teamId: ids.otherTeam })).status).toBe(400);
    expect((await soc.post('/api/v1/tickets', { subject: 'x', teamid: teamidOf('Network'), assigneeId: ids.agent })).status).toBe(403);
  });

  it('keeps team routing and the team list from people without ticket:assign and from read-only tokens', async () => {
    const network = (await admin.get('/api/v1/teams')).body.find((t: { name: string }) => t.name === 'Network').teamid;
    const user = await ctx.login('user@example.com');
    expect((await user.post('/api/v1/tickets', { subject: 'my own team', teamid: network })).status).toBe(403);
    expect((await user.get('/api/v1/teams')).status).toBe(403);
    expect((await admin.get('/api/v1/teams')).status).toBe(200);
    const readOnly = (await admin.post('/api/v1/admin/api-tokens', { name: 'RO teams', scopes: ['tickets:read'] })).body.token;
    expect((await ctx.tokenClient(readOnly).get('/api/v1/teams')).status).toBe(403);
  });

  it('enforces token scopes and blocks non-ticket endpoints', async () => {
    const readOnly = (await admin.post('/api/v1/admin/api-tokens', { name: 'RO', scopes: ['tickets:read'] })).body.token;
    const ro = ctx.tokenClient(readOnly);
    expect((await ro.post('/api/v1/tickets', { subject: 'x' })).status).toBe(403);
    expect((await ctx.tokenClient(token).get('/api/v1/admin/users')).status).toBe(403);
    expect((await ctx.tokenClient(token).get('/api/v1/dashboard')).status).toBe(403);
    expect((await ctx.tokenClient('td_bogus_token').get('/api/v1/tickets')).status).toBe(401);
  });

  it('rate-limits each token at 60 requests per minute', async () => {
    const t = (await admin.post('/api/v1/admin/api-tokens', { name: 'RL', scopes: ['tickets:read'] })).body.token;
    const client = ctx.tokenClient(t);
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await client.get('/api/v1/tickets?perPage=1')).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    ctx.clock.advance(61_000);
    expect((await client.get('/api/v1/tickets?perPage=1')).status).toBe(200);
  });

  it('revoked tokens stop working', async () => {
    const created = (await admin.post('/api/v1/admin/api-tokens', { name: 'tmp', scopes: ['tickets:read'] })).body;
    await admin.del(`/api/v1/admin/api-tokens/${created.id}`);
    expect((await ctx.tokenClient(created.token).get('/api/v1/tickets')).status).toBe(401);
  });
});
