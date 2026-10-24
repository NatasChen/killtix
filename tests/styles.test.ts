import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the priority badge colours in src/web/styles.css (PRD FR-5.3 / AC-THEME-02).
 * Pure CSS assertions: no DOM, no build step, so they run in the normal Vitest suite.
 */
const CSS = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');

/** Removes /* … *\/ comments so they cannot be mistaken for declarations. */
const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { selector: string; body: string };

/** Top-level and nested simple rules (`selector { declarations }`), ignoring at-rule wrappers. */
function rules(source: string): Rule[] {
  const found: Rule[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim() });
  }
  return found;
}

const RULES = rules(css);

/** Declarations of the first rule whose selector list contains `selector` as one of its parts. */
function declarations(selector: string): string | undefined {
  const rule = RULES.find((r) => r.selector.split(',').map((s) => s.trim()).includes(selector));
  return rule?.body;
}

/** Custom properties of a theme block, e.g. `:root[data-theme='dark']`. */
function themeVars(selector: string): Record<string, string> {
  const body = declarations(selector);
  if (body === undefined) throw new Error(`theme block not found: ${selector}`);
  const vars: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const LIGHT = themeVars(":root[data-theme='light']");
const DARK = themeVars(":root[data-theme='dark']");

/** Resolves `var(--x)` to the literal value defined in the given theme. */
function resolve(value: string, vars: Record<string, string>): string {
  const m = value.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
  if (!m) return value;
  const resolved = vars[m[1]];
  if (!resolved) throw new Error(`undefined CSS variable ${m[1]}`);
  return resolved;
}

function luminance(hex: string): number {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`expected a 6-digit hex colour, got "${hex}"`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('priority badge colours (FR-5.3)', () => {
  it('defines .badge.p3 as its own rule', () => {
    const rule = RULES.find((r) => r.selector === '.badge.p3');
    expect(rule, '.badge.p3 must be a standalone rule, not part of a selector list').toBeDefined();
    expect(rule!.body).toContain('background: var(--accent-soft)');
    expect(rule!.body).toContain('color: var(--accent)');
  });

  it('uses only CSS variables in .badge.p3 (no hardcoded colours)', () => {
    const body = declarations('.badge.p3')!;
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(body).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    expect(body).not.toMatch(/:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow)\b/i);
    for (const m of body.matchAll(/:\s*([^;]+);/g)) {
      expect(m[1].trim()).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('leaves L1 and L2 on the neutral .badge default', () => {
    expect(declarations('.badge.p1')).toBeUndefined();
    expect(declarations('.badge.p2')).toBeUndefined();
    expect(declarations('.badge')).toContain('background: var(--surface-2)');
    expect(declarations('.badge')).toContain('color: var(--text-muted)');
  });

  /** The `background` / `color` variables a badge selector resolves to. */
  function colours(selector: string): { background: string; color: string } {
    const body = declarations(selector);
    expect(body, `${selector} must keep a rule`).toBeDefined();
    return {
      background: body!.match(/background:\s*([^;]+);/)![1].trim(),
      color: body!.match(/color:\s*([^;]+);/)![1].trim(),
    };
  }

  it('keeps L4 and L5 on the warning / danger colours', () => {
    expect(colours('.badge.p4')).toEqual({ background: 'var(--warning-soft)', color: 'var(--warning)' });
    expect(colours('.badge.p5')).toEqual({ background: 'var(--danger-soft)', color: 'var(--danger)' });
  });

  it('keeps the status and SLA badge colours unchanged', () => {
    const accent = { background: 'var(--accent-soft)', color: 'var(--accent)' };
    const warning = { background: 'var(--warning-soft)', color: 'var(--warning)' };
    const success = { background: 'var(--success-soft)', color: 'var(--success)' };
    const danger = { background: 'var(--danger-soft)', color: 'var(--danger)' };
    expect(colours('.badge.new')).toEqual(accent);
    expect(colours('.badge.open')).toEqual(accent);
    expect(colours('.badge.pending_user')).toEqual(warning);
    expect(colours('.badge.at_risk')).toEqual(warning);
    expect(colours('.badge.resolved')).toEqual(success);
    expect(colours('.badge.closed')).toEqual(success);
    expect(colours('.badge.met')).toEqual(success);
    expect(colours('.badge.breached')).toEqual(danger);
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('meets WCAG AA contrast (>= 4.5:1) in the %s theme', (_, vars) => {
    const body = declarations('.badge.p3')!;
    const background = resolve(body.match(/background:\s*([^;]+);/)![1], vars);
    const color = resolve(body.match(/color:\s*([^;]+);/)![1], vars);
    expect(contrast(color, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps L3 visually distinct from the neutral L1/L2 grey in both themes', () => {
    for (const vars of [LIGHT, DARK]) {
      const neutral = resolve('var(--surface-2)', vars);
      const accentSoft = resolve('var(--accent-soft)', vars);
      expect(accentSoft.toLowerCase()).not.toBe(neutral.toLowerCase());
    }
  });
});

/** Every rule whose selector list contains `selector`; more than one means a later override. */
function allDeclarations(selector: string): string[] {
  return RULES.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)).map((r) => r.body);
}

/** Custom properties referenced by a declaration body. */
function referencedVars(body: string): string[] {
  return [...body.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
}

/** The `background` / `color` declarations a badge selector keeps (variables left unresolved). */
function declaredColours(selector: string): { background: string; color: string } {
  const body = declarations(selector);
  if (body === undefined) throw new Error(`missing badge rule: ${selector}`);
  return {
    background: body.match(/background:\s*([^;]+);/)![1].trim(),
    color: body.match(/color:\s*([^;]+);/)![1].trim(),
  };
}

/** Badge selectors whose colours must stay WCAG AA in both themes (regression guard). */
const BADGE_SELECTORS = [
  '.badge',
  '.badge.new',
  '.badge.open',
  '.badge.pending_user',
  '.badge.at_risk',
  '.badge.resolved',
  '.badge.closed',
  '.badge.met',
  '.badge.breached',
  '.badge.p3',
  '.badge.p4',
  '.badge.p5',
];

/** Resolved background / text colour of a badge selector in one theme. */
function resolvedColours(selector: string, vars: Record<string, string>) {
  const { background, color } = declaredColours(selector);
  return { background: resolve(background, vars), color: resolve(color, vars) };
}

describe('priority badge regression guards (FR-5.3 / AC-THEME-02)', () => {
  it('defines .badge.p3 exactly once so no later rule overrides it', () => {
    expect(allDeclarations('.badge.p3')).toHaveLength(1);
  });

  it('keeps the pill shape inherited from .badge (no layout overrides in .badge.p3)', () => {
    const base = declarations('.badge')!;
    expect(base).toContain('border-radius: 999px');
    expect(base).toContain('font-size: 12px');
    expect(base).toContain('font-weight: 600');
    const body = declarations('.badge.p3')!;
    for (const prop of ['display', 'padding', 'border-radius', 'font-size', 'font-weight', 'white-space']) {
      expect(body).not.toMatch(new RegExp(`(^|;)\\s*${prop}\\s*:`, 'i'));
    }
  });

  it('references only CSS variables that both themes define', () => {
    for (const selector of BADGE_SELECTORS) {
      for (const name of referencedVars(declarations(selector)!)) {
        expect(LIGHT[name], `${selector} uses ${name}, which the light theme does not define`).toBeDefined();
        expect(DARK[name], `${selector} uses ${name}, which the dark theme does not define`).toBeDefined();
      }
    }
  });

  it('keeps L3 in the same accent family as the new / open status badges', () => {
    expect(declaredColours('.badge.p3')).toEqual(declaredColours('.badge.new'));
    expect(declaredColours('.badge.p3')).toEqual(declaredColours('.badge.open'));
  });

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ])('keeps every badge colour pair at WCAG AA (>= 4.5:1) in the %s theme', (theme, vars) => {
    for (const selector of BADGE_SELECTORS) {
      const { background, color } = resolvedColours(selector, vars);
      expect(contrast(color, background), `${selector} in the ${theme} theme`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the five priority levels distinguishable in both themes', () => {
    for (const vars of [LIGHT, DARK]) {
      const backgrounds = ['.badge', '.badge.p3', '.badge.p4', '.badge.p5'].map((selector) =>
        resolvedColours(selector, vars).background.toLowerCase(),
      );
      expect(new Set(backgrounds).size).toBe(4);
    }
  });

  it('does not use !important or external resources in badge rules (CSP stays same-origin)', () => {
    for (const selector of BADGE_SELECTORS) {
      const body = declarations(selector)!;
      expect(body).not.toMatch(/!important/i);
      expect(body).not.toMatch(/url\(|@import/i);
    }
  });

  it('keeps PriorityBadge a pure class-name renderer (no inline style, no colour literal)', () => {
    const source = readFileSync(new URL('../src/web/components/common.tsx', import.meta.url), 'utf8');
    const badge = source.match(/export function PriorityBadge[\s\S]*?\n}/)![0];
    expect(badge).toContain('className={`badge p${priority}`}');
    expect(badge).toContain('t(`ticket.priority.${priority}`)');
    expect(badge).not.toMatch(/\bstyle=/);
    expect(badge).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
