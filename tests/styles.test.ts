import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the design tokens and badge colours in src/web/styles.css
 * (PRD FR-5.3 / FR-5.4, AC-THEME-02). Reads the stylesheet directly: no DOM, no build step.
 */
const raw = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** `selector { declarations }` pairs; at-rule wrappers are skipped because their bodies contain braces. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
  body: m[2],
}));

function declarations(selector: string): string | undefined {
  return RULES.find((r) => r.selectors.includes(selector))?.body;
}

/** Every declaration block for a selector, including the ones inside @media blocks. */
function allDeclarations(selector: string): string[] {
  return RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
}

function varsOf(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function themeVars(selector: string): Record<string, string> {
  const body = declarations(selector);
  if (body === undefined) throw new Error(`theme block not found: ${selector}`);
  return varsOf(body);
}

const THEMES = [
  ['light', themeVars(":root[data-theme='light']")],
  ['dark', themeVars(":root[data-theme='dark']")],
] as const;

/** Theme-independent tokens (the typography scale) live in the plain :root block. */
const BASE_VARS = varsOf(RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === ':root')?.body ?? '');

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

/** Follows `var(--x)` chains so a token may alias another token (e.g. --bg: var(--canvas-soft)). */
function resolve(name: string, vars: Record<string, string>): string {
  let value = vars[name];
  for (let i = 0; i < 10 && value !== undefined; i++) {
    const alias = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
    if (!alias) return value;
    value = vars[alias];
  }
  throw new Error(`could not resolve ${name}`);
}

/** A single declaration value from a rule body ('' when the property is absent). */
function property(body: string, prop: string): string {
  return body.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
}

/** Resolves a declaration value that may be a literal or a single var(--x) alias. */
function resolveMaybe(value: string, vars: Record<string, string>): string {
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
  return alias ? resolve(alias, vars) : value;
}

/** Expands the 3-digit hex shorthand so #fff and #ffffff compare equal. */
function normaliseColour(value: string): string {
  const short = value.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return value.toLowerCase();
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
    expect(badgeVars('.badge.p3')).toEqual({ background: '--accent-soft', color: '--accent-strong' });
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
      expect(contrast(resolve(color, vars), resolve(background, vars)), `${selector} in ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('keeps the priority levels distinguishable in the %s theme', (_, vars) => {
    const backgrounds = ['.badge', '.badge.p3', '.badge.p4', '.badge.p5'].map((s) => resolve(badgeVars(s).background, vars));
    expect(new Set(backgrounds.map((c) => c.toLowerCase())).size).toBe(4);
  });
});

/** Variable names that existed before the redesign; tests and components depend on them. */
const LEGACY_VARS = ['--bg', '--surface', '--surface-2', '--border', '--text', '--text-muted', '--accent',
  '--accent-text', '--accent-soft', '--danger', '--danger-soft', '--warning', '--warning-soft', '--success',
  '--success-soft', '--internal', '--internal-border', '--shadow'];

/** Tokens added by the UI redesign (DESIGN.md); both themes must define every one of them. */
const NEW_VARS = ['--canvas-soft', '--hairline', '--border-strong', '--ink-1', '--ink-2', '--ink-3', '--accent-strong',
  '--shadow-soft', '--shadow-elevated',
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-full',
  '--space-xxs', '--space-xs', '--space-sm', '--space-md', '--space-lg', '--space-xl', '--space-xxl'];

describe('design tokens (FR-5.4)', () => {
  it('keeps every pre-existing variable name in both themes', () => {
    for (const [theme, vars] of THEMES) {
      for (const name of LEGACY_VARS) expect(vars[name], `${name} in ${theme}`).toBeDefined();
    }
  });

  it('defines the new design tokens in both themes', () => {
    for (const [theme, vars] of THEMES) {
      for (const name of NEW_VARS) expect(vars[name], `${name} in ${theme}`).toBeDefined();
    }
  });

  it('defines every light-theme token in dark as well', () => {
    // Dark is derived from light (DESIGN.md only defines light), so it must never lose a token: a
    // token defined only in light leaves the dark theme with an unresolved var() and breaks the
    // switch. Dark-only tokens (--overlay, --qr-canvas) are additive and allowed.
    const light = Object.keys(THEMES[0][1]);
    const dark = Object.keys(THEMES[1][1]);
    expect(light.filter((name) => !dark.includes(name))).toEqual([]);
  });

  it('uses the DESIGN.md radius and spacing scale in both themes', () => {
    const expected: Record<string, string> = {
      '--radius-xs': '4px', '--radius-md': '8px', '--radius-lg': '12px', '--radius-full': '9999px',
      '--space-xxs': '4px', '--space-xs': '8px', '--space-sm': '12px', '--space-md': '16px',
      '--space-lg': '24px', '--space-xxl': '32px',
    };
    for (const [theme, vars] of THEMES) {
      for (const [name, value] of Object.entries(expected)) expect(vars[name], `${name} in ${theme}`).toBe(value);
    }
  });

  it('meets WCAG AA for text on surfaces in both themes', () => {
    const pairs: [string, string][] = [
      ['--ink-1', '--canvas-soft'],
      ['--ink-1', '--surface'],
      ['--ink-2', '--canvas-soft'],
      ['--ink-3', '--canvas-soft'],
      ['--ink-3', '--surface'],
      ['--accent-strong', '--canvas-soft'],
      ['--accent-strong', '--surface'],
      ['--accent-strong', '--accent-soft'],
      ['--accent-text', '--accent'],
      ['--danger', '--danger-soft'],
      ['--warning', '--warning-soft'],
      ['--success', '--success-soft'],
    ];
    for (const [theme, vars] of THEMES) {
      for (const [fg, bg] of pairs) {
        expect(contrast(resolve(fg, vars), resolve(bg, vars)), `${fg} on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps control borders at >= 3:1 against surfaces in both themes', () => {
    for (const [theme, vars] of THEMES) {
      for (const bg of ['--surface', '--canvas-soft']) {
        expect(contrast(resolve('--border-strong', vars), resolve(bg, vars)), `--border-strong on ${bg} in ${theme}`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps semantic colours independent of the accent in both themes', () => {
    for (const [theme, vars] of THEMES) {
      const accent = [resolve('--accent', vars).toLowerCase(), resolve('--accent-strong', vars).toLowerCase()];
      for (const name of ['--danger', '--warning', '--success']) {
        expect(accent, `${name} in ${theme}`).not.toContain(resolve(name, vars).toLowerCase());
      }
    }
  });

  it('styles shared components with tokens instead of hardcoded values', () => {
    const components = ['.card', '.badge', '.banner', '.banner.error', '.modal-card', '.toast', '.ex-modal-card',
      '.ex-toast', '.empty-state', '.ex-empty-state-card', '.ex-auth-form-card', '.ex-app-shell-row',
      '.nav-link.active', '.msg', '.secret-box', '.tag', 'input', 'button.primary', 'button.danger'];
    for (const selector of components) {
      const body = declarations(selector);
      expect(body, selector).toBeDefined();
      expect(body, selector).toMatch(/var\(--(radius|space|shadow|accent|surface|border|ink|danger|warning|success)/);
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  it('loads no external resources (CSP allows same origin only)', () => {
    expect(raw).not.toMatch(/@import/);
    expect(raw).not.toMatch(/url\(\s*['"]?https?:/i);
  });
});

describe('shared components and layout (FR-5.4)', () => {
  it('uses the DESIGN.md light values for canvas, hairline and the single accent', () => {
    const light = THEMES[0][1];
    expect(light['--canvas-soft']).toBe('#f6f5f4');
    expect(light['--hairline']).toBe('#e6e6e6');
    expect(light['--accent']).toBe('#0075de');
    expect(light['--surface']).toBe('#ffffff');
  });

  it('keeps the stylesheet braces balanced', () => {
    const open = (css.match(/\{/g) ?? []).length;
    const close = (css.match(/\}/g) ?? []).length;
    expect(close, 'unbalanced braces in src/web/styles.css').toBe(open);
  });

  it('keeps the .card + .card margin trap fix (AGENTS.md §7.9)', () => {
    expect(declarations('.card + .card')).toMatch(/margin-top:\s*var\(--space-md\)/);
    expect(declarations('.grid > .card + .card')).toMatch(/margin-top:\s*0/);
  });

  it('paints the QR quiet zone and the modal overlay with tokens both themes define', () => {
    // Both surfaces must be themeable: the QR needs a white quiet zone in dark mode too, and the modal
    // backdrop must not hardcode its alpha. A token defined in only one theme breaks the theme switch.
    const pairs: [string, string][] = [
      ['.qr', '--qr-canvas'],
      ['.modal-backdrop', '--overlay'],
    ];
    for (const [selector, token] of pairs) {
      expect(declarations(selector) ?? '', selector).toContain(`var(${token})`);
      for (const [theme, vars] of THEMES) expect(vars[token], `${token} in ${theme}`).toBeDefined();
    }
  });

  it('keeps the auth card and the sidebar row on the DESIGN.md hook classes', () => {
    // The hook classes must exist in the stylesheet as well as in the markup, otherwise the JSX change
    // is cosmetic only and the DESIGN.md chrome never reaches the screen.
    expect(declarations('.ex-auth-form-card')).toBeDefined();
    expect(declarations('.ex-app-shell-row')).toBeDefined();
    expect(declarations('.ex-app-shell-row.active')).toBeDefined();
  });

  it('keeps the sidebar as the first column of the app shell', () => {
    expect(declarations('.shell')).toMatch(/grid-template-columns:\s*220px 1fr/);
    expect(declarations('.sidebar')).toMatch(/border-right:/);
  });

  it('contains no brand names from DESIGN.md', () => {
    expect(raw).not.toMatch(/notion/i);
  });
});
