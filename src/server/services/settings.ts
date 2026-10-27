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
  // Product name next to the logo on the sign-in page, the sidebar and the browser tab (DECISIONS D11).
  'branding.name': 'TicketDesk' as string,
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
  await writeSetting(db, key, value, userId);
}

async function writeSetting(db: DB, key: string, value: unknown, userId: number | null) {
  await db
    .insert(systemSettings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: sql`excluded.value`, updatedBy: userId, updatedAt: new Date() },
    });
}

// ------------------------------------------------------------------ mail settings (DECISIONS D13)

export const MAIL_PROVIDERS = ['env', 'smtp', 'resend'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

const MAIL_KEY = 'mail.settings';

/** Stored row; `password` and `apiKey` are secretBox ciphertext. */
interface StoredMail {
  provider: MailProvider;
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; password?: string };
  resend: { from: string; apiKey?: string };
}

export interface MailSettingsInput {
  provider: MailProvider;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; password?: string; from?: string };
  resend?: { apiKey?: string; from?: string };
}

/** What the settings page sees: never the secrets, only whether they are set and readable. */
export interface MailSettingsView {
  provider: MailProvider;
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPassword: boolean; passwordInvalid: boolean };
  resend: { from: string; hasApiKey: boolean; apiKeyInvalid: boolean };
  /** Where e-mail actually goes right now (null = e-mail is not configured, notifications are skipped). */
  effective: MailProvider | null;
  env: { host: string; from: string };
}

/** The e-mail transport the senders use, with secrets decrypted; null when e-mail is not configured. */
export type MailTransport =
  | { kind: 'smtp'; host: string; port: number; secure: boolean; user: string; password: string | undefined; from: string }
  | { kind: 'resend'; apiKey: string; from: string };

const EMPTY: StoredMail = {
  provider: 'env',
  smtp: { host: '', port: 587, secure: false, user: '', from: '' },
  resend: { from: '' },
};

async function readMail(db: DB): Promise<StoredMail> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, MAIL_KEY));
  const stored = row?.value as Partial<StoredMail> | undefined;
  return { ...EMPTY, ...stored, smtp: { ...EMPTY.smtp, ...stored?.smtp }, resend: { ...EMPTY.resend, ...stored?.resend } };
}

/** Decrypts a stored secret; a value that no longer decrypts (APP_SECRET changed) counts as invalid, never as an error. */
function open(secretBox: SecretBox, boxed: string | undefined) {
  if (!boxed) return { value: undefined, invalid: false };
  try {
    return { value: secretBox.decrypt(boxed), invalid: false };
  } catch {
    return { value: undefined, invalid: true };
  }
}

function toTransport(mail: StoredMail, secretBox: SecretBox, config: Config): MailTransport | null {
  if (mail.provider === 'env') {
    const s = config.smtp;
    return s.host ? { kind: 'smtp', host: s.host, port: s.port, secure: s.secure, user: s.user ?? '', password: s.password, from: s.from } : null;
  }
  if (mail.provider === 'smtp') {
    const password = open(secretBox, mail.smtp.password);
    if (!mail.smtp.host || !mail.smtp.from || password.invalid) return null;
    return { kind: 'smtp', ...mail.smtp, password: password.value };
  }
  const apiKey = open(secretBox, mail.resend.apiKey).value;
  return apiKey && mail.resend.from ? { kind: 'resend', apiKey, from: mail.resend.from } : null;
}

/** The current e-mail transport; read on every send so a saved change applies without a restart. */
export async function mailTransport(db: DB, secretBox: SecretBox, config: Config): Promise<MailTransport | null> {
  return toTransport(await readMail(db), secretBox, config);
}

export async function getMailSettings(db: DB, secretBox: SecretBox, config: Config): Promise<MailSettingsView> {
  const mail = await readMail(db);
  const password = open(secretBox, mail.smtp.password);
  const apiKey = open(secretBox, mail.resend.apiKey);
  const { password: _p, ...smtp } = mail.smtp;
  return {
    provider: mail.provider,
    smtp: { ...smtp, hasPassword: Boolean(password.value), passwordInvalid: password.invalid },
    resend: { from: mail.resend.from, hasApiKey: Boolean(apiKey.value), apiKeyInvalid: apiKey.invalid },
    effective: toTransport(mail, secretBox, config) ? mail.provider : null,
    env: { host: config.smtp.host ?? '', from: config.smtp.from },
  };
}

/** Saves the mail settings; a blank or missing secret keeps the stored one. */
export async function saveMailSettings(db: DB, secretBox: SecretBox, config: Config, input: MailSettingsInput, userId: number | null) {
  const current = await readMail(db);
  const seal = (plain: string | undefined, stored: string | undefined) => (plain ? secretBox.encrypt(plain) : stored);
  const next: StoredMail = {
    provider: input.provider,
    smtp: {
      host: input.smtp?.host ?? current.smtp.host,
      port: input.smtp?.port ?? current.smtp.port,
      secure: input.smtp?.secure ?? current.smtp.secure,
      user: input.smtp?.user ?? current.smtp.user,
      from: input.smtp?.from ?? current.smtp.from,
      password: seal(input.smtp?.password, current.smtp.password),
    },
    resend: {
      from: input.resend?.from ?? current.resend.from,
      apiKey: seal(input.resend?.apiKey, current.resend.apiKey),
    },
  };
  await writeSetting(db, MAIL_KEY, next, userId);
  return getMailSettings(db, secretBox, config);
}

/** True when a Resend API key is stored and still decrypts (first-time Resend setup must supply one). */
export async function hasResendKey(db: DB, secretBox: SecretBox) {
  return Boolean(open(secretBox, (await readMail(db)).resend.apiKey).value);
}
