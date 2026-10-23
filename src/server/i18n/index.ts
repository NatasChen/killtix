import { glossaryTerms } from '../db/schema.js';
import type { DB } from '../db/client.js';
import enUS from './locales/en-US.js';
import zhTW from './locales/zh-TW.js';

/**
 * Glossary-based i18n. Built-in dictionaries live in ./locales/<locale>.ts; adding a locale
 * means adding one file and registering it here. Rows in `glossary_terms` override built-ins
 * at runtime without a redeploy. Missing keys fall back to en-US, then to the key itself.
 */
const BUILTIN: Record<string, Record<string, string>> = { 'zh-TW': zhTW, 'en-US': enUS };
export const FALLBACK_LOCALE = 'en-US';
export const SUPPORTED_LOCALES = Object.keys(BUILTIN);

export class Glossary {
  private overrides = new Map<string, Record<string, string>>();

  constructor(private readonly defaultLocale: string) {}

  async load(db: DB) {
    const rows = await db.select().from(glossaryTerms);
    this.overrides.clear();
    for (const row of rows) {
      const bucket = this.overrides.get(row.locale) ?? {};
      bucket[row.key] = row.value;
      this.overrides.set(row.locale, bucket);
    }
  }

  resolveLocale(requested?: string | null): string {
    if (requested) {
      if (BUILTIN[requested]) return requested;
      const lang = requested.split('-')[0];
      const match = SUPPORTED_LOCALES.find((l) => l.startsWith(`${lang}-`));
      if (match) return match;
    }
    return this.defaultLocale;
  }

  fromAcceptLanguage(header?: string | null): string {
    const first = header?.split(',')[0]?.split(';')[0]?.trim();
    return this.resolveLocale(first);
  }

  messages(locale: string): Record<string, string> {
    return {
      ...BUILTIN[FALLBACK_LOCALE],
      ...this.overrides.get(FALLBACK_LOCALE),
      ...BUILTIN[locale],
      ...this.overrides.get(locale),
    };
  }

  t(locale: string, key: string, vars: Record<string, string | number> = {}): string {
    const template =
      this.overrides.get(locale)?.[key] ??
      BUILTIN[locale]?.[key] ??
      this.overrides.get(FALLBACK_LOCALE)?.[key] ??
      BUILTIN[FALLBACK_LOCALE]?.[key] ??
      key;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  }
}
