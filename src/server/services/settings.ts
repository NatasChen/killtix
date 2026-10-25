import { eq, sql } from 'drizzle-orm';
import type { SecretBox } from '../auth/crypto.js';
import type { Config } from '../config.js';
import type { DB } from '../db/client.js';
import { systemSettings } from '../db/schema.js';

export const SETTING_DEFAULTS = {
  // Global 2FA switch: when on, every local user must enrol TOTP before using the app.
  'security.2fa_enforced': false as boolean,
  // Date (YYYY-MM-DD, app timezone) the "older than 3 days" digest was last sent.
  'jobs.aging_digest_last_run': '' as string,
};
export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const MAIL_PROVIDERS = ['env', 'smtp', 'resend'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export interface MailSettings {
  provider: MailProvider;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password?: string;
    from: string;
  };
  resend: {
    apiKey?: string;
    from: string;
  };
}

export interface MailSettingsView {
  provider: MailProvider;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    from: string;
    hasPassword: boolean;
    passwordInvalid: boolean;
  };
  resend: {
    from: string;
    hasApiKey: boolean;
    apiKeyInvalid: boolean;
  };
  /** Where the currently effective e-mail settings come from. */
  effectiveProvider: MailProvider;
  env: { host: string; from: string };
}

const MAIL_SETTING_KEY = 'mail.settings';

function decryptSecret(secretBox: SecretBox, boxed: string | undefined): { value: string | undefined; invalid: boolean } {
  if (!boxed) return { value: undefined, invalid: false };
  try {
    return { value: secretBox.decrypt(boxed), invalid: false };
  } catch {
    return { value: undefined, invalid: true };
  }
}

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

async function readMailSettings(db: DB): Promise<MailSettings | null> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, MAIL_SETTING_KEY));
  return (row?.value as MailSettings | undefined) ?? null;
}

export async function getMailSettings(db: DB, secretBox: SecretBox, config: Config): Promise<MailSettingsView> {
  const stored = await readMailSettings(db);
  const provider = stored?.provider ?? 'env';
  const smtpSecret = decryptSecret(secretBox, stored?.smtp?.password as string | undefined);
  const resendSecret = decryptSecret(secretBox, stored?.resend?.apiKey as string | undefined);
  return {
    provider,
    smtp: {
      host: stored?.smtp?.host ?? '',
      port: stored?.smtp?.port ?? 587,
      secure: stored?.smtp?.secure ?? false,
      user: stored?.smtp?.user ?? '',
      from: stored?.smtp?.from ?? '',
      hasPassword: Boolean(smtpSecret.value),
      passwordInvalid: smtpSecret.invalid,
    },
    resend: {
      from: stored?.resend?.from ?? '',
      hasApiKey: Boolean(resendSecret.value),
      apiKeyInvalid: resendSecret.invalid,
    },
    effectiveProvider: provider,
    env: { host: config.smtp.host ?? '', from: config.smtp.from },
  };
}

export interface MailSettingsInput {
  provider: MailProvider;
  smtp?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    from?: string;
  };
  resend?: {
    apiKey?: string;
    from?: string;
  };
}

export async function saveMailSettings(
  db: DB,
  secretBox: SecretBox,
  config: Config,
  input: MailSettingsInput,
  userId: number | null = null,
): Promise<MailSettingsView> {
  const current = await readMailSettings(db);
  const smtpPassword =
    input.smtp?.password !== undefined && input.smtp.password !== ''
      ? secretBox.encrypt(input.smtp.password)
      : (current?.smtp?.password ?? undefined);
  const resendApiKey =
    input.resend?.apiKey !== undefined && input.resend.apiKey !== ''
      ? secretBox.encrypt(input.resend.apiKey)
      : (current?.resend?.apiKey ?? undefined);

  const next: MailSettings = {
    provider: input.provider,
    smtp: {
      host: input.smtp?.host ?? current?.smtp?.host ?? '',
      port: input.smtp?.port ?? current?.smtp?.port ?? 587,
      secure: input.smtp?.secure ?? current?.smtp?.secure ?? false,
      user: input.smtp?.user ?? current?.smtp?.user ?? '',
      from: input.smtp?.from ?? current?.smtp?.from ?? '',
      password: smtpPassword,
    },
    resend: {
      apiKey: resendApiKey,
      from: input.resend?.from ?? current?.resend?.from ?? '',
    },
  };

  await db
    .insert(systemSettings)
    .values({ key: MAIL_SETTING_KEY, value: next, updatedBy: userId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: sql`excluded.value`, updatedBy: userId, updatedAt: new Date() },
    });
  return getMailSettings(db, secretBox, config);
}

/** The decrypted secrets for the currently stored mail settings (never returned to clients). */
export async function resolveMailSecrets(db: DB, secretBox: SecretBox): Promise<{
  provider: MailProvider;
  smtp: { host: string; port: number; secure: boolean; user: string; password: string | undefined; from: string; passwordInvalid: boolean };
  resend: { apiKey: string | undefined; from: string; apiKeyInvalid: boolean };
}> {
  const stored = await readMailSettings(db);
  const provider = stored?.provider ?? 'env';
  const smtpSecret = decryptSecret(secretBox, stored?.smtp?.password as string | undefined);
  const resendSecret = decryptSecret(secretBox, stored?.resend?.apiKey as string | undefined);
  return {
    provider,
    smtp: {
      host: stored?.smtp?.host ?? '',
      port: stored?.smtp?.port ?? 587,
      secure: stored?.smtp?.secure ?? false,
      user: stored?.smtp?.user ?? '',
      password: smtpSecret.value,
      from: stored?.smtp?.from ?? '',
      passwordInvalid: smtpSecret.invalid,
    },
    resend: { apiKey: resendSecret.value, from: stored?.resend?.from ?? '', apiKeyInvalid: resendSecret.invalid },
  };
}
