import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { teamMembers, tickets } from '../src/server/db/schema.js';
import { createTestContext, type TestContext } from './helpers.js';

/** Dashboard charts (PRD FR-3.5): trend30d, agingBuckets, workload, byTeam. The test clock starts at 2026-03-02T02:00Z. */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN = 'status=new,open,pending_user';

async function withContext(fn: (ctx: TestContext, admin: Awaited<ReturnType<TestContext['adminClient']>>) => Promise<void>, env: Record<string, string> = {}) {
  const ctx = await createTestContext(env);
  try {
    await fn(ctx, await ctx.adminClient());
  } finally {
    await ctx.close();
  }
}

async function mk(ctx: TestContext, admin: Awaited<ReturnType<TestContext['adminClient']>>, patch: Partial<typeof tickets.$inferInsert> = {}, body: Record<string, unknown> = {}) {
  const t = (await admin.post('/api/v1/tickets', { subject: 'dash', ...body })).body;
  if (Object.keys(patch).length) await ctx.db.update(tickets).set(patch).where(eq(tickets.id, t.id));
  return t.id as number;
}

const dashboard = async (client: { get: (p: string) => Promise<{ status: number; body: any }> }) => (await client.get('/api/v1/dashboard')).body;

describe('trend30d', () => {
  it('has 30 consecutive days, zero-filled, split at local midnight (Asia/Taipei, UTC+8)', () =>
    withContext(async (ctx, admin) => {
      const at = (iso: string) => new Date(iso);
      // local midnight of 2026-03-02 is 2026-03-01T16:00Z
      await mk(ctx, admin, { createdAt: at('2026-03-01T15:59:59Z') }); // Mar 1
      await mk(ctx, admin, { createdAt: at('2026-03-01T16:00:00Z'), status: 'resolved', resolvedAt: at('2026-03-02T01:00:00Z') }); // created and resolved on Mar 2
      await mk(ctx, admin, { createdAt: at('2026-01-31T16:00:00Z') }); // Feb 1: the first day of the window
      await mk(ctx, admin, { createdAt: at('2026-01-31T15:59:59Z') }); // Jan 31: outside the 30 days
      await mk(ctx, admin, { createdAt: at('2026-02-20T00:00:00Z'), status: 'closed', resolvedAt: at('2026-03-01T20:00:00Z') }); // resolved Mar 2 (04:00 local)

      const { trend30d } = await dashboard(admin);
      expect(trend30d).toHaveLength(30);
      expect(trend30d[0].date).toBe('2026-02-01');
      expect(trend30d[29].date).toBe('2026-03-02');
      const days = trend30d.map((d: { date: string }) => d.date);
      for (let i = 1; i < 30; i++) expect(Date.parse(days[i]) - Date.parse(days[i - 1])).toBe(DAY);
      const byDate = Object.fromEntries(trend30d.map((d: any) => [d.date, d]));
      expect(byDate['2026-02-01']).toEqual({ date: '2026-02-01', created: 1, resolved: 0 });
      expect(byDate['2026-02-20']).toEqual({ date: '2026-02-20', created: 1, resolved: 0 }); // 08:00 local
      expect(byDate['2026-03-01']).toEqual({ date: '2026-03-01', created: 1, resolved: 0 });
      expect(byDate['2026-03-02']).toEqual({ date: '2026-03-02', created: 1, resolved: 2 });
      expect(byDate['2026-02-10']).toEqual({ date: '2026-02-10', created: 0, resolved: 0 });
      expect(trend30d.reduce((s: number, d: any) => s + d.created, 0)).toBe(4);
    }));

  it('uses the configured timezone and the injected clock (America/Los_Angeles, UTC-8)', () =>
    withContext(
      async (ctx, admin) => {
        // 02:00Z on Mar 2 is 18:00 on Mar 1 in Los Angeles
        await mk(ctx, admin, { createdAt: new Date('2026-03-02T01:00:00Z') });
        let { trend30d } = await dashboard(admin);
        expect(trend30d[29]).toEqual({ date: '2026-03-01', created: 1, resolved: 0 });
        expect(trend30d[0].date).toBe('2026-01-31');

        ctx.clock.advance(7 * HOUR); // 09:00Z = 01:00 on Mar 2 in Los Angeles: a new day starts
        ({ trend30d } = await dashboard(admin));
        expect(trend30d[29]).toEqual({ date: '2026-03-02', created: 0, resolved: 0 });
        expect(trend30d[28]).toEqual({ date: '2026-03-01', created: 1, resolved: 0 });
      },
      { TZ: 'America/Los_Angeles' },
    ));
});

describe('agingBuckets', () => {
  it('uses agingCondition() for "over 3 days": exactly 72h is 1-3, and 3-7 + 7-14 + 14+ equals olderThan3Days', () =>
    withContext(async (ctx, admin) => {
      const now = ctx.clock.now.getTime();
      const ageOf = (ms: number, extra: Partial<typeof tickets.$inferInsert> = {}) => mk(ctx, admin, { createdAt: new Date(now - ms), ...extra });
      await ageOf(12 * HOUR); // 0-1
      await ageOf(DAY); // exactly 24h: (0,1]
      await ageOf(DAY + 1000); // 1-3
      await ageOf(3 * DAY); // exactly 72h: not over 3 days
      await ageOf(3 * DAY + 1000); // 3-7
      await ageOf(7 * DAY); // exactly 7d: still 3-7
      await ageOf(7 * DAY + 1000); // 7-14
      await ageOf(14 * DAY); // exactly 14d: 7-14
      await ageOf(14 * DAY + 1000); // 14+
      await ageOf(30 * DAY, { status: 'resolved' }); // not open: no bucket
      await ageOf(30 * DAY, { status: 'closed' });

      const d = await dashboard(admin);
      expect(d.agingBuckets.map((b: any) => b.key)).toEqual(['0-1', '1-3', '3-7', '7-14', '14+']);
      expect(Object.fromEntries(d.agingBuckets.map((b: any) => [b.key, b.n]))).toEqual({ '0-1': 2, '1-3': 2, '3-7': 2, '7-14': 2, '14+': 1 });
      const over3 = d.agingBuckets.filter((b: any) => ['3-7', '7-14', '14+'].includes(b.key)).reduce((s: number, b: any) => s + b.n, 0);
      expect(over3).toBe(d.olderThan3Days);
      expect(over3).toBe((await admin.get('/api/v1/tickets?olderThanDays=3&perPage=1')).body.total);
    }));
});

describe('workload and byTeam', () => {
  it('ranks open tickets per assignee (top 10 + unassigned) and per team (+ no team), matching the list filters', () =>
    withContext(async (ctx, admin) => {
      const deskTeam = (await admin.post('/api/v1/admin/teams', { name: 'Desk' })).body.id;
      const netTeam = (await admin.post('/api/v1/admin/teams', { name: 'Network' })).body.id;
      const agents = [];
      for (let i = 0; i < 12; i++) agents.push(await ctx.createUser(`agent${String(i).padStart(2, '0')}@example.com`, 'agent'));
      // agent00: 3 open, agent01: 2, the other ten: 1 each; plus 2 unassigned; closed tickets never count
      const plan = [0, 0, 0, 1, 1, ...agents.slice(2).map((_, i) => i + 2)];
      for (const [i, who] of plan.entries()) await mk(ctx, admin, { assigneeId: agents[who].id, teamId: i % 3 === 0 ? deskTeam : i % 3 === 1 ? netTeam : null });
      await mk(ctx, admin, {}, { teamId: deskTeam });
      await mk(ctx, admin);
      await mk(ctx, admin, { assigneeId: agents[11].id, status: 'closed', resolvedAt: ctx.clock.now });

      const d = await dashboard(admin);
      const open = (await admin.get(`/api/v1/tickets?${OPEN}&perPage=1`)).body.total;
      expect(open).toBe(plan.length + 2);

      expect(d.workload).toHaveLength(11); // top 10 + unassigned
      expect(d.workload.slice(0, 2).map((r: any) => [r.name, r.n])).toEqual([['agent00', 3], ['agent01', 2]]);
      expect(d.workload.slice(0, 10).every((r: any, i: number, all: any[]) => i === 0 || all[i - 1].n >= r.n)).toBe(true);
      expect(d.workload[10]).toEqual({ assigneeId: null, name: null, n: 2 });
      for (const r of d.workload.slice(0, 10)) {
        expect((await admin.get(`/api/v1/tickets?assignee=${r.assigneeId}&${OPEN}&perPage=1`)).body.total).toBe(r.n);
      }
      expect((await admin.get(`/api/v1/tickets?assignee=none&${OPEN}&perPage=1`)).body.total).toBe(2);

      const team = Object.fromEntries(d.byTeam.map((r: any) => [r.name, r]));
      expect(d.byTeam.some((r: any) => r.teamId === null && r.name === null)).toBe(true);
      expect(d.byTeam.reduce((s: number, r: any) => s + r.n, 0)).toBe(open);
      for (const r of d.byTeam.filter((x: any) => x.teamId !== null)) {
        expect((await admin.get(`/api/v1/tickets?teamId=${r.teamId}&${OPEN}&perPage=1`)).body.total).toBe(r.n);
      }
      expect(team.Desk.n).toBeGreaterThan(0);
      expect(team.Network.n).toBeGreaterThan(0);
      expect(d.byTeam.find((r: any) => r.teamId === null).n).toBe(open - team.Desk.n - team.Network.n);
    }));
});

describe('dashboard visibility', () => {
  it('counts only visible tickets and gives workload/byTeam to staff only', () =>
    withContext(async (ctx, admin) => {
      const mine = (await admin.post('/api/v1/admin/teams', { name: 'Mine' })).body.id;
      const other = (await admin.post('/api/v1/admin/teams', { name: 'Other' })).body.id;
      const agent = await ctx.createUser('agent@example.com', 'agent');
      await ctx.db.insert(teamMembers).values({ teamId: mine, userId: agent.id });
      const vendor = await ctx.createUser('vendor@example.com', 'vendor');
      const user = await ctx.createUser('user@example.com', 'end_user');

      await mk(ctx, admin, {}, { teamId: mine });
      await mk(ctx, admin, {}, { teamId: mine });
      await mk(ctx, admin, {}, { teamId: other });
      await mk(ctx, admin, { assigneeId: vendor.id });
      await mk(ctx, admin, { requesterId: user.id });
      await mk(ctx, admin);

      const all = await dashboard(admin);
      expect(all.openCount).toBe(6);
      expect(all.workload).not.toBeNull();
      expect(all.byTeam).not.toBeNull();

      const a = await dashboard(await ctx.login('agent@example.com'));
      expect(a.openCount).toBe(2);
      expect(a.trend30d.reduce((s: number, d: any) => s + d.created, 0)).toBe(2);
      expect(a.agingBuckets.reduce((s: number, b: any) => s + b.n, 0)).toBe(2);
      expect(a.byTeam.reduce((s: number, r: any) => s + r.n, 0)).toBe(2);
      expect(a.workload.reduce((s: number, r: any) => s + r.n, 0)).toBe(2);
      expect(a.byTeam.map((r: any) => r.name)).not.toContain('Other');

      for (const [email, n] of [['vendor@example.com', 1], ['user@example.com', 1]] as const) {
        const d = await dashboard(await ctx.login(email));
        expect(d.openCount, email).toBe(n);
        expect(d.workload, email).toBeNull();
        expect(d.byTeam, email).toBeNull();
        expect(d.trend30d, email).toHaveLength(30);
        expect(d.trend30d.reduce((s: number, x: any) => s + x.created, 0), email).toBe(n);
        expect(d.agingBuckets.reduce((s: number, b: any) => s + b.n, 0), email).toBe(n);
      }
    }));
});
