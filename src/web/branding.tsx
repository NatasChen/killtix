import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { get } from './api';
import { useI18n } from './i18n';

/** Public URLs of the uploaded company logos (null = not uploaded). */
export interface LogoUrls {
  light: string | null;
  dark: string | null;
}

const BrandingContext = createContext<{ logo: LogoUrls; setLogo: (logo: LogoUrls) => void }>({
  logo: { light: null, dark: null },
  setLogo: () => undefined,
});

/** Loads the logo URLs once (also before sign-in, for the login page); the settings page updates them after an upload. */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [logo, setLogo] = useState<LogoUrls>({ light: null, dark: null });
  useEffect(() => {
    get<{ logo: LogoUrls }>('/branding')
      .then((r) => setLogo(r.logo))
      .catch(() => undefined); // no logo: the TicketDesk mark is shown
  }, []);
  return <BrandingContext.Provider value={{ logo, setLogo }}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

/**
 * The brand mark at the top of the sidebar and the login card: the company logo when one is uploaded,
 * otherwise the TicketDesk icon and name. `on` is the background it sits on: a dark background uses the
 * dark-background logo and falls back to the light one.
 */
export function Brand({ on, color }: { on: 'light' | 'dark'; color?: string }) {
  const { t } = useI18n();
  const { logo } = useBranding();
  const src = on === 'dark' ? (logo.dark ?? logo.light) : logo.light;
  if (src) {
    return (
      <div className="brand">
        <img className="brand-logo" src={src} alt={t('ui.brand.logo_alt')} />
      </div>
    );
  }
  return (
    <div className="brand" style={{ color }}>
      <img src="/favicon.svg" width={22} height={22} alt="" /> TicketDesk
    </div>
  );
}
