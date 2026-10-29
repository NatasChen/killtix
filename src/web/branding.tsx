import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { get } from './api';
import { useI18n } from './i18n';

/** Public URLs of the uploaded company logos (null = not uploaded). */
export interface LogoUrls {
  light: string | null;
  dark: string | null;
}

const DEFAULT_NAME = 'TicketDesk';

const BrandingContext = createContext<{
  logo: LogoUrls;
  name: string;
  setLogo: (logo: LogoUrls) => void;
  setName: (name: string) => void;
}>({ logo: { light: null, dark: null }, name: DEFAULT_NAME, setLogo: () => undefined, setName: () => undefined });

/**
 * Loads the logo URLs and the product name once (also before sign-in, for the login page); the settings page
 * updates them after saving. The name is also the browser tab title.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [logo, setLogo] = useState<LogoUrls>({ light: null, dark: null });
  const [name, setName] = useState(DEFAULT_NAME);
  useEffect(() => {
    get<{ logo: LogoUrls; name: string }>('/branding')
      .then((r) => {
        setLogo(r.logo);
        setName(r.name);
      })
      .catch(() => undefined); // keep the TicketDesk mark and name
  }, []);
  useEffect(() => {
    document.title = name;
  }, [name]);
  return <BrandingContext.Provider value={{ logo, name, setLogo, setName }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

/**
 * The brand mark at the top of the sidebar and the login card: two elements, the logo (the company logo when one
 * is uploaded, otherwise the TicketDesk icon) and the product name. `on` is the background it sits on: a dark
 * background uses the dark-background logo and falls back to the light one. `compact` (the collapsed sidebar) shows
 * the logo alone, scaled down to fit.
 */
export function Brand({ on, color, compact }: { on: 'light' | 'dark'; color?: string; compact?: boolean }) {
  const { t } = useI18n();
  const { logo, name } = useBranding();
  const src = on === 'dark' ? (logo.dark ?? logo.light) : logo.light;
  return (
    <div className={compact ? 'brand compact' : 'brand'} style={{ color }}>
      {src ? (
        <img className="brand-logo" src={src} alt={t('ui.brand.logo_alt')} />
      ) : (
        <img src="/favicon.svg" width={22} height={22} alt="" />
      )}
      {!compact && <span className="brand-name">{name}</span>}
    </div>
  );
}
