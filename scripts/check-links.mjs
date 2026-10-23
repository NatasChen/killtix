// Fails when a Markdown file links to a repository path that does not exist.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const skip = new Set(['node_modules', 'dist', '.git']);
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name.endsWith('.md') ? [p] : [];
  });

let broken = 0;
for (const file of walk('.')) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = resolve(dirname(file), decodeURI(target.split('#')[0]));
    if (!existsSync(path)) {
      console.error(`${file}: broken link → ${target}`);
      broken++;
    }
  }
}
if (broken) process.exit(1);
console.log('links ok');
