import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { createSecretBox } from './auth/crypto.js';
import { loadConfig } from './config.js';
import type { Deps } from './context.js';
import { connectPostgres } from './db/client.js';
import { seed } from './db/seed.js';
import { Glossary } from './i18n/index.js';
import { agingDigest, scanSla } from './services/jobs.js';
import { defaultSenders, dispatchPending } from './services/notify.js';
import { memoryRateLimiter, redisRateLimiter } from './services/rateLimit.js';

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

async function main() {
  const config = loadConfig();
  const { db, close } = await connectPostgres(config.databaseUrl, config.migrationsDir);
  log('info', 'database migrated');

  const result = await seed(db, config);
  if (result.adminCreated) {
    if (result.generatedAdminPassword) {
      // Printed once, on the run that created the account. It must be changed at first login.
      console.log(
        [
          '',
          '================================================================',
          ' TicketDesk bootstrap administrator created',
          `   e-mail:   ${config.bootstrapAdminEmail}`,
          `   password: ${result.generatedAdminPassword}`,
          ' You must change this password at first login.',
          '================================================================',
          '',
        ].join('\n'),
      );
    } else {
      log('info', 'bootstrap administrator created from BOOTSTRAP_ADMIN_PASSWORD', { email: config.bootstrapAdminEmail });
    }
  }

  const glossary = new Glossary(config.defaultLocale);
  await glossary.load(db);
  const rateLimiter = config.redisUrl ? redisRateLimiter(config.redisUrl) : memoryRateLimiter();
  const deps: Deps = { db, config, glossary, rateLimiter, secretBox: createSecretBox(config.appSecret), clock: () => new Date() };

  const app = createApp(deps);
  if (config.staticDir) {
    const indexHtml = await readFile(`${config.staticDir}/index.html`, 'utf8');
    app.use('/assets/*', serveStatic({ root: config.staticDir }));
    app.use('/*', serveStatic({ root: config.staticDir }));
    // SPA fallback for client-side routes.
    app.get('*', (c) => c.html(indexHtml));
  }

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => log('info', 'listening', { port: info.port }));

  // Background jobs (single-instance scheduler; see docs/DEPLOYMENT_GUIDE.md for scaling notes).
  const senders = defaultSenders(deps);
  const every = (ms: number, name: string, job: () => Promise<unknown>) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await job();
      } catch (err) {
        log('error', `${name} failed`, { error: String(err) });
      } finally {
        running = false;
      }
    }, ms);
  };
  const timers = [
    every(5_000, 'notification dispatch', () => dispatchPending(deps, senders)),
    every(60_000, 'sla scan', () => scanSla(deps)),
    every(300_000, 'aging digest', () => agingDigest(deps)),
  ];

  const shutdown = async () => {
    log('info', 'shutting down');
    timers.forEach(clearInterval);
    server.close();
    await rateLimiter.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log('fatal', 'startup failed', { error: String(err), stack: (err as Error).stack });
  process.exit(1);
});
