import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES, PRIORITY_TONE, SLA_TONE, STATUS_TONE, tone, type Palette } from '../src/web/palette';
import { antdTheme } from '../src/web/theme';

/**
 * Guards the colours of the UI (PRD FR-5.3 / FR-5.4, AC-THEME-02~05): src/web/palette.ts is the single
 * colour source for Ant Design and the custom badges; styles.css only repeats the first-paint colours.
 */
const THEMES = Object.entries(PALETTES) as [string, Palette][];

function luminance(hex: string): number {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`expected a 6-digit hex colour, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const keysDeep = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keysDeep(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe('badge colours (FR-5.3)', () => {
  it('gives L3 the accent tint and keeps L1 and L2 neutral', () => {
    expect(PRIORITY_TONE[3]).toBe('blue');
    expect(PRIORITY_TONE[1]).toBe('grey');
    expect(PRIORITY_TONE[2]).toBe('grey');
    expect(STATUS_TONE.closed).toBe('grey');
  });

  it.each(THEMES)('meets WCAG AA (>= 4.5:1) for every badge in the %s theme', (theme, p) => {
    const tones = new Set([...Object.values(STATUS_TONE), ...Object.values(PRIORITY_TONE), ...Object.values(SLA_TONE)]);
    for (const t of tones) {
      const s = tone(p, t);
      expect(contrast(s.ink, s.soft), `${t} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('keeps the priority levels distinguishable in the %s theme', (_, p) => {
    const backgrounds = [1, 3, 4, 5].map((n) => tone(p, PRIORITY_TONE[n]).soft.toLowerCase());
    expect(new Set(backgrounds).size).toBe(4);
  });

  it.each(THEMES)('gives every open status its own colour, none shared with a priority, in the %s theme', (_, p) => {
    // The status and priority columns sit side by side in the ticket list (the old "new" = L3 blue clash).
    const bg = (t: Parameters<typeof tone>[1]) => tone(p, t).soft.toLowerCase();
    const statuses = ['new', 'open', 'pending_user', 'resolved'].map((s) => bg(STATUS_TONE[s]));
    expect(new Set(statuses).size).toBe(4);
    for (const n of [3, 4, 5]) expect(statuses).not.toContain(bg(PRIORITY_TONE[n]));
  });
});

describe('palette (FR-5.4)', () => {
  it('defines the same colour set in both themes, all as 6-digit hex', () => {
    expect(keysDeep(PALETTES.dark).sort()).toEqual(keysDeep(PALETTES.light).sort());
    for (const [, p] of THEMES) for (const key of keysDeep(p)) expect(key.split('.').reduce((o: any, k) => o[k], p)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(THEMES)('meets WCAG AA for text on surfaces in the %s theme', (theme, p) => {
    const pairs: [keyof Palette, keyof Palette][] = [
      ['ink1', 'canvas'],
      ['ink1', 'surface'],
      ['ink2', 'canvas'],
      ['ink3', 'canvas'],
      ['ink3', 'surface'],
      ['accentStrong', 'canvas'],
      ['accentStrong', 'surface'],
      ['accentStrong', 'accentSoft'],
      ['accentText', 'accent'],
      ['danger', 'dangerSoft'],
      ['danger', 'surface'],
      ['warning', 'warningSoft'],
      ['success', 'successSoft'],
      ['ink1', 'internal'],
    ];
    for (const [fg, bg] of pairs) expect(contrast(p[fg] as string, p[bg] as string), `${fg} on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('keeps control borders at >= 3:1 against surfaces in the %s theme', (theme, p) => {
    for (const bg of [p.surface, p.canvas]) expect(contrast(p.borderStrong, bg), theme).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('keeps semantic colours independent of the accent in the %s theme', (theme, p) => {
    const accent = [p.accent, p.accentStrong].map((c) => c.toLowerCase());
    for (const c of [p.danger, p.warning, p.success]) expect(accent, theme).not.toContain(c.toLowerCase());
  });

  it.each(THEMES)('keeps the sticker data colours readable in the %s theme', (theme, p) => {
    for (const [hue, s] of Object.entries(p.sticker)) {
      // solid fills bars, bands and tiles (non-text, 3:1); ink is text on the soft tint and on cards (4.5:1)
      expect(contrast(s.solid, p.surface), `${hue} solid in ${theme}`).toBeGreaterThanOrEqual(3);
      expect(contrast(s.ink, s.soft), `${hue} ink in ${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(s.ink, p.surface), `${hue} ink on surface in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('keeps the indigo sidebar readable in the %s theme', (theme, p) => {
    for (const bg of [p.nav.bg, p.nav.hover, p.nav.active, p.nav.field]) {
      expect(contrast(p.nav.text, bg), `nav text on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(p.nav.muted, p.nav.bg), theme).toBeGreaterThanOrEqual(4.5);
    for (const fg of [p.nav.indicator, p.nav.fieldBorder, ...Object.values(p.navTile)]) {
      expect(contrast(fg, p.nav.bg), `${fg} on nav in ${theme}`).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)('keeps the sidebar theme switch and its sun/moon icon visible in the %s theme', (theme, p) => {
    // non-text UI (WCAG 1.4.11): the track against the sidebar, the icon and handle against the track
    expect(contrast(p.themeSwitch.track, p.nav.bg), theme).toBeGreaterThanOrEqual(3);
    expect(contrast(p.themeSwitch.icon, p.themeSwitch.track), theme).toBeGreaterThanOrEqual(3);
  });
});

describe('Ant Design theme (FR-5.4)', () => {
  it.each(THEMES)('feeds the palette into the antd tokens in the %s theme', (theme, p) => {
    const cfg = antdTheme(theme as 'light' | 'dark');
    expect(cfg.token?.colorPrimary).toBe(p.accent);
    expect(cfg.token?.colorBgLayout).toBe(p.canvas);
    expect(cfg.token?.colorBgContainer).toBe(p.surface);
    expect(cfg.token?.colorText).toBe(p.ink1);
    expect(cfg.components?.Layout?.siderBg).toBe(p.nav.bg);
  });

  it.each(THEMES)('keeps primary button text readable in the %s theme', (theme, p) => {
    // antd's default white text on the light dark-theme blue would be 2.6:1
    const cfg = antdTheme(theme as 'light' | 'dark');
    expect(contrast(cfg.components!.Button!.primaryColor as string, p.accent), theme).toBeGreaterThanOrEqual(4.5);
  });
});

describe('styles.css', () => {
  const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  const block = (selector: string) => css.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const vars = (body: string) => Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

  it.each(THEMES)('paints the first frame with the palette canvas and ink in the %s theme', (theme, p) => {
    const v = vars(block(`:root[data-theme='${theme}']`));
    expect(v).toEqual({ '--canvas': p.canvas, '--ink-1': p.ink1, '--ink-3': p.ink3 });
  });

  it('loads no external resources (CSP allows same origin only)', () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(\s*['"]?https?:/i);
  });
});
