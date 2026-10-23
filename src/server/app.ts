import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { authenticate, csrfGuard } from './auth/session.js';
import type { AppEnv, Deps } from './context.js';
import { ApiError } from './errors.js';
import { SUPPORTED_LOCALES } from './i18n/index.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { reportRoutes } from './routes/reports.js';
import { ticketRoutes } from './routes/tickets.js';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
      strictTransportSecurity: deps.config.cookieSecure ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );
  app.use(async (c, next) => {
    c.set('deps', deps);
    c.set('auth', null);
    c.set('locale', deps.config.defaultLocale);
    await next();
  });

  app.onError((err, c) => {
    const { glossary } = deps;
    const locale = c.var.locale ?? deps.config.defaultLocale;
    if (err instanceof ApiError) {
      return c.json(
        {
          type: 'about:blank',
          title: glossary.t(locale, `error.${err.code}`),
          status: err.status,
          code: err.code,
          ...(err.detail ? { detail: err.detail } : {}),
          ...err.extra,
        },
        err.status,
        { 'Content-Type': 'application/problem+json' },
      );
    }
    console.error(JSON.stringify({ level: 'error', msg: 'unhandled', path: c.req.path, error: String(err), stack: (err as Error).stack }));
    return c.json(
      { type: 'about:blank', title: glossary.t(locale, 'error.internal_error'), status: 500, code: 'internal_error' },
      500,
      { 'Content-Type': 'application/problem+json' },
    );
  });

  app.get('/healthz', async (c) => {
    try {
      await deps.db.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'degraded', db: 'unreachable' }, 503);
    }
  });

  const api = new Hono<AppEnv>();
  api.use(authenticate, csrfGuard);
  api.get('/i18n/:locale', (c) => {
    const locale = deps.glossary.resolveLocale(c.req.param('locale'));
    c.header('Cache-Control', 'no-cache');
    return c.json({ locale, locales: SUPPORTED_LOCALES, messages: deps.glossary.messages(locale) });
  });
  api.route('/auth', authRoutes);
  api.route('/tickets', ticketRoutes);
  api.route('/admin', adminRoutes);
  api.route('/', catalogRoutes);
  api.route('/', reportRoutes);
  api.all('*', () => {
    throw new ApiError(404, 'not_found');
  });
  app.route('/api/v1', api);

  return app;
}
