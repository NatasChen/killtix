export interface Config {
  port: number;
  appUrl: string;
  databaseUrl: string;
  appSecret: string;
  redisUrl: string | undefined;
  cookieSecure: boolean;
  trustProxy: boolean;
  sessionTtlHours: number;
  restrictedSessionTtlMinutes: number;
  bcryptCost: number;
  loginMaxFailedAttempts: number;
  lockoutMinutes: number;
  rateLimitPerMin: number;
  loginRateLimitPerMin: number;
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string | undefined;
  defaultLocale: string;
  timezone: string;
  agingDigestHour: number;
  notifyMaxAttempts: number;
  smtp: { host?: string; port: number; secure: boolean; user?: string; password?: string; from: string };
  telegramBotToken: string | undefined;
  teamsWebhookUrl: string | undefined;
  staticDir: string | undefined;
  migrationsDir: string;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer env value: ${value}`);
  return n;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const empty = (v: string | undefined) => (v === undefined || v === '' ? undefined : v);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const appSecret = env.APP_SECRET ?? '';
  if (appSecret.length < 32) throw new Error('APP_SECRET is required (at least 32 characters)');
  const appUrl = env.APP_URL ?? 'http://localhost:8080';
  return {
    port: int(env.PORT, 8080),
    appUrl,
    databaseUrl,
    appSecret,
    redisUrl: empty(env.REDIS_URL),
    cookieSecure: bool(env.COOKIE_SECURE, appUrl.startsWith('https://')),
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionTtlHours: int(env.SESSION_TTL_HOURS, 12),
    restrictedSessionTtlMinutes: int(env.RESTRICTED_SESSION_TTL_MINUTES, 15),
    bcryptCost: int(env.BCRYPT_COST, 12),
    loginMaxFailedAttempts: int(env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
    lockoutMinutes: int(env.LOCKOUT_MINUTES, 15),
    rateLimitPerMin: int(env.RATE_LIMIT_PER_MIN, 60),
    loginRateLimitPerMin: int(env.LOGIN_RATE_LIMIT_PER_MIN, 10),
    bootstrapAdminEmail: (env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@ticket.local').toLowerCase(),
    bootstrapAdminPassword: empty(env.BOOTSTRAP_ADMIN_PASSWORD),
    defaultLocale: env.DEFAULT_LOCALE ?? 'zh-TW',
    timezone: env.TZ ?? 'Asia/Taipei',
    agingDigestHour: int(env.AGING_DIGEST_HOUR, 9),
    notifyMaxAttempts: int(env.NOTIFY_MAX_ATTEMPTS, 5),
    smtp: {
      host: empty(env.SMTP_HOST),
      port: int(env.SMTP_PORT, 587),
      secure: bool(env.SMTP_SECURE, false),
      user: empty(env.SMTP_USER),
      password: empty(env.SMTP_PASSWORD),
      from: env.SMTP_FROM ?? 'TicketDesk <no-reply@ticket.local>',
    },
    telegramBotToken: empty(env.TELEGRAM_BOT_TOKEN),
    teamsWebhookUrl: empty(env.TEAMS_WEBHOOK_URL),
    staticDir: empty(env.STATIC_DIR),
    migrationsDir: env.MIGRATIONS_DIR ?? new URL('../../../drizzle', import.meta.url).pathname,
  };
}
