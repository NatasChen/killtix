/* Dashboard grid layouts (react-grid-layout): the default arrangement, size limits per kind of card, and the
   per-browser saved layout. Nothing here touches React or the DOM, so tests/dashboardLayout.test.ts covers it.
   A saved layout only arranges cards: which cards exist and their numbers still come from the API, so a
   tampered or stale value can at worst move cards around. It is validated on every read (unknown cards
   dropped, sizes clamped to the limits, missing cards added back) and falls back to the default. */

export type Breakpoint = 'lg' | 'md' | 'sm';
/** Breakpoints are on the width of the dashboard (the page column), not the window. */
export const BREAKPOINTS: Record<Breakpoint, number> = { lg: 960, md: 560, sm: 0 };
export const COLS: Record<Breakpoint, number> = { lg: 24, md: 12, sm: 2 };
export const ROW_HEIGHT = 32;
export const MARGIN: [number, number] = [16, 16];

/** kpi: one number; chart: a card with a chart or list; wide: the trend line */
export type WidgetKind = 'kpi' | 'chart' | 'wide';
export interface Widget {
  id: string;
  kind: WidgetKind;
  /** default height in rows when the content needs more or less than the kind's default */
  h?: number;
}
export interface Item {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
}
export type Layouts = Record<Breakpoint, Item[]>;
/** one grid per dashboard section */
export type Section = 'now' | 'period';
export type SavedLayouts = Record<Section, Layouts>;

type Limits = Pick<Item, 'minW' | 'maxW' | 'minH' | 'maxH'>;
const LIMITS: Record<WidgetKind, Record<Breakpoint, Limits>> = {
  kpi: {
    lg: { minW: 4, maxW: 12, minH: 2, maxH: 4 },
    md: { minW: 3, maxW: 12, minH: 2, maxH: 4 },
    sm: { minW: 1, maxW: 2, minH: 2, maxH: 4 },
  },
  chart: {
    lg: { minW: 6, maxW: 24, minH: 5, maxH: 14 },
    md: { minW: 4, maxW: 12, minH: 5, maxH: 14 },
    sm: { minW: 2, maxW: 2, minH: 5, maxH: 14 },
  },
  wide: {
    lg: { minW: 12, maxW: 24, minH: 5, maxH: 14 },
    md: { minW: 8, maxW: 12, minH: 5, maxH: 14 },
    sm: { minW: 2, maxW: 2, minH: 5, maxH: 14 },
  },
};
export const limitsOf = (kind: WidgetKind, bp: Breakpoint): Limits => LIMITS[kind][bp];

/** Default width and height: KPI cards share the row; charts are halves (now) or quarters (period). */
function defaultSize(w: Widget, bp: Breakpoint, section: Section, kpis: number): { w: number; h: number } {
  if (w.kind === 'kpi') {
    if (bp === 'sm') return { w: 1, h: 3 };
    if (bp === 'md') return { w: 4, h: 3 };
    return { w: Math.max(LIMITS.kpi.lg.minW, Math.floor(COLS.lg / kpis)), h: 3 };
  }
  const h = w.h ?? 8;
  if (w.kind === 'wide' || bp === 'sm') return { w: COLS[bp], h };
  // now: halves on wide screens, full width below; period: quarters, halves below
  if (section === 'now') return { w: bp === 'lg' ? COLS.lg / 2 : COLS.md, h };
  return { w: 6, h };
}

/** Lays the cards out left to right in their order, starting a new row when one does not fit. */
export function defaultLayouts(widgets: Widget[], section: Section): Layouts {
  const kpis = widgets.filter((w) => w.kind === 'kpi').length;
  const out = {} as Layouts;
  for (const bp of Object.keys(COLS) as Breakpoint[]) {
    let [x, y, rowH] = [0, 0, 0];
    // the KPI row fills the width: the first cards take the remainder of the division
    let spare = bp === 'lg' && kpis ? COLS.lg - kpis * Math.floor(COLS.lg / kpis) : 0;
    out[bp] = widgets.map((wd) => {
      const size = defaultSize(wd, bp, section, kpis);
      if (wd.kind === 'kpi' && spare > 0 && size.w < LIMITS.kpi.lg.maxW) {
        size.w += 1;
        spare -= 1;
      }
      if (x + size.w > COLS[bp]) [x, y, rowH] = [0, y + rowH, 0];
      const item = { i: wd.id, x, y, ...size, ...limitsOf(wd.kind, bp) };
      x += size.w;
      rowH = Math.max(rowH, size.h);
      return item;
    });
  }
  return out;
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** far enough down for any real dashboard; compaction moves cards back up */
const MAX_Y = 1000;

/** One breakpoint of a saved layout, made valid for the cards on screen now. */
function restoreBreakpoint(raw: unknown, widgets: Widget[], defaults: Item[], bp: Breakpoint): Item[] {
  if (!Array.isArray(raw)) return defaults;
  const kinds = new Map(widgets.map((w) => [w.id, w.kind]));
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const { i } = r as { i?: unknown };
    const kind = typeof i === 'string' ? kinds.get(i) : undefined;
    if (typeof i !== 'string' || !kind || seen.has(i)) continue;
    const [x, y, w, h] = (['x', 'y', 'w', 'h'] as const).map((k) => int((r as Record<string, unknown>)[k]));
    if (x === null || y === null || w === null || h === null) continue;
    const lim = limitsOf(kind, bp);
    const width = clamp(w, lim.minW, Math.min(lim.maxW, COLS[bp]));
    items.push({ i, x: clamp(x, 0, COLS[bp] - width), y: clamp(y, 0, MAX_Y), w: width, h: clamp(h, lim.minH, lim.maxH), ...lim });
    seen.add(i);
  }
  // cards that are new or were not on screen when the layout was saved go below the saved ones
  const bottom = Math.max(0, ...items.map((it) => it.y + it.h));
  for (const d of defaults) if (!seen.has(d.i)) items.push({ ...d, y: bottom + d.y });
  return items;
}

/** A saved layout (anything parsed from storage) checked against the cards on screen; defaults where it is not usable. */
export function restoreLayouts(raw: unknown, widgets: Widget[], section: Section): Layouts {
  const defaults = defaultLayouts(widgets, section);
  if (typeof raw !== 'object' || raw === null) return defaults;
  const out = {} as Layouts;
  for (const bp of Object.keys(COLS) as Breakpoint[]) out[bp] = restoreBreakpoint((raw as Record<string, unknown>)[bp], widgets, defaults[bp], bp);
  return out;
}

/** What is stored: positions and sizes only; the limits always come from the code. */
export const toStored = (layouts: Partial<Record<Breakpoint, readonly { i: string; x: number; y: number; w: number; h: number }[]>>) =>
  Object.fromEntries(Object.entries(layouts).map(([bp, items]) => [bp, (items ?? []).map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))]));

// The layout is a per-browser convenience (like the sidebar state), one per user so a shared browser keeps each
// person's own; storage may be unavailable or hold anything.
const VERSION = 1;
export const storageKey = (userId: number) => `td-dashboard-layout:${userId}`;

export function readSaved(userId: number): Partial<Record<Section, unknown>> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null');
    if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== VERSION) return {};
    const { now, period } = v as { now?: unknown; period?: unknown };
    return { now, period };
  } catch {
    return {};
  }
}

export function saveLayouts(userId: number, layouts: Partial<Record<Section, unknown>>) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify({ v: VERSION, ...layouts }));
  } catch {
    /* storage unavailable: the layout lasts until the page is left */
  }
}

export function clearSaved(userId: number) {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* nothing saved */
  }
}
