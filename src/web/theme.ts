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
