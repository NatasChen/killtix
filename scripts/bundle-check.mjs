// First-screen bundle guard, run by validate.sh after `npm run build`.
// The first screen loads index.html's entry script and its modulepreload chunks. This fails when
//   1. that JS grows past BUDGET_GZIP (e.g. a page is imported statically again instead of through lazyPage()), or
//   2. admin code reaches it: a glossary key used only under src/web/pages/admin/ appears in a first-screen chunk,
//      so end users and vendors would download the admin pages again.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_GZIP = 300 * 1024; // v0.6.0: about 260 KB; was 376 KB as a single bundle
const DIST = 'dist/web';
const WEB = 'src/web';

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
const keysIn = (text) => new Set(text.match(/'ui\.[a-z0-9_.]+'/g) ?? []);

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
if (!initial.length) throw new Error('no scripts found in dist/web/index.html');
const code = initial.map((f) => readFileSync(join(DIST, f)));
const gzip = code.reduce((n, c) => n + gzipSync(c).length, 0);
const kb = (n) => `${Math.round(n / 1024)} KB`;

const sources = files(WEB).filter((f) => /\.tsx?$/.test(f));
const adminFiles = sources.filter((f) => f.includes(join('pages', 'admin')));
const elsewhere = new Set(sources.filter((f) => !adminFiles.includes(f)).flatMap((f) => [...keysIn(readFileSync(f, 'utf8'))]));
const adminOnly = [...new Set(adminFiles.flatMap((f) => [...keysIn(readFileSync(f, 'utf8'))]))].filter((k) => !elsewhere.has(k));
const leaked = adminOnly.filter((k) => code.some((c) => c.includes(k)));

console.log(`first screen: ${initial.length} scripts, ${kb(gzip)} gzip (budget ${kb(BUDGET_GZIP)}); ${adminOnly.length} admin-only keys checked`);
if (gzip > BUDGET_GZIP) {
  console.error('First-screen JS is over budget. Load pages with lazyPage() (main.tsx, AdminRoutes.tsx), not static imports.');
  process.exit(1);
}
if (!adminOnly.length) throw new Error('found no admin-only glossary keys to check');
if (leaked.length) {
  console.error(`Admin code is in the first-screen bundle (${leaked.slice(0, 5).join(', ')}). Import admin pages only through AdminRoutes.tsx.`);
  process.exit(1);
}
