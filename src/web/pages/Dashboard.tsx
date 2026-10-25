import { Card, Col, Progress, Row, Statistic } from 'antd';
import { Link } from 'react-router-dom';
import { get } from '../api';
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
}

function Bars({ rows, label, tone: toneOf }: {
  rows: { key: string | number; n: number }[];
  label: (k: string | number) => string;
  tone: (k: string | number, i: number) => Tone | undefined;
}) {
  const { t } = useI18n();
  const p = usePalette();
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.key} className="bar-row">
          <span>{label(r.key)}</span>
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
      ))}
    </div>
  );
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
  const charts = [
    { title: t('ui.dashboard.by_status'), node: <Bars rows={data.byStatus} label={(k) => t(`ticket.status.${k}`)} tone={(k) => STATUS_TONE[k]} /> },
    {
      title: t('ui.dashboard.by_priority'),
      node: <Bars rows={[...data.byPriority].sort((a, b) => b.key - a.key)} label={(k) => t(`ticket.priority.${k}`)} tone={(k) => PRIORITY_TONE[Number(k)]} />,
    },
    { title: t('ui.dashboard.top_tags'), node: <Bars rows={data.topTags} label={(k) => String(k)} tone={(_, i) => ROTATION[i % ROTATION.length]} /> },
    { title: t('ui.dashboard.top_help_topics'), node: <Bars rows={data.topHelpTopics} label={(k) => String(k)} tone={(_, i) => ROTATION[(i + 2) % ROTATION.length]} /> },
  ];

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
        {charts.map((c) => (
          <Col key={c.title} xs={24} lg={12}>
            <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{c.title}</h2>}>{c.node}</Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
