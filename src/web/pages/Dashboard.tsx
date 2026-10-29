import { DragOutlined, HolderOutlined } from '@ant-design/icons';
import { Alert, Button, Card, DatePicker, Flex, Progress, Statistic } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { Responsive, useContainerWidth, type ResponsiveLayouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { Bars, Columns, Donut, LineChart, TagCloud, type TrendPoint } from '../components/charts';
import { ErrorBanner, Loading, PageHeader, useLoad, usePalette } from '../components/common';
import {
  BREAKPOINTS,
  COLS,
  MARGIN,
  ROW_HEIGHT,
  clearSaved,
  readSaved,
  restoreLayouts,
  saveLayouts,
  toStored,
  type Section,
  type WidgetKind,
} from '../dashboardLayout';
import { useI18n } from '../i18n';
import { PRIORITY_TONE, ROTATION, STATUS_TONE, tone, type Tone } from '../palette';

interface Dashboard {
  range: { from: string; to: string; days: number; unit: 'day' | 'week' };
  openCount: number;
  newInRange: number;
  resolvedInRange: number;
  olderThan3Days: number;
  slaBreached: number;
  slaAtRisk: number;
  slaMetRate: number | null;
  byStatus: { key: string; n: number }[];
  byPriority: { key: number; n: number }[];
  topTags: { key: string; n: number }[];
  topHelpTopics: { key: string; n: number }[];
  failedNotifications: number | null;
  trend: TrendPoint[];
  agingBuckets: { key: '0-1' | '1-3' | '3-7' | '7-14' | '14+'; n: number }[];
  workload: { assigneeId: number | null; name: string | null; n: number }[] | null;
  byTeam: { teamId: number | null; name: string | null; n: number }[] | null;
}

type Kpi = { id: string; label: string; value: string | number; tone: Tone; to?: string; alert?: boolean };

/** Aging buckets above 3 days use warning colours; they all open the "older than 3 days" list. */
const AGING_TONE: Record<string, Tone> = { '0-1': 'sky', '1-3': 'teal', '3-7': 'amber', '7-14': 'orange', '14+': 'red' };
const OVER_3_DAYS = new Set(['3-7', '7-14', '14+']);
/** Same limit as the server (DASHBOARD_MAX_DAYS). */
const MAX_DAYS = 366;
const DATE = 'YYYY-MM-DD';

// Every card is a grid cell (react-grid-layout) that fills its cell; .widget is also the CSS container its
// content adapts to (styles.css): small cards drop secondary parts such as legends and bar tracks.
function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="widget" title={<h3 style={{ fontSize: 16, margin: 0 }}>{title}</h3>}>
      {children}
    </Card>
  );
}

const sectionTitle = (text: string) => <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>{text}</h2>;

/** A KPI card; a colour band codes each one. */
function KpiCard({ kpi: k }: { kpi: Kpi }) {
  const p = usePalette();
  return (
    <Card className="kpi widget" style={{ boxShadow: `inset 0 4px 0 ${tone(p, k.tone).solid}` }}>
      <Statistic
        title={k.label}
        value={k.value}
        styles={{ content: { fontWeight: 650, color: k.alert ? p.danger : undefined } }}
        formatter={(v) => (k.to ? <Link to={k.to} style={{ color: 'inherit' }}>{v}</Link> : v)}
      />
    </Card>
  );
}

type Cell = { id: string; kind: WidgetKind; h?: number; node: ReactNode };

/**
 * One dashboard section as a responsive grid. The breakpoints follow the grid's own width (the page column), so
 * collapsing the sidebar or resizing the window re-flows the cards. Cards move and resize only in edit mode:
 * moving by the handle in the corner, so links and chart drill-downs in the cards keep working.
 */
function DashboardGrid({ section, cells, saved, editing, onChange }: {
  section: Section;
  cells: Cell[];
  saved: unknown;
  editing: boolean;
  onChange: (section: Section, layouts: ResponsiveLayouts) => void;
}) {
  const { t } = useI18n();
  const p = usePalette();
  // lay out only once the real width is known: starting at the default 1280px would animate every card into place
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const layouts = restoreLayouts(saved, cells, section);
  const colours = { '--grid-accent': p.accent, '--grid-handle-bg': p.surface2 } as CSSProperties;
  return (
    <div ref={containerRef} className={editing ? 'dash-grid editing' : 'dash-grid'} style={colours}>
      {mounted && (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={ROW_HEIGHT}
          margin={MARGIN}
          containerPadding={[0, 0]}
          dragConfig={{ enabled: editing, handle: '.widget-handle' }}
          resizeConfig={{ enabled: editing }}
          // only changes made in edit mode are saved (the grid also reports its own compaction on mount)
          onLayoutChange={(_, all) => editing && onChange(section, all)}>
          {cells.map((c) => (
            <div key={c.id} data-widget={c.id}>
              {editing && (
                <span className="widget-handle" title={t('ui.dashboard.layout_move')}>
                  <HolderOutlined aria-hidden />
                </span>
              )}
              {c.node}
            </div>
          ))}
        </Responsive>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const p = usePalette();
  const userId = useAuth().user?.id ?? 0;
  const [params, setParams] = useSearchParams();
  // the saved layout as read from storage; DashboardGrid checks it against the cards on screen
  const [saved, setSaved] = useState(() => readSaved(userId));
  const [editing, setEditing] = useState(false);
  // only from/to reach the API; without them the server uses the last 30 days
  const period = new URLSearchParams([...params].filter(([k]) => k === 'from' || k === 'to')).toString();
  const { data, error, loading } = useLoad(() => get<Dashboard>(`/dashboard${period ? `?${period}` : ''}`), [period]);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const changeLayout = (section: Section, layouts: ResponsiveLayouts) => {
    const next = { ...saved, [section]: toStored(layouts) };
    setSaved(next);
    saveLayouts(userId, next);
  };
  const resetLayout = () => {
    clearSaved(userId);
    setSaved({});
  };

  const { from, to, unit } = data.range;
  const inRange = `createdFrom=${from}&createdTo=${to}`;
  const setRange = (range: [Dayjs, Dayjs]) => setParams({ from: range[0].format(DATE), to: range[1].format(DATE) });
  const today = dayjs();
  const presets: { label: string; value: [Dayjs, Dayjs] }[] = [
    { label: t('ui.dashboard.preset_today'), value: [today, today] },
    { label: t('ui.dashboard.preset_7d'), value: [today.subtract(6, 'day'), today] },
    { label: t('ui.dashboard.preset_30d'), value: [today.subtract(29, 'day'), today] },
    { label: t('ui.dashboard.preset_90d'), value: [today.subtract(89, 'day'), today] },
    { label: t('ui.dashboard.preset_month'), value: [today.startOf('month'), today] },
    { label: t('ui.dashboard.preset_year'), value: [today.startOf('year'), today] },
  ];

  const now: Kpi[] = [
    { id: 'open', label: t('ui.dashboard.open'), value: data.openCount, tone: 'blue', to: '/tickets?status=new,open,pending_user' },
    { id: 'older', label: t('ui.dashboard.older_than_3_days'), value: data.olderThan3Days, tone: 'orange', to: '/tickets?olderThanDays=3', alert: data.olderThan3Days > 0 },
    { id: 'breached', label: t('ui.dashboard.sla_breached'), value: data.slaBreached, tone: 'red', to: '/tickets?slaStatus=breached&status=new,open,pending_user', alert: data.slaBreached > 0 },
    { id: 'at_risk', label: t('ui.dashboard.sla_at_risk'), value: data.slaAtRisk, tone: 'amber', to: '/tickets?slaStatus=at_risk' },
  ];
  if (data.failedNotifications != null) {
    now.push({ id: 'failed', label: t('ui.dashboard.failed_notifications'), value: data.failedNotifications, tone: 'pink', alert: data.failedNotifications > 0 });
  }
  const rate = data.slaMetRate;
  const periodKpis: Kpi[] = [
    { id: 'new', label: t('ui.dashboard.new_in_range'), value: data.newInRange, tone: 'sky', to: `/tickets?${inRange}` },
    { id: 'resolved', label: t('ui.dashboard.resolved_in_range'), value: data.resolvedInRange, tone: 'green' },
    { id: 'rate', label: t('ui.dashboard.sla_met_rate'), value: rate == null ? '—' : `${rate}%`, tone: 'teal' },
  ];

  const trendTitle = t('ui.dashboard.trend');
  const agingTitle = t('ui.dashboard.aging');
  const slaTitle = t('ui.dashboard.sla_met_rate');
  const noTeam = t('ui.dashboard.no_team');

  const kpiCells = (kpis: Kpi[]): Cell[] => kpis.map((k) => ({ id: k.id, kind: 'kpi', node: <KpiCard kpi={k} /> }));
  const nowCells: Cell[] = [
    ...kpiCells(now),
    {
      id: 'aging',
      kind: 'chart',
      h: 9,
      node: (
        <ChartCard title={agingTitle}>
          <Columns
            title={agingTitle}
            data={data.agingBuckets.map((r) => ({
              key: r.key,
              label: t('ui.dashboard.aging_range', { range: r.key }),
              n: r.n,
              tone: AGING_TONE[r.key],
              to: OVER_3_DAYS.has(r.key) ? '/tickets?olderThanDays=3' : undefined,
            }))}
          />
        </ChartCard>
      ),
    },
    {
      id: 'priority',
      kind: 'chart',
      h: 6,
      node: (
        <ChartCard title={t('ui.dashboard.by_priority')}>
          <Bars
            title={t('ui.dashboard.by_priority')}
            rows={[...data.byPriority].sort((a, b) => b.key - a.key)}
            label={(k) => t(`ticket.priority.${k}`)}
            tone={(k) => PRIORITY_TONE[Number(k)]}
            to={(k) => `/tickets?priority=${k}`}
          />
        </ChartCard>
      ),
    },
  ];
  if (data.workload) {
    const workload = data.workload;
    nowCells.push({
      id: 'workload',
      kind: 'chart',
      h: 6,
      node: (
        <ChartCard title={t('ui.dashboard.workload')}>
          <Bars
            title={t('ui.dashboard.workload')}
            rows={workload.map((r) => ({ key: r.assigneeId ?? 'none', n: r.n }))}
            label={(k) => (k === 'none' ? t('ui.tickets.unassigned') : (workload.find((r) => r.assigneeId === k)?.name ?? String(k)))}
            tone={(k, i) => (k === 'none' ? 'grey' : ROTATION[i % ROTATION.length])}
            to={(k) => `/tickets?assignee=${k}`}
          />
        </ChartCard>
      ),
    });
  }
  if (data.byTeam) {
    const byTeam = data.byTeam;
    nowCells.push({
      id: 'team',
      kind: 'chart',
      h: 6,
      node: (
        <ChartCard title={t('ui.dashboard.by_team')}>
          <Bars
            title={t('ui.dashboard.by_team')}
            rows={byTeam.map((r) => ({ key: r.teamId ?? 'none', n: r.n }))}
            label={(k) => (k === 'none' ? noTeam : (byTeam.find((r) => r.teamId === k)?.name ?? String(k)))}
            tone={(k, i) => (k === 'none' ? 'grey' : ROTATION[(i + 1) % ROTATION.length])}
            to={(k) => (k === 'none' ? undefined : `/tickets?teamId=${k}`)}
          />
        </ChartCard>
      ),
    });
  }
  const periodCells: Cell[] = [
    ...kpiCells(periodKpis),
    {
      id: 'trend',
      kind: 'wide',
      node: (
        <ChartCard title={trendTitle}>
          <LineChart
            title={trendTitle}
            points={data.trend}
            createdLabel={t('ui.dashboard.created')}
            resolvedLabel={t('ui.dashboard.resolved')}
            tip={(d) => t(unit === 'week' ? 'ui.dashboard.trend_tip_week' : 'ui.dashboard.trend_tip', { date: d.date, created: d.created, resolved: d.resolved })}
            fill
          />
        </ChartCard>
      ),
    },
    {
      id: 'status',
      kind: 'chart',
      node: (
        <ChartCard title={t('ui.dashboard.by_status')}>
          <Donut
            title={t('ui.dashboard.by_status')}
            data={data.byStatus.map((r) => ({
              key: r.key,
              label: t(`ticket.status.${r.key}`),
              n: r.n,
              tone: STATUS_TONE[r.key] ?? 'grey',
              to: `/tickets?status=${r.key}&${inRange}`,
            }))}
          />
        </ChartCard>
      ),
    },
    {
      id: 'sla',
      kind: 'chart',
      node: (
        <ChartCard title={slaTitle}>
          <div style={{ textAlign: 'center' }}>
            <Progress
              type="dashboard"
              percent={rate ?? 0}
              strokeColor={tone(p, 'teal').solid}
              railColor={p.surface2}
              format={() => (rate == null ? '—' : `${rate}%`)}
              aria-label={`${slaTitle}: ${rate == null ? '—' : `${rate}%`}`}
            />
            {rate == null && <p className="muted small">{t('ui.dashboard.sla_no_data')}</p>}
          </div>
        </ChartCard>
      ),
    },
    {
      id: 'tags',
      kind: 'chart',
      node: (
        <ChartCard title={t('ui.dashboard.top_tags')}>
          <TagCloud title={t('ui.dashboard.top_tags')} data={data.topTags.map((r) => ({ ...r, to: `/tickets?tags=${encodeURIComponent(r.key)}&${inRange}` }))} />
        </ChartCard>
      ),
    },
    {
      id: 'topics',
      kind: 'chart',
      node: (
        <ChartCard title={t('ui.dashboard.top_help_topics')}>
          <Bars
            title={t('ui.dashboard.top_help_topics')}
            rows={data.topHelpTopics}
            label={(k) => String(k)}
            tone={(_, i) => ROTATION[(i + 2) % ROTATION.length]}
          />
        </ChartCard>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('ui.nav.dashboard')}
        extra={
          <>
            {editing && <Button onClick={resetLayout}>{t('ui.dashboard.layout_reset')}</Button>}
            <Button type={editing ? 'primary' : 'default'} icon={<DragOutlined />} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {t(editing ? 'ui.dashboard.layout_done' : 'ui.dashboard.layout_edit')}
            </Button>
          </>
        }
      />
      {error ? <ErrorBanner error={error} /> : null}
      {editing && <Alert type="info" showIcon title={t('ui.dashboard.layout_hint')} style={{ marginBottom: 8 }} />}

      {sectionTitle(t('ui.dashboard.now'))}
      <DashboardGrid section="now" cells={nowCells} saved={saved.now} editing={editing} onChange={changeLayout} />

      <Flex justify="space-between" align="flex-end" gap={12} wrap>
        {sectionTitle(t('ui.dashboard.period', { from, to }))}
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="dashboard-range" className="muted small" style={{ display: 'block', marginBottom: 4 }}>
            {t('ui.dashboard.range')}
          </label>
          <DatePicker.RangePicker
            id="dashboard-range"
            value={[dayjs(from), dayjs(to)]}
            format={DATE}
            allowClear={false}
            presets={presets}
            // no future days, and at most MAX_DAYS between the two ends while picking
            disabledDate={(day, info) => day.isAfter(today, 'day') || (!!info?.from && Math.abs(day.diff(info.from, 'day')) >= MAX_DAYS)}
            onChange={(range) => range?.[0] && range[1] && setRange([range[0], range[1]])}
          />
        </div>
      </Flex>
      <p className="muted small" style={{ marginTop: 0 }}>
        {t('ui.dashboard.range_hint')}
      </p>
      <DashboardGrid section="period" cells={periodCells} saved={saved.period} editing={editing} onChange={changeLayout} />
    </>
  );
}
