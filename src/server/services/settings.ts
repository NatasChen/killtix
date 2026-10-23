import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { systemSettings } from '../db/schema.js';

export const SETTING_DEFAULTS = {
  // Global 2FA switch: when on, every local user must enrol TOTP before using the app.
  'security.2fa_enforced': false as boolean,
  // Date (YYYY-MM-DD, app timezone) the "older than 3 days" digest was last sent.
  'jobs.aging_digest_last_run': '' as string,
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting<K extends SettingKey>(db: DB, key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return (row?.value ?? SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K];
}

export async function setSetting<K extends SettingKey>(
  db: DB,
  key: K,
  value: (typeof SETTING_DEFAULTS)[K],
  userId: number | null = null,
) {
  await db
    .insert(systemSettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: sql`excluded.value`, updatedBy: userId, updatedAt: new Date() },
    });
}
