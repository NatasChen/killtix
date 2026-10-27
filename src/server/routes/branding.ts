import { Hono } from 'hono';
import type { AppEnv } from '../context.js';
import { LOGO_VARIANTS, type LogoVariant } from '../db/schema.js';
import { notFound } from '../errors.js';
import { getLogo, logoUrls } from '../services/branding.js';
import { getSetting } from '../services/settings.js';

/**
 * Company logo and product name for the login page and the sidebar. Deliberately public (no guard()): the login
 * page shows them before anyone signs in, and they are the only data served here (specs/DECISIONS.md D11).
 */
export const brandingRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    c.header('Cache-Control', 'no-cache');
    const { db } = c.var.deps;
    return c.json({ logo: await logoUrls(db), name: await getSetting(db, 'branding.name') });
  })

  .get('/logo/:variant', async (c) => {
    const variant = c.req.param('variant') as LogoVariant;
    if (!LOGO_VARIANTS.includes(variant)) throw notFound();
    const logo = await getLogo(c.var.deps.db, variant);
    if (!logo) throw notFound();
    const etag = `"${logo.sha256}"`;
    // A URL carrying the current hash never changes content; anything else revalidates.
    const versioned = c.req.query('v') === logo.sha256.slice(0, 16);
    c.header('ETag', etag);
    c.header('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.body(Buffer.from(logo.data, 'base64'), 200, { 'Content-Type': 'image/png' });
  });
