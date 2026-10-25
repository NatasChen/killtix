/* The single source of TicketDesk colours (DESIGN.md tokens, specs/DECISIONS.md D8/D9/D10).
   Ant Design gets them as theme tokens (antdTheme() in theme.ts); badges, KPI bands, chart bars and the
   sidebar read them through tone(). DESIGN.md only defines the light theme; the dark values are
   derived from it. tests/styles.test.ts checks every contrast pair in both themes.
   No antd import here, so the test can load this file without the UI library. */
export type Mode = 'light' | 'dark';
export type Hue = 'sky' | 'purple' | 'pink' | 'orange' | 'teal';
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'grey' | Hue;

/** solid = bars, bands, tiles (>= 3:1 on surface); soft + ink = badge background and text (>= 4.5:1). */
export interface Swatch {
  solid: string;
  soft: string;
  ink: string;
}

export interface Palette {
  canvas: string;
  surface: string;
  surface2: string;
  hairline: string;
  /** control boundaries need 3:1 against the surface (WCAG 1.4.11) */
  borderStrong: string;
  ink1: string;
  ink2: string;
  ink3: string;
  /** the one structural accent: primary buttons, links, focus */
  accent: string;
  /** text on an accent fill */
  accentText: string;
  /** links and accent text (--accent itself is only 4.2:1 on the warm canvas) */
  accentStrong: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  internal: string;
  internalBorder: string;
  sticker: Record<Hue, Swatch>;
  /** sidebar: the DESIGN.md deep indigo "night" band */
  nav: { bg: string; text: string; muted: string; hover: string; active: string; indicator: string; divider: string; field: string; fieldBorder: string };
  navTile: Record<'sky' | 'purple' | 'orange' | 'teal', string>;
  /** the QR code needs a white quiet zone in both themes */
  qrCanvas: string;
}

export const PALETTES: Record<Mode, Palette> = {
  light: {
    canvas: '#f6f5f4',
    surface: '#ffffff',
    surface2: '#f1efec',
    hairline: '#e6e6e6',
    borderStrong: '#8f8b86',
    ink1: '#191919',
    ink2: '#31302e',
    ink3: '#615d59',
    accent: '#0075de',
    accentText: '#ffffff',
    accentStrong: '#005bab',
    accentSoft: '#e6f0fb',
    danger: '#c0352b',
    dangerSoft: '#fbe9e7',
    warning: '#a35c00',
    warningSoft: '#fdf0dc',
    success: '#1d7a46',
    successSoft: '#e3f4ea',
    internal: '#fff8e1',
    internalBorder: '#e7c86b',
    sticker: {
      sky: { solid: '#2f86d1', soft: '#e2f0fc', ink: '#0b5794' },
      purple: { solid: '#8b5cc7', soft: '#f1e8fc', ink: '#5b2d8e' },
      pink: { solid: '#d13c9b', soft: '#fde7f4', ink: '#9a1d6b' },
      orange: { solid: '#dd5b00', soft: '#fdede2', ink: '#8a3c00' },
      teal: { solid: '#2a9d99', soft: '#d9f1f4', ink: '#0f5f66' },
    },
    nav: {
      bg: '#213183',
      text: '#eef0ff',
      muted: '#b9c1ec',
      hover: '#2a3b8f',
      active: '#34459c',
      indicator: '#62aef0',
      divider: '#3a4a9a',
      field: '#1a276b',
      fieldBorder: '#7d89cf',
    },
    navTile: { sky: '#62aef0', purple: '#c7a4f2', orange: '#f59a5c', teal: '#4cc3be' },
    qrCanvas: '#ffffff',
  },
  dark: {
    canvas: '#1b1a18',
    surface: '#232220',
    surface2: '#2c2b28',
    hairline: '#3a3835',
    borderStrong: '#75726c',
    ink1: '#f2f0ed',
    ink2: '#d6d2cc',
    ink3: '#a8a39c',
    accent: '#6f9bff',
    accentText: '#0b1020',
    accentStrong: '#9dc0ff',
    accentSoft: '#1c2847',
    danger: '#ff7b6e',
    dangerSoft: '#3a1d1b',
    warning: '#f0b45a',
    warningSoft: '#3a2b14',
    success: '#5fd394',
    successSoft: '#16301f',
    internal: '#2c2614',
    internalBorder: '#7a6526',
    sticker: {
      sky: { solid: '#62aef0', soft: '#132a40', ink: '#8cc4f5' },
      purple: { solid: '#b48ae8', soft: '#2a1d3f', ink: '#cfb2f2' },
      pink: { solid: '#f27cc8', soft: '#3b1531', ink: '#f7a6da' },
      orange: { solid: '#f08a45', soft: '#3b2212', ink: '#f6ae7c' },
      teal: { solid: '#4cc3be', soft: '#0f2f2e', ink: '#7fd8d3' },
    },
    nav: {
      bg: '#161d4f',
      text: '#e6e9ff',
      muted: '#a9b2e4',
      hover: '#1f2863',
      active: '#2a367a',
      indicator: '#62aef0',
      divider: '#2a3370',
      field: '#10163d',
      fieldBorder: '#6f7bc0',
    },
    navTile: { sky: '#62aef0', purple: '#c7a4f2', orange: '#f59a5c', teal: '#4cc3be' },
    qrCanvas: '#ffffff',
  },
};

/** One hue per meaning, shared by badges, KPI bands and chart bars. */
export function tone(p: Palette, t: Tone): Swatch {
  switch (t) {
    case 'blue':
      return { solid: p.accent, soft: p.accentSoft, ink: p.accentStrong };
    case 'green':
      return { solid: p.success, soft: p.successSoft, ink: p.success };
    case 'amber':
      return { solid: p.warning, soft: p.warningSoft, ink: p.warning };
    case 'red':
      return { solid: p.danger, soft: p.dangerSoft, ink: p.danger };
    case 'grey':
      return { solid: p.ink3, soft: p.surface2, ink: p.ink3 };
    default:
      return p.sticker[t];
  }
}

/* Statuses use sticker hues so they never match the priority badge next to them (L3 is accent blue). */
export const STATUS_TONE: Record<string, Tone> = { new: 'purple', open: 'teal', pending_user: 'pink', resolved: 'green', closed: 'grey' };
export const PRIORITY_TONE: Record<number, Tone> = { 1: 'grey', 2: 'grey', 3: 'blue', 4: 'amber', 5: 'red' };
/** SLA "paused" means waiting for the user, so it shares the pending_user hue. */
export const SLA_TONE: Record<string, Tone> = { on_track: 'grey', at_risk: 'amber', breached: 'red', met: 'green', paused: 'pink' };
export const ROTATION: Hue[] = ['sky', 'purple', 'pink', 'orange', 'teal'];

export const FONT_FAMILY =
  "'Noto Sans Display Variable', 'Noto Sans TC Variable', system-ui, -apple-system, 'Segoe UI', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
