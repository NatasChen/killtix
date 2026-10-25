import { Card, Col, Progress, Row, Statistic } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../api';
import { Bars, Columns, Donut, LineChart, TagCloud, type TrendPoint } from '../components/charts';
import { ErrorBanner, Loading, PageHeader, useLoad, usePalette } from '../components/common';
import { useI18n } from '../i18n';
import { PRIORITY_TONE, ROTATION, STATUS_TONE, tone, type Tone } from '../palette';

interface Dashboard {
  openCount: number;
  newToday: number;
  resolvedToday: number;
  olderThan3Days: number;
  slaBreached: number;
  slaAtRisk: number;
  slaMetRate30d: number | null;
  byStatus: { key: string; n: number }[];
  byPriority: { key: number; n: number }[];
  topTags: { key: string; n: number }[];
  topHelpTopics: { key: string; n: number }[];
  failedNotifications: number | null;
  trend30d: TrendPoint[];
  agingBuckets: { key: '0-1' | '1-3' | '3-7' | '7-14' | '14+'; n: number }[];
  workload: { assigneeId: number | null; name: string | null; n: number }[] | null;
  byTeam: { teamId: number | null; name: string | null; n: number }[] | null;
}

/** Aging buckets above 3 days use warning colours; they all open the "older than 3 days" list. */
const AGING_TONE: Record<string, Tone> = { '0-1': 'sky', '1-3': 'teal', '3-7': 'amber', '7-14': 'orange', '14+': 'red' };
const OVER_3_DAYS = new Set(['3-7', '7-14', '14+']);

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{title}</h2>}>{children}</Card>;
}

export function DashboardPage() {
  const { t } = useI18n();
  const p = usePalette();
  const { data, error, loading } = useLoad(() => get<Dashboard>('/dashboard'), []);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const kpis: { label: string; value: string | number; tone: Tone; to?: string; alert?: boolean }[] = [
    { label: t('ui.dashboard.open'), value: data.openCount, tone: 'blue', to: '/tickets?status=new,open,pending_user' },
    { label: t('ui.dashboard.new_today'), value: data.newToday, tone: 'sky' },
    { label: t('ui.dashboard.resolved_today'), value: data.resolvedToday, tone: 'green' },
    { label: t('ui.dashboard.older_than_3_days'), value: data.olderThan3Days, tone: 'orange', to: '/tickets?olderThanDays=3', alert: data.olderThan3Days > 0 },
    { label: t('ui.dashboard.sla_breached'), value: data.slaBreached, tone: 'red', to: '/tickets?slaStatus=breached&status=new,open,pending_user', alert: data.slaBreached > 0 },
    { label: t('ui.dashboard.sla_at_risk'), value: data.slaAtRisk, tone: 'amber', to: '/tickets?slaStatus=at_risk' },
    { label: t('ui.dashboard.sla_met_rate'), value: data.slaMetRate30d == null ? '—' : `${data.slaMetRate30d}%`, tone: 'teal' },
  ];
  if (data.failedNotifications != null) {
    kpis.push({ label: t('ui.dashboard.failed_notifications'), value: data.failedNotifications, tone: 'pink', alert: data.failedNotifications > 0 });
  }

  const trendTitle = t('ui.dashboard.trend30d');
  const agingTitle = t('ui.dashboard.aging');
  const slaTitle = t('ui.dashboard.sla_met_rate');
  const rate = data.slaMetRate30d;
  const noTeam = t('ui.dashboard.no_team');

  return (
    <>
      <PageHeader title={t('ui.nav.dashboard')} />
      {/* four KPI cards per row on wide screens so 7 or 8 cards fill whole rows; a colour band codes each one */}
      <Row gutter={[16, 16]}>
        {kpis.map((k) => (
          <Col key={k.label} xs={12} lg={6}>
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

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <ChartCard title={trendTitle}>
            <LineChart
              title={trendTitle}
              points={data.trend30d}
              createdLabel={t('ui.dashboard.created')}
              resolvedLabel={t('ui.dashboard.resolved')}
              tip={(d) => t('ui.dashboard.trend_tip', { date: d.date, created: d.created, resolved: d.resolved })}
            />
          </ChartCard>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <ChartCard title={t('ui.dashboard.by_status')}>
            <Donut
              title={t('ui.dashboard.by_status')}
              data={data.byStatus.map((r) => ({
                key: r.key,
                label: t(`ticket.status.${r.key}`),
                n: r.n,
                tone: STATUS_TONE[r.key] ?? 'grey',
                to: `/tickets?status=${r.key}`,
              }))}
            />
          </ChartCard>
        </Col>
        <Col xs={24} lg={8}>
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
        <Col xs={24} lg={8}>
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
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
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
        <Col xs={24} lg={8}>
          <ChartCard title={t('ui.dashboard.top_tags')}>
            <TagCloud title={t('ui.dashboard.top_tags')} data={data.topTags.map((r) => ({ ...r, to: `/tickets?tags=${encodeURIComponent(r.key)}` }))} />
          </ChartCard>
        </Col>
        <Col xs={24} lg={8}>
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

      {(data.workload || data.byTeam) && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
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
      )}
    </>
  );
}
