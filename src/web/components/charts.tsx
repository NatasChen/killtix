import { Progress, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { ROTATION, tone, type Tone } from '../palette';
import { usePalette } from './common';

/* SVG charts for the dashboard (PRD FR-3.5). No chart library: colours come only from palette.ts
   (usePalette(), tone()), every SVG scales with its viewBox and carries role="img" plus an aria-label that
   lists the numbers; the same numbers are also printed as text in a legend list. Clickable items are real
   links (keyboard: Tab + Enter); the shapes only repeat the click for mouse users. */

export interface Datum {
  key: string | number;
  label: string;
  n: number;
  tone: Tone;
  /** where a click goes (the ticket list with a filter); no link when undefined */
  to?: string;
}

const describe = (title: string, data: Datum[]) => `${title}: ${data.map((d) => `${d.label} ${d.n}`).join(', ')}`;

function Legend({ title, data }: { title: string; data: Datum[] }) {
  const p = usePalette();
  return (
    <ul className="chart-legend" aria-label={title}>
      {data.map((d) => (
        <li key={d.key}>
          <span className="swatch" aria-hidden style={{ background: tone(p, d.tone).solid }} />
          {d.to ? <Link to={d.to}>{d.label}</Link> : <span>{d.label}</span>}
          <span className="num muted">{d.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** Ring chart: the total in the middle, a legend (name + number) beside it. */
export function Donut({ title, data }: { title: string; data: Datum[] }) {
  const { t } = useI18n();
  const p = usePalette();
  const navigate = useNavigate();
  const total = data.reduce((sum, d) => sum + d.n, 0);
  if (!data.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg className="chart-svg" style={{ maxWidth: 150 }} viewBox="0 0 120 120" role="img" aria-label={describe(title, data)}>
        <circle cx="60" cy="60" r={R} fill="none" stroke={p.surface2} strokeWidth="16" />
        {data
          .filter((d) => d.n > 0)
          .map((d) => {
            const len = (d.n / total) * C;
            const circle = (
              <circle
                key={d.key}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={tone(p, d.tone).solid}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
                style={d.to ? { cursor: 'pointer' } : undefined}
                onClick={d.to ? () => navigate(d.to!) : undefined}
              />
            );
            offset += len;
            return circle;
          })}
        <text x="60" y="62" textAnchor="middle" fontSize="22" fontWeight="700" fill={p.ink1}>
          {total}
        </text>
        <text x="60" y="78" textAnchor="middle" fontSize="9" fill={p.ink3}>
          {t('ui.dashboard.total')}
        </text>
      </svg>
      <Legend title={title} data={data} />
    </div>
  );
}

/** Vertical bars with the number above each bar and the label below it. */
export function Columns({ title, data }: { title: string; data: Datum[] }) {
  const { t } = useI18n();
  const p = usePalette();
  const navigate = useNavigate();
  if (!data.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  const W = 300;
  const H = 150;
  const top = 18;
  const bottom = 22;
  const plot = H - top - bottom;
  const max = Math.max(1, ...data.map((d) => d.n));
  const band = W / data.length;
  const width = band * 0.6;
  return (
    <div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={describe(title, data)}>
        <line x1="0" x2={W} y1={top + plot} y2={top + plot} stroke={p.hairline} />
        {data.map((d, i) => {
          const h = d.n > 0 ? Math.max(2, (d.n / max) * plot) : 0;
          const cx = band * i + band / 2;
          return (
            <g key={d.key} style={d.to ? { cursor: 'pointer' } : undefined} onClick={d.to ? () => navigate(d.to!) : undefined}>
              <rect x={cx - width / 2} y={top + plot - h} width={width} height={h} rx="3" fill={tone(p, d.tone).solid} />
              <text x={cx} y={top + plot - h - 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={p.ink1}>
                {d.n}
              </text>
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={p.ink3}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend title={title} data={data} />
    </div>
  );
}

export interface TrendPoint {
  date: string;
  created: number;
  resolved: number;
}

/** Two lines (created = solid, resolved = dashed with square markers); hovering or focusing a day shows its numbers. */
export function LineChart({
  title,
  points,
  createdLabel,
  resolvedLabel,
  tip,
}: {
  title: string;
  points: TrendPoint[];
  createdLabel: string;
  resolvedLabel: string;
  tip: (p: TrendPoint) => string;
}) {
  const p = usePalette();
  const W = 480;
  const H = 220;
  const [L, R, T, B] = [34, 10, 12, 26];
  const pw = W - L - R;
  const ph = H - T - B;
  const N = points.length;
  const step = Math.max(1, Math.ceil(Math.max(1, ...points.flatMap((d) => [d.created, d.resolved])) / 4));
  const yMax = step * 4;
  const x = (i: number) => L + (N > 1 ? (pw * i) / (N - 1) : pw / 2);
  const y = (v: number) => T + ph - (ph * v) / yMax;
  const sum = (k: 'created' | 'resolved') => points.reduce((s, d) => s + d[k], 0);
  const createdTone = tone(p, 'blue');
  const resolvedTone = tone(p, 'green');
  const line = (k: 'created' | 'resolved') => points.map((d, i) => `${x(i)},${y(d[k])}`).join(' ');
  const cell = N > 1 ? pw / (N - 1) : pw;
  const label = `${title}: ${createdLabel} ${sum('created')}, ${resolvedLabel} ${sum('resolved')}`;
  return (
    <div>
      <svg className="chart-svg" style={{ maxHeight: 260 }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(i * step)} y2={y(i * step)} stroke={p.hairline} />
            <text x={L - 6} y={y(i * step) + 4} textAnchor="end" fontSize="11" fill={p.ink3}>
              {i * step}
            </text>
          </g>
        ))}
        {points.map((d, i) =>
          (N - 1 - i) % 7 === 0 ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={p.ink3}>
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
        <polyline points={line('created')} fill="none" stroke={createdTone.solid} strokeWidth="2" />
        <polyline points={line('resolved')} fill="none" stroke={resolvedTone.solid} strokeWidth="2" strokeDasharray="5 3" />
        {points.map((d, i) => (
          <g key={d.date} aria-hidden>
            <circle cx={x(i)} cy={y(d.created)} r="2.5" fill={createdTone.solid} />
            <rect x={x(i) - 2.5} y={y(d.resolved) - 2.5} width="5" height="5" fill={resolvedTone.solid} />
          </g>
        ))}
        {points.map((d, i) => (
          <Tooltip key={d.date} title={tip(d)} trigger={['hover', 'focus']}>
            <rect x={x(i) - cell / 2} y={T} width={cell} height={ph} fill="transparent" tabIndex={0} aria-label={tip(d)} />
          </Tooltip>
        ))}
      </svg>
      <ul className="chart-legend inline" aria-label={title}>
        <li>
          <svg width="22" height="10" aria-hidden>
            <line x1="0" x2="22" y1="5" y2="5" stroke={createdTone.solid} strokeWidth="2" />
            <circle cx="11" cy="5" r="2.5" fill={createdTone.solid} />
          </svg>
          <span>{createdLabel}</span>
          <span className="num muted">{sum('created')}</span>
        </li>
        <li>
          <svg width="22" height="10" aria-hidden>
            <line x1="0" x2="22" y1="5" y2="5" stroke={resolvedTone.solid} strokeWidth="2" strokeDasharray="5 3" />
            <rect x="8.5" y="2.5" width="5" height="5" fill={resolvedTone.solid} />
          </svg>
          <span>{resolvedLabel}</span>
          <span className="num muted">{sum('resolved')}</span>
        </li>
      </ul>
    </div>
  );
}

const CLOUD_SIZES = [13, 16, 20, 26];

/** Tags sized by count (4 levels), the sticker hues in turn; each tag is a link. The count is part of the link text. */
export function TagCloud({ title, data }: { title: string; data: { key: string; n: number; to: string }[] }) {
  const { t } = useI18n();
  const p = usePalette();
  if (!data.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  const counts = data.map((d) => d.n);
  const [min, max] = [Math.min(...counts), Math.max(...counts)];
  const level = (n: number) => (max === min ? 1 : Math.min(3, Math.floor(((n - min) / (max - min)) * 4)));
  return (
    // not role="img" (that would hide the links from assistive technology): the group's aria-label lists every tag and count
    <div className="tag-cloud" role="group" aria-label={describe(title, data.map((d) => ({ ...d, label: d.key, tone: 'grey' as Tone })))}>
      {data.map((d, i) => {
        const s = tone(p, ROTATION[i % ROTATION.length]);
        return (
          <Link
            key={d.key}
            to={d.to}
            style={{ fontSize: CLOUD_SIZES[level(d.n)], background: s.soft, color: s.ink, fontWeight: 600, padding: '2px 12px', borderRadius: 9999, lineHeight: 1.5 }}
          >
            {d.key} {d.n}
          </Link>
        );
      })}
    </div>
  );
}

/** Horizontal bars (one row per item, number on the right); rows with `to` link to the ticket list. */
export function Bars({
  title,
  rows,
  label,
  tone: toneOf,
  to,
}: {
  title?: string;
  rows: { key: string | number; n: number }[];
  label: (k: string | number) => string;
  tone: (k: string | number, i: number) => Tone | undefined;
  to?: (k: string | number) => string | undefined;
}) {
  const { t } = useI18n();
  const p = usePalette();
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  return (
    // each row has its own labelled progress bar; the group names the whole chart
    <div role="group" aria-label={title}>
      {rows.map((r, i) => {
        const link = to?.(r.key);
        const name: ReactNode = link ? <Link to={link}>{label(r.key)}</Link> : label(r.key);
        return (
          <div key={r.key} className="bar-row">
            <span>{name}</span>
            <Progress
              percent={(r.n / max) * 100}
              showInfo={false}
              strokeColor={tone(p, toneOf(r.key, i) ?? 'blue').solid}
              railColor={p.surface2}
              size={{ height: 8 }}
              aria-label={`${label(r.key)}: ${r.n}`}
            />
            <span className="num">{r.n}</span>
          </div>
        );
      })}
    </div>
  );
}
