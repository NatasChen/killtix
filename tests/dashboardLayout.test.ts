import { describe, expect, it } from 'vitest';
import { COLS, defaultLayouts, limitsOf, restoreLayouts, toStored, type Widget } from '../src/web/dashboardLayout';

/** The saved dashboard layout comes from browser storage, so anything in it must end up as a valid layout. */
const NOW: Widget[] = [
  { id: 'open', kind: 'kpi' },
  { id: 'older', kind: 'kpi' },
  { id: 'breached', kind: 'kpi' },
  { id: 'at_risk', kind: 'kpi' },
  { id: 'failed', kind: 'kpi' },
  { id: 'aging', kind: 'chart' },
  { id: 'priority', kind: 'chart' },
];

describe('dashboard layout', () => {
  it('lays the default KPI row across the full width and keeps every card inside the grid', () => {
    const layouts = defaultLayouts(NOW, 'now');
    const kpis = layouts.lg.filter((it) => NOW.find((w) => w.id === it.i)?.kind === 'kpi');
    expect(kpis.reduce((sum, it) => sum + it.w, 0)).toBe(COLS.lg);
    expect(new Set(kpis.map((it) => it.y)).size).toBe(1);
    for (const [bp, items] of Object.entries(layouts)) {
      for (const it of items) expect(it.x + it.w, `${it.i} at ${bp}`).toBeLessThanOrEqual(COLS[bp as keyof typeof COLS]);
    }
  });

  it.each([null, 'x', 42, [], { lg: 'nope' }])('falls back to the default for unusable data (%j)', (raw) => {
    expect(restoreLayouts(raw, NOW, 'now')).toEqual(defaultLayouts(NOW, 'now'));
  });

  it('drops unknown and repeated cards and clamps sizes and positions to the limits', () => {
    const raw = {
      lg: [
        { i: 'aging', x: 20, y: -5, w: 99, h: 1 },
        { i: 'aging', x: 0, y: 0, w: 6, h: 6 },
        { i: 'gone', x: 0, y: 0, w: 4, h: 4 },
        { i: 'open', x: 2.4, y: 3, w: 'wide', h: 3 },
        { i: '__proto__', x: 0, y: 0, w: 4, h: 4 },
      ],
    };
    const lg = restoreLayouts(raw, NOW, 'now').lg;
    const aging = lg.find((it) => it.i === 'aging')!;
    const lim = limitsOf('chart', 'lg');
    expect(aging).toMatchObject({ x: 0, y: 0, w: lim.maxW, h: lim.minH, minW: lim.minW });
    expect(lg.filter((it) => it.i === 'aging')).toHaveLength(1);
    expect(lg.map((it) => it.i).sort()).toEqual(NOW.map((w) => w.id).sort());
  });

  it('keeps saved cards where they were and adds cards that were not saved below them', () => {
    const raw = { lg: [{ i: 'aging', x: 0, y: 0, w: 12, h: 8 }] };
    const lg = restoreLayouts(raw, NOW, 'now').lg;
    expect(lg[0]).toMatchObject({ i: 'aging', x: 0, y: 0, w: 12, h: 8 });
    for (const it of lg.slice(1)) expect(it.y).toBeGreaterThanOrEqual(8);
  });

  it('stores positions and sizes only', () => {
    const stored = toStored(defaultLayouts(NOW, 'now'));
    expect(Object.keys(stored.lg[0]).sort()).toEqual(['h', 'i', 'w', 'x', 'y']);
  });
});
