import { Link } from 'react-router-dom';
import { get } from '../api';
import { ErrorBanner, Loading, useLoad } from '../components/common';
import { useI18n } from '../i18n';

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

function Bars({ rows, label }: { rows: { key: string | number; n: number }[]; label: (k: string | number) => string }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="muted small">{t('ui.common.empty')}</p>;
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} className="bar-row">
          <span>{label(r.key)}</span>
          <div className="bar" style={{ width: `${(r.n / max) * 100}%` }} />
          <span className="num">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const { data, error, loading } = useLoad(() => get<Dashboard>('/dashboard'), []);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const kpis: { label: string; value: string | number; to?: string; alert?: boolean }[] = [
    { label: t('ui.dashboard.open'), value: data.openCount, to: '/tickets?status=new,open,pending_user' },
    { label: t('ui.dashboard.new_today'), value: data.newToday },
    { label: t('ui.dashboard.resolved_today'), value: data.resolvedToday },
    { label: t('ui.dashboard.older_than_3_days'), value: data.olderThan3Days, to: '/tickets?olderThanDays=3', alert: data.olderThan3Days > 0 },
    { label: t('ui.dashboard.sla_breached'), value: data.slaBreached, to: '/tickets?slaStatus=breached&status=new,open,pending_user', alert: data.slaBreached > 0 },
    { label: t('ui.dashboard.sla_at_risk'), value: data.slaAtRisk, to: '/tickets?slaStatus=at_risk' },
    { label: t('ui.dashboard.sla_met_rate'), value: data.slaMetRate30d == null ? '—' : `${data.slaMetRate30d}%` },
  ];
  if (data.failedNotifications != null) {
    kpis.push({ label: t('ui.dashboard.failed_notifications'), value: data.failedNotifications, alert: data.failedNotifications > 0 });
  }

  return (
    <>
      <h1>{t('ui.nav.dashboard')}</h1>
      <div className="grid grid-kpi">
        {kpis.map((k) => (
          <div key={k.label} className={`card kpi${k.alert ? ' alert' : ''}`}>
            <span className="label">{k.label}</span>
            <span className="value">{k.to ? <Link to={k.to}>{k.value}</Link> : k.value}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>{t('ui.dashboard.by_status')}</h2>
          <Bars rows={data.byStatus} label={(k) => t(`ticket.status.${k}`)} />
        </div>
        <div className="card">
          <h2>{t('ui.dashboard.by_priority')}</h2>
          <Bars rows={[...data.byPriority].sort((a, b) => b.key - a.key)} label={(k) => t(`ticket.priority.${k}`)} />
        </div>
        <div className="card">
          <h2>{t('ui.dashboard.top_tags')}</h2>
          <Bars rows={data.topTags} label={(k) => String(k)} />
        </div>
        <div className="card">
          <h2>{t('ui.dashboard.top_help_topics')}</h2>
          <Bars rows={data.topHelpTopics} label={(k) => String(k)} />
        </div>
      </div>
    </>
  );
}
