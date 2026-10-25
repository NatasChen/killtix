import { useEffect, useState } from 'react';
import { theme as antdThemes, type ThemeConfig } from 'antd';
import { FONT_FAMILY, PALETTES, type Mode } from './palette';

export type ThemePref = 'light' | 'dark' | 'system';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem('td-theme', pref);
  } catch {
    /* storage unavailable: theme still applies for this page */
  }
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function currentThemePref(): ThemePref {
  try {
    return (localStorage.getItem('td-theme') as ThemePref) ?? 'system';
  } catch {
    return 'system';
  }
}

/** Keeps "system" in sync with OS changes. */
export function watchSystemTheme() {
  media().addEventListener('change', () => {
    if (currentThemePref() === 'system') applyTheme('system');
  });
}

/** The applied theme (light/dark), following data-theme on <html> as applyTheme() changes it. */
export function useThemeMode(): Mode {
  const read = (): Mode => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [mode, setMode] = useState<Mode>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

/** Ant Design theme for one mode: DESIGN.md radii and type, the palette as seed and map tokens. */
export function antdTheme(mode: Mode): ThemeConfig {
  const p = PALETTES[mode];
  return {
    algorithm: mode === 'dark' ? antdThemes.darkAlgorithm : antdThemes.defaultAlgorithm,
    token: {
      colorPrimary: p.accent,
      colorLink: p.accentStrong,
      colorError: p.danger,
      colorWarning: p.warning,
      colorSuccess: p.success,
      colorInfo: p.accent,
      colorBgLayout: p.canvas,
      colorBgContainer: p.surface,
      colorBgElevated: p.surface,
      colorFillAlter: p.surface2,
      colorBorder: p.borderStrong,
      colorBorderSecondary: p.hairline,
      colorText: p.ink1,
      colorTextSecondary: p.ink3,
      colorTextDescription: p.ink3,
      colorTextPlaceholder: p.ink3,
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      borderRadius: 8,
      borderRadiusSM: 4,
      borderRadiusLG: 12,
      boxShadowTertiary: 'none',
    },
    components: {
      Layout: { siderBg: p.nav.bg, bodyBg: p.canvas },
      Menu: {
        darkItemBg: p.nav.bg,
        darkSubMenuItemBg: p.nav.bg,
        darkItemColor: p.nav.text,
        darkItemHoverBg: p.nav.hover,
        darkItemHoverColor: p.nav.text,
        darkItemSelectedBg: p.nav.active,
        darkItemSelectedColor: p.nav.text,
        darkGroupTitleColor: p.nav.muted,
      },
      Button: { primaryColor: p.accentText, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
      Table: { headerBg: p.surface2, headerColor: p.ink3, rowHoverBg: p.surface2 },
      Card: { headerFontSize: 16 },
    },
  };
}
