import { Card, Col, DatePicker, Flex, Progress, Row, Statistic } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { Bars, Columns, Donut, LineChart, TagCloud, type TrendPoint } from '../components/charts';
import { ErrorBanner, Loading, PageHeader, useLoad, usePalette } from '../components/common';
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

type Kpi = { label: string; value: string | number; tone: Tone; to?: string; alert?: boolean };

/** Aging buckets above 3 days use warning colours; they all open the "older than 3 days" list. */
const AGING_TONE: Record<string, Tone> = { '0-1': 'sky', '1-3': 'teal', '3-7': 'amber', '7-14': 'orange', '14+': 'red' };
const OVER_3_DAYS = new Set(['3-7', '7-14', '14+']);
/** Same limit as the server (DASHBOARD_MAX_DAYS). */
const MAX_DAYS = 366;
const DATE = 'YYYY-MM-DD';

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={<h3 style={{ fontSize: 16, margin: 0 }}>{title}</h3>}>{children}</Card>;
}

const sectionTitle = (text: string) => <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>{text}</h2>;

/** A row of KPI cards that share the width (4 or 5 current-state cards, 3 period cards); a colour band codes each one. */
function KpiRow({ kpis }: { kpis: Kpi[] }) {
  const p = usePalette();
  return (
    <Row gutter={[16, 16]}>
      {kpis.map((k) => (
        <Col key={k.label} xs={12} lg={{ flex: '1 1 0' }}>
          <Card className="kpi" style={{ boxShadow: `inset 0 4px 0 ${tone(p, k.tone).solid}` }}>
            <Statistic
              title={k.label}
              value={k.value}
              styles={{ content: { fontWeight: 650, color: k.alert ? p.danger : undefined } }}
              formatter={(v) => (k.to ? <Link to={k.to} style={{ color: 'inherit' }}>{v}</Link> : v)}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const p = usePalette();
  const [params, setParams] = useSearchParams();
  // only from/to reach the API; without them the server uses the last 30 days
  const period = new URLSearchParams([...params].filter(([k]) => k === 'from' || k === 'to')).toString();
  const { data, error, loading } = useLoad(() => get<Dashboard>(`/dashboard${period ? `?${period}` : ''}`), [period]);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

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
    { label: t('ui.dashboard.open'), value: data.openCount, tone: 'blue', to: '/tickets?status=new,open,pending_user' },
    { label: t('ui.dashboard.older_than_3_days'), value: data.olderThan3Days, tone: 'orange', to: '/tickets?olderThanDays=3', alert: data.olderThan3Days > 0 },
    { label: t('ui.dashboard.sla_breached'), value: data.slaBreached, tone: 'red', to: '/tickets?slaStatus=breached&status=new,open,pending_user', alert: data.slaBreached > 0 },
    { label: t('ui.dashboard.sla_at_risk'), value: data.slaAtRisk, tone: 'amber', to: '/tickets?slaStatus=at_risk' },
  ];
  if (data.failedNotifications != null) {
    now.push({ label: t('ui.dashboard.failed_notifications'), value: data.failedNotifications, tone: 'pink', alert: data.failedNotifications > 0 });
  }
  const rate = data.slaMetRate;
  const periodKpis: Kpi[] = [
    { label: t('ui.dashboard.new_in_range'), value: data.newInRange, tone: 'sky', to: `/tickets?${inRange}` },
    { label: t('ui.dashboard.resolved_in_range'), value: data.resolvedInRange, tone: 'green' },
    { label: t('ui.dashboard.sla_met_rate'), value: rate == null ? '—' : `${rate}%`, tone: 'teal' },
  ];

  const trendTitle = t('ui.dashboard.trend');
  const agingTitle = t('ui.dashboard.aging');
  const slaTitle = t('ui.dashboard.sla_met_rate');
  const noTeam = t('ui.dashboard.no_team');

  return (
    <>
      <PageHeader title={t('ui.nav.dashboard')} />
      {error ? <ErrorBanner error={error} /> : null}

      {sectionTitle(t('ui.dashboard.now'))}
      <KpiRow kpis={now} />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
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
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('ui.dashboard.by_priority')}>
            <Bars
              title={t('ui.dashboard.by_priority')}
              rows={[...data.byPriority].sort((a, b) => b.key - a.key)}
              label={(k) => t(`ticket.priority.${k}`)}
              tone={(k) => PRIORITY_TONE[Number(k)]}
              to={(k) => `/tickets?priority=${k}`}
            />
          </ChartCard>
        </Col>
        {data.workload && (
          <Col xs={24} lg={12}>
            <ChartCard title={t('ui.dashboard.workload')}>
              <Bars
                title={t('ui.dashboard.workload')}
                rows={data.workload.map((r) => ({ key: r.assigneeId ?? 'none', n: r.n }))}
                label={(k) => (k === 'none' ? t('ui.tickets.unassigned') : (data.workload!.find((r) => r.assigneeId === k)?.name ?? String(k)))}
                tone={(k, i) => (k === 'none' ? 'grey' : ROTATION[i % ROTATION.length])}
                to={(k) => `/tickets?assignee=${k}`}
              />
            </ChartCard>
          </Col>
        )}
        {data.byTeam && (
          <Col xs={24} lg={12}>
            <ChartCard title={t('ui.dashboard.by_team')}>
              <Bars
                title={t('ui.dashboard.by_team')}
                rows={data.byTeam.map((r) => ({ key: r.teamId ?? 'none', n: r.n }))}
                label={(k) => (k === 'none' ? noTeam : (data.byTeam!.find((r) => r.teamId === k)?.name ?? String(k)))}
                tone={(k, i) => (k === 'none' ? 'grey' : ROTATION[(i + 1) % ROTATION.length])}
                to={(k) => (k === 'none' ? undefined : `/tickets?teamId=${k}`)}
              />
            </ChartCard>
          </Col>
        )}
      </Row>

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
      <KpiRow kpis={periodKpis} />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <ChartCard title={trendTitle}>
            <LineChart
              title={trendTitle}
              points={data.trend}
              createdLabel={t('ui.dashboard.created')}
              resolvedLabel={t('ui.dashboard.resolved')}
              tip={(d) => t(unit === 'week' ? 'ui.dashboard.trend_tip_week' : 'ui.dashboard.trend_tip', { date: d.date, created: d.created, resolved: d.resolved })}
            />
          </ChartCard>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12} xl={6}>
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
        </Col>
        <Col xs={24} md={12} xl={6}>
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
        </Col>
        <Col xs={24} md={12} xl={6}>
          <ChartCard title={t('ui.dashboard.top_tags')}>
            <TagCloud title={t('ui.dashboard.top_tags')} data={data.topTags.map((r) => ({ ...r, to: `/tickets?tags=${encodeURIComponent(r.key)}&${inRange}` }))} />
          </ChartCard>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <ChartCard title={t('ui.dashboard.top_help_topics')}>
            <Bars
              title={t('ui.dashboard.top_help_topics')}
              rows={data.topHelpTopics}
              label={(k) => String(k)}
              tone={(_, i) => ROTATION[(i + 2) % ROTATION.length]}
            />
          </ChartCard>
        </Col>
      </Row>
    </>
  );
}
