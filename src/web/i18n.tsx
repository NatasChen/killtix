import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get } from './api';

/** All UI text comes from the server-side glossary (GET /api/v1/i18n/:locale). */
interface I18n {
  locale: string;
  locales: string[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: string) => void;
}

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = 'td-locale';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? navigator.language ?? 'zh-TW');
  const [messages, setMessages] = useState<Record<string, string> | null>(null);
  const [locales, setLocales] = useState<string[]>([]);

  useEffect(() => {
    get<{ locale: string; locales: string[]; messages: Record<string, string> }>(`/i18n/${encodeURIComponent(locale)}`).then((r) => {
      setMessages(r.messages);
      setLocales(r.locales);
      document.documentElement.lang = r.locale;
      if (r.locale !== locale) setLocaleState(r.locale);
    });
  }, [locale]);

  const t = useCallback(
    (key: string, vars: Record<string, string | number> = {}) =>
      (messages?.[key] ?? key).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n] ?? `{${n}}`)),
    [messages],
  );

  const setLocale = (l: string) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
  };

  if (!messages) return null;
  return <I18nContext.Provider value={{ locale, locales, t, setLocale }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}
