import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advisoryUpdates, auditLogs, notificationLogs, teamMembers } from '../src/server/db/schema.js';
import { scanAdvisories } from '../src/server/services/advisories.js';
import { saveChannelSettings, saveMailSettings, setSetting } from '../src/server/services/settings.js';
import { createTestContext, type TestContext } from './helpers.js';

/** Threat-intel advisories (DECISIONS D24). The test clock starts at 2026-03-02T02:00Z (10:00 Asia/Taipei). */
let ctx: TestContext;
type Client = Awaited<ReturnType<TestContext['adminClient']>>;
let hq: Client;
let alpha: Client; // member of team Alpha
let bravo: Client; // member of team Bravo
let charlie: Client; // member of team Charlie, which never receives the advisory
const team: Record<string, number> = {};

const HOUR = 3_600_000;
const inDays = (d: number) => new Date(ctx.clock.now.getTime() + d * 24 * HOUR).toISOString();

beforeAll(async () => {
  ctx = await createTestContext();
  await saveMailSettings(ctx.db, ctx.deps.secretBox, { provider: 'smtp', smtp: { host: 'smtp.test', from: 'td@example.com' } }, null);
  await saveChannelSettings(ctx.db, ctx.deps.secretBox, { teams: { webhookUrl: 'https://teams.test/hook' } }, null);
  await setSetting(ctx.db, 'notify.enabled', true);
  const admin = await ctx.adminClient();
  for (const name of ['Alpha', 'Bravo', 'Charlie']) team[name] = (await admin.post('/api/v1/admin/teams', { name })).body.id;
  await ctx.createUser('hq@example.com', 'it_manager');
  for (const [email, role, teamName] of [
    ['alpha@example.com', 'agent', 'Alpha'],
    ['alpha2@example.com', 'agent', 'Alpha'],
    ['alpha-vendor@example.com', 'vendor', 'Alpha'],
    ['bravo@example.com', 'agent', 'Bravo'],
    ['charlie@example.com', 'agent', 'Charlie'],
  ] as const) {
    const u = await ctx.createUser(email, role);
    await ctx.db.insert(teamMembers).values({ teamId: team[teamName], userId: u.id });
  }
  await ctx.createUser('user@example.com', 'end_user');
  hq = await ctx.login('hq@example.com');
  alpha = await ctx.login('alpha@example.com');
  bravo = await ctx.login('bravo@example.com');
  charlie = await ctx.login('charlie@example.com');
});
afterAll(async () => {
  await ctx.close();
});

const mails = async (prefix: string) =>
  (await ctx.db.select().from(notificationLogs).where(like(notificationLogs.eventId, `${prefix}%`))).filter((m) => m.channel === 'email');

const create = async (body: Record<string, unknown> = {}) =>
  (
    await hq.post('/api/v1/advisories', {
      title: 'Critical RCE in edge VPN appliance',
      severity: 'critical',
      summary: 'Unauthenticated remote code execution.',
      cves: ['cve-2026-10001', 'CVE-2026-10002'],
      responseDueAt: inDays(1),
      teamIds: [team.Alpha, team.Bravo],
      ...body,
    })
  ).body;

describe('writing and publishing (HQ)', () => {
  it('numbers drafts, normalises CVEs and keeps drafts away from teams', async () => {
    const draft = await create();
    expect(draft.number).toMatch(/^ADV-2026-\d{4}$/);
    expect(draft.status).toBe('draft');
    expect(draft.cves).toEqual(['CVE-2026-10001', 'CVE-2026-10002']);
    expect(draft.targets.map((t: any) => t.team)).toEqual(['Alpha', 'Bravo']);
    expect((await alpha.get(`/api/v1/advisories/${draft.number}`)).status).toBe(404);
    expect((await alpha.get('/api/v1/advisories')).body.items).toHaveLength(0);
    expect(await mails(`advisory_published:`)).toHaveLength(0);
  });

  it('needs teams and a deadline to publish, then tells the responders of each team (never vendors)', async () => {
    const bare = await create({ teamIds: [], responseDueAt: null });
    const res = await hq.post(`/api/v1/advisories/${bare.id}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: any) => e.path).sort()).toEqual(['responseDueAt', 'teamIds']);

    const adv = await create();
    const published = (await hq.post(`/api/v1/advisories/${adv.id}/publish`)).body;
    expect(published.status).toBe('published');
    const sent = (await mails('advisory_published:')).map((m) => m.recipient).sort();
    expect(sent).toEqual(['alpha2@example.com', 'alpha@example.com', 'bravo@example.com']);
    const [mail] = await mails('advisory_published:');
    expect(mail.body).toContain('CVE-2026-10001');
    expect(mail.body).toContain(`/advisories/${adv.number}`);
    expect((await hq.post(`/api/v1/advisories/${adv.id}/publish`)).body.code).toBe('advisory_not_draft');
  });

  it('rejects malformed CVEs and unknown teams', async () => {
    expect((await hq.post('/api/v1/advisories', { title: 'x', cves: ['not-a-cve'] })).status).toBe(400);
    expect((await hq.post('/api/v1/advisories', { title: 'x', teamIds: [99999] })).status).toBe(400);
  });

  it('is for HQ only: engineers, vendors, end users and API tokens cannot create or list everything', async () => {
    expect((await alpha.post('/api/v1/advisories', { title: 'x' })).status).toBe(403);
    expect((await (await ctx.login('alpha-vendor@example.com')).get('/api/v1/advisories')).status).toBe(403);
    expect((await (await ctx.login('user@example.com')).get('/api/v1/advisories')).status).toBe(403);
    const admin = await ctx.adminClient();
    const token = (await admin.post('/api/v1/admin/api-tokens', { name: 'soc', scopes: ['tickets:write', 'tickets:read'] })).body.token;
    expect((await ctx.tokenClient(token).get('/api/v1/advisories')).status).toBe(403);
  });
});

describe('team responses', () => {
  let adv: any;
  beforeAll(async () => {
    adv = await create({ title: 'Exchange zero-day' });
    await hq.post(`/api/v1/advisories/${adv.id}/publish`);
  });

  it("shows a team its own answer only; other teams' answers and untargeted teams stay hidden", async () => {
    const mine = (await alpha.get(`/api/v1/advisories/${adv.number}`)).body;
    expect(mine.targets.map((t: any) => t.team)).toEqual(['Alpha']);
    expect(mine.targets[0]).toMatchObject({ exposure: 'pending', canRespond: true });
    expect(mine.canManage).toBe(false);
    expect((await charlie.get(`/api/v1/advisories/${adv.number}`)).status).toBe(404);
    expect((await charlie.get('/api/v1/advisories')).body.items.map((i: any) => i.number)).not.toContain(adv.number);
    // answering for another team is a 404, as if it did not exist
    expect((await alpha.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.Bravo}`, { exposure: 'not_affected' })).status).toBe(404);
  });

  it('requires approach, status and planned date when affected, and keeps every answer in the history', async () => {
    const put = (c: Client, body: unknown) => c.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.Alpha}`, body);
    const bad = await put(alpha, { exposure: 'affected' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: any) => e.path).sort()).toEqual(['actionPlan', 'actionStatus', 'targetDate']);

    const ok = await put(alpha, {
      exposure: 'affected',
      affectedScope: 'mail01, mail02',
      actionPlan: 'patch',
      actionStatus: 'in_progress',
      targetDate: '2026-03-05',
      note: 'patch window Thursday',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.targets[0]).toMatchObject({ exposure: 'affected', actionPlan: 'patch', targetDate: '2026-03-05', complete: false });
    // HQ's channel hears that a team is exposed
    expect((await ctx.db.select().from(notificationLogs).where(like(notificationLogs.eventId, 'advisory_affected:%'))).map((m) => m.channel)).toEqual(['teams']);

    await put(alpha, { exposure: 'affected', affectedScope: 'mail01, mail02', actionPlan: 'patch', actionStatus: 'done' }); // done: no date needed
    const after = (await alpha.get(`/api/v1/advisories/${adv.id}`)).body.targets[0];
    expect(after.complete).toBe(true);
    expect(after.history.map((h: any) => h.actionStatus)).toEqual(['done', 'in_progress']);
    expect(after.history[1].note).toBe('patch window Thursday');

    // not affected clears the remediation fields
    const clean = (await bravo.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.Bravo}`, { exposure: 'not_affected', actionPlan: 'patch' })).body;
    expect(clean.targets[0]).toMatchObject({ exposure: 'not_affected', actionPlan: null, complete: true });
    const [audit] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'advisory.responded'));
    expect(audit).toBeDefined();
  });

  it("gives HQ every team's answer with the advisory's progress, and lets HQ answer on a team's behalf", async () => {
    const other = await create({ title: 'OpenSSL advisory', teamIds: [team.Alpha, team.Bravo, team.Charlie] });
    await hq.post(`/api/v1/advisories/${other.id}/publish`);
    await hq.raw('PUT', `/api/v1/advisories/${other.id}/teams/${team.Charlie}`, { exposure: 'investigating', note: 'by phone' });
    await alpha.raw('PUT', `/api/v1/advisories/${other.id}/teams/${team.Alpha}`, {
      exposure: 'affected', actionPlan: 'mitigate', actionStatus: 'not_started', targetDate: '2026-03-10',
    });
    const d = (await hq.get(`/api/v1/advisories/${other.number}`)).body;
    expect(d.targets.map((t: any) => [t.team, t.exposure])).toEqual([['Alpha', 'affected'], ['Bravo', 'pending'], ['Charlie', 'investigating']]);
    expect(d.targets[2].history[0].author.displayName).toBe('hq');
    expect(d.progress).toMatchObject({ total: 3, responded: 2, affected: 1, complete: 0, overdueResponse: 0 });
    const row = (await hq.get('/api/v1/advisories?q=OpenSSL')).body.items[0];
    expect(row.progress).toMatchObject({ total: 3, responded: 2, affected: 1 });

    // the "to do" list of a team member
    const todo = (await alpha.get('/api/v1/advisories?todo=1')).body.items.map((i: any) => i.number);
    expect(todo).toContain(other.number);
    expect(todo).not.toContain(adv.number); // Alpha finished that one
    const listed = (await alpha.get('/api/v1/advisories')).body.items.find((i: any) => i.number === other.number);
    expect(listed.myTeams).toEqual([{ teamId: team.Alpha, team: 'Alpha', exposure: 'affected', actionStatus: 'not_started' }]);
  });

  it('adds teams to a published advisory (they are told), keeps answered teams, and freezes answers once closed', async () => {
    const before = (await mails('advisory_published:')).filter((m) => m.recipient === 'charlie@example.com').length;
    const added = await hq.patch(`/api/v1/advisories/${adv.id}`, { teamIds: [team.Alpha, team.Bravo, team.Charlie] });
    expect(added.status).toBe(200);
    expect((await mails('advisory_published:')).filter((m) => m.recipient === 'charlie@example.com').length).toBe(before + 1);
    expect((await hq.patch(`/api/v1/advisories/${adv.id}`, { teamIds: [team.Charlie] })).body.code).toBe('advisory_target_answered');

    expect((await hq.post(`/api/v1/advisories/${adv.id}/close`)).body.status).toBe('closed');
    const late = await charlie.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.Charlie}`, { exposure: 'not_affected' });
    expect(late.body.code).toBe('advisory_closed');
    expect((await charlie.get(`/api/v1/advisories/${adv.id}`)).body.targets[0].canRespond).toBe(false);
    expect((await hq.post(`/api/v1/advisories/${adv.id}/reopen`)).body.status).toBe('published');
  });

  it('exports the team table as CSV for HQ', async () => {
    const res = await hq.raw('GET', `/api/v1/advisories/${adv.id}/responses.csv`);
    expect(res.status).toBe(200);
    const raw = new Uint8Array(await (await ctx.app.request(`/api/v1/advisories/${adv.id}/responses.csv`, { headers: { cookie: hq.cookie! } })).arrayBuffer());
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('team,exposure');
    expect(lines.slice(1).map((l) => l.split(',')[3])).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect((await alpha.raw('GET', `/api/v1/advisories/${adv.id}/responses.csv`)).status).toBe(403);
  });
});

describe('reminders and deadlines', () => {
  it('reminds unfinished teams on request, warns a day before, and reports overdue answers and remediations once', async () => {
    const adv = await create({ title: 'Deadline test', responseDueAt: inDays(2) });
    await hq.post(`/api/v1/advisories/${adv.id}/publish`);
    await bravo.raw('PUT', `/api/v1/advisories/${adv.id}/teams/${team.Bravo}`, {
      exposure: 'affected', actionPlan: 'patch', actionStatus: 'in_progress', targetDate: '2026-03-03',
    });
    const ids = (await hq.get(`/api/v1/advisories/${adv.id}`)).body.targets.map((t: any) => t.id);
    const of = (key: string, i: number) => mails(`${key}:${ids[i]}`);

    expect((await hq.post(`/api/v1/advisories/${adv.id}/remind`)).body.reminded).toBe(2); // Alpha (no answer) and Bravo (not done)
    expect((await of('advisory_reminder', 0)).map((m) => m.recipient).sort()).toEqual(['alpha2@example.com', 'alpha@example.com']);

    await scanAdvisories(ctx.deps);
    expect(await of('advisory_due_soon', 0)).toHaveLength(0); // two days left

    ctx.clock.advance(30 * HOUR); // 18h left
    await scanAdvisories(ctx.deps);
    await scanAdvisories(ctx.deps);
    expect(await of('advisory_due_soon', 0)).toHaveLength(2);

    ctx.clock.advance(24 * HOUR); // deadline passed; Bravo's planned 2026-03-03 has passed too
    await scanAdvisories(ctx.deps);
    await scanAdvisories(ctx.deps);
    expect(await of('advisory_overdue', 0)).toHaveLength(2);
    const channel = await ctx.db.select().from(notificationLogs).where(and(like(notificationLogs.eventId, `advisory_overdue:${ids[0]}%`), eq(notificationLogs.channel, 'teams'))!);
    expect(channel).toHaveLength(1);
    expect((await of('advisory_action_overdue', 1)).map((m) => m.recipient)).toEqual(['bravo@example.com']);

    hq = await ctx.login('hq@example.com'); // the clock moved past the session's lifetime
    const d = (await hq.get(`/api/v1/advisories/${adv.id}`)).body;
    expect(d.targets.map((t: any) => t.overdue)).toEqual([true, true]);
    expect(d.progress).toMatchObject({ overdueResponse: 1, overdueAction: 1 });
  });

  it('summarises open work on the dashboard: every team for HQ, own teams for members, nothing for vendors', async () => {
    const all = (await hq.get('/api/v1/dashboard')).body.advisories;
    expect(all.scope).toBe('all');
    expect(all.openAdvisories).toBeGreaterThan(0);
    expect(all.overdue).toBeGreaterThan(0);
    const mine = (await (await ctx.login('charlie@example.com')).get('/api/v1/dashboard')).body.advisories;
    expect(mine.scope).toBe('mine');
    expect(mine.awaitingResponse).toBeLessThan(all.awaitingResponse);
    expect((await (await ctx.login('alpha-vendor@example.com')).get('/api/v1/dashboard')).body.advisories).toBeNull();
  });

  it('deletes drafts only', async () => {
    const draft = await create({ title: 'to delete' });
    expect((await hq.del(`/api/v1/advisories/${draft.id}`)).status).toBe(204);
    const live = await create({ title: 'live' });
    await hq.post(`/api/v1/advisories/${live.id}/publish`);
    expect((await hq.del(`/api/v1/advisories/${live.id}`)).body.code).toBe('advisory_not_draft');
    expect(await ctx.db.select().from(advisoryUpdates)).not.toHaveLength(0);
  });
});
