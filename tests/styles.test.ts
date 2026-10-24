import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the badge colours in src/web/styles.css (PRD FR-5.3 / AC-THEME-02).
 * Reads the stylesheet directly: no DOM, no build step.
 */
const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** `selector { declarations }` pairs; at-rule wrappers are skipped because their bodies contain braces. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body: m[2],
}));

function declarations(selector: string): string | undefined {
  return RULES.find((r) => r.selectors.includes(selector))?.body;
}

function themeVars(selector: string): Record<string, string> {
  const body = declarations(selector);
  if (body === undefined) throw new Error(`theme block not found: ${selector}`);
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const THEMES = [
  ['light', themeVars(":root[data-theme='light']")],
  ['dark', themeVars(":root[data-theme='dark']")],
] as const;

const BADGES = ['.badge', '.badge.new', '.badge.open', '.badge.pending_user', '.badge.at_risk', '.badge.resolved',
  '.badge.closed', '.badge.met', '.badge.breached', '.badge.p3', '.badge.p4', '.badge.p5'];

/** The variable names a badge uses for its background and text colour. */
function badgeVars(selector: string): { background: string; color: string } {
  const body = declarations(selector) ?? '';
  const pick = (prop: string) => body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*var\\((--[a-z0-9-]+)\\)\\s*;`))?.[1];
  const background = pick('background');
  const color = pick('color');
  if (!background || !color) throw new Error(`${selector} must set background and color with var(--…)`);
  return { background, color };
}

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

describe('badge colours (FR-5.3)', () => {
  it('gives L3 its own accent rule', () => {
    expect(RULES.filter((r) => r.selectors.includes('.badge.p3'))).toHaveLength(1);
    expect(badgeVars('.badge.p3')).toEqual({ background: '--accent-soft', color: '--accent' });
  });

  it('keeps L1 and L2 on the neutral .badge default', () => {
    expect(declarations('.badge.p1')).toBeUndefined();
    expect(declarations('.badge.p2')).toBeUndefined();
  });

  it('uses only variables that both themes define', () => {
    for (const selector of BADGES) {
      for (const name of Object.values(badgeVars(selector))) {
        for (const [theme, vars] of THEMES) expect(vars[name], `${selector}: ${name} in ${theme}`).toBeDefined();
      }
    }
  });

  it.each(THEMES)('meets WCAG AA (>= 4.5:1) for every badge in the %s theme', (theme, vars) => {
    for (const selector of BADGES) {
      const { background, color } = badgeVars(selector);
      expect(contrast(vars[color], vars[background]), `${selector} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('keeps the priority levels distinguishable in the %s theme', (_, vars) => {
    const backgrounds = ['.badge', '.badge.p3', '.badge.p4', '.badge.p5'].map((s) => vars[badgeVars(s).background]);
    expect(new Set(backgrounds.map((c) => c.toLowerCase())).size).toBe(4);
  });
});
