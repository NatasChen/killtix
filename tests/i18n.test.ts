import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import enUS from '../src/server/i18n/locales/en-US.js';
import zhTW from '../src/server/i18n/locales/zh-TW.js';

const root = new URL('..', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Expands `prefix.${expr}` templates using the known value sets. */
const DYNAMIC: Record<string, string[]> = {
  'ticket.status.': ['new', 'open', 'pending_user', 'resolved', 'closed'],
  'ticket.priority.': ['1', '2', '3', '4', '5'],
  'ticket.sla.': ['on_track', 'at_risk', 'breached', 'met'],
  'ui.locale.': ['zh-TW', 'en-US'],
  'ui.role.': ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user', 'api_client'],
  'ui.notify.': ['pending', 'sending', 'sent', 'dead', 'skipped'],
  'ui.password.rule.': ['min_length', 'max_length', 'uppercase', 'lowercase', 'digit', 'symbol'],
  'ui.settings.mail.provider.': ['env', 'smtp', 'resend'],
  'ui.source.': ['web', 'api', 'email'],
  'ui.thread.': ['customer_message', 'agent_reply', 'internal_note', 'system_event'],
  'ui.visibility.': ['public', 'internal'],
  'notify.': [],
  'error.': [],
};

function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of files(join(root, 'src'))) {
    if (file.includes('/i18n/locales/')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*(?:[a-zA-Z.]+,\s*)?['`]((?:ui|ticket|error|notify)\.[^'`]+)['`]/g)) {
      const key = m[1];
      const dyn = key.indexOf('${');
      if (dyn === -1) {
        keys.add(key);
        continue;
      }
      const prefix = key.slice(0, dyn);
      const values = DYNAMIC[prefix];
      if (!values) throw new Error(`Unknown dynamic glossary prefix "${prefix}" in ${file}`);
      for (const v of values) keys.add(prefix + v);
    }
  }
  return [...keys].sort();
}

describe('glossary', () => {
  const keys = usedKeys();

  it('finds the keys used in the code', () => {
    expect(keys.length).toBeGreaterThan(150);
  });

  it.each([
    ['zh-TW', zhTW],
    ['en-US', enUS],
  ])('%s defines every key used in the code', (_, dict) => {
    expect(keys.filter((k) => !(k in dict))).toEqual([]);
  });

  it('both locales define the same keys', () => {
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(enUS).sort());
  });

  it('defines an error title for every ApiError code raised in the server', () => {
    const codes = new Set<string>();
    for (const file of files(join(root, 'src/server'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/new ApiError\(\s*\d+,\s*'([a-z_]+)'/g)) codes.add(m[1]);
    }
    codes.add('password_change_required').add('mfa_required').add('mfa_enrollment_required');
    const missing = [...codes].filter((c) => !(`error.${c}` in zhTW) || !(`error.${c}` in enUS));
    expect(missing).toEqual([]);
  });
});
