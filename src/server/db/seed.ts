import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { hashPassword, randomPassword } from '../auth/crypto.js';
import type { Config } from '../config.js';
import { ROLE_DEFINITIONS } from '../rbac.js';
import type { DB } from './client.js';
import { helpTopics, roles, slaPlans, systemSettings, teamMembers, users } from './schema.js';

export interface SeedResult {
  /** Set only when the bootstrap admin was created in this run with a generated password. */
  generatedAdminPassword?: string;
  adminCreated: boolean;
}

/**
 * Idempotent reference data. Safe to run on every start: existing rows (including a
 * changed admin password) are never overwritten, except role permissions, which are
 * code-defined and kept in sync.
 */
const TEAM_MEMBERS_BACKFILL_KEY = 'migrations.team_members_backfilled';

/** One-time data migration: copy the deprecated `users.team_id` into `team_members`. */
async function backfillTeamMembers(db: DB) {
  const [flag] = await db.select().from(systemSettings).where(eq(systemSettings.key, TEAM_MEMBERS_BACKFILL_KEY));
  if (flag) return;
  const rows = await db
    .select({ userId: users.id, teamId: users.teamId })
    .from(users)
    .where(isNotNull(users.teamId));
  if (rows.length) {
    await db
      .insert(teamMembers)
      .values(rows.map((r) => ({ userId: r.userId, teamId: r.teamId! })))
      .onConflictDoNothing();
  }
  await db
    .insert(systemSettings)
    .values({ key: TEAM_MEMBERS_BACKFILL_KEY, value: true })
    .onConflictDoNothing();
}

export async function seed(db: DB, config: Pick<Config, 'bootstrapAdminEmail' | 'bootstrapAdminPassword' | 'bcryptCost' | 'defaultLocale'>): Promise<SeedResult> {
  await backfillTeamMembers(db);
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    await db
      .insert(roles)
      .values({ key, name: def.name, description: def.description, permissions: def.permissions, isSystem: true })
      .onConflictDoUpdate({ target: roles.key, set: { permissions: def.permissions } });
  }

  await db
    .insert(slaPlans)
    .values([
      { name: '標準 SLA', firstResponseMinutes: 240, resolutionMinutes: 3 * 1440 },
      { name: '資安事件 SLA', firstResponseMinutes: 30, resolutionMinutes: 480 },
    ])
    .onConflictDoNothing();
  const [securityPlan] = await db.select().from(slaPlans).where(eq(slaPlans.name, '資安事件 SLA'));
  const [standardPlan] = await db.select().from(slaPlans).where(eq(slaPlans.name, '標準 SLA'));

  await db
    .insert(helpTopics)
    .values([
      { slug: 'security-incident', name: '資安事件通報', description: 'SOC / 資安事件開單入口', slaPlanId: securityPlan.id, autoTags: ['security'], isPublic: false },
      { slug: 'account-access', name: '帳號權限申請', description: '帳號、權限、存取申請', slaPlanId: standardPlan.id },
      { slug: 'general', name: '一般問題', description: '其他 IT 支援需求', slaPlanId: standardPlan.id },
    ])
    .onConflictDoNothing();

  // Bootstrap admin: only when the account does not exist and there is no other super admin.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.email} = ${config.bootstrapAdminEmail} or (${and(eq(users.roleKey, 'super_admin'), eq(users.isActive, true))})`)
    .limit(1);
  if (existing) return { adminCreated: false };

  const generated = config.bootstrapAdminPassword ? undefined : randomPassword();
  const password = config.bootstrapAdminPassword ?? generated!;
  const inserted = await db
    .insert(users)
    .values({
      email: config.bootstrapAdminEmail,
      displayName: 'Bootstrap Administrator',
      passwordHash: await hashPassword(password, config.bcryptCost),
      roleKey: 'super_admin',
      mustChangePassword: true,
      isBootstrapAdmin: true,
      locale: config.defaultLocale,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!inserted.length) return { adminCreated: false }; // another instance won the race
  return { adminCreated: true, generatedAdminPassword: generated };
}
