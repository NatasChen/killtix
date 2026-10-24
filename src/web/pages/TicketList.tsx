import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { DateTime, Empty, ErrorBanner, Loading, PriorityBadge, SlaBadge, StatusBadge, Tags, useLoad } from '../components/common';
import { useI18n } from '../i18n';

export interface TicketRow {
  id: number;
  number: string;
  subject: string;
  status: string;
  priority: number;
  sla: { status: string; resolutionDueAt: string | null; paused: boolean };
  ageHours: number;
  createdAt: string;
  updatedAt: string;
  requester: { displayName: string; email: string } | null;
  assignee: { displayName: string } | null;
  helpTopic: string | null;
  team: string | null;
  tags: string[];
}

const UNRESOLVED = 'new,open,pending_user';
const FILTER_KEYS = ['q', 'status', 'priority', 'assignee', 'olderThanDays', 'tags', 'tagsMode', 'slaStatus', 'sort'];

export function TicketListPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const { data, error, loading } = useLoad(
    () => get<{ items: TicketRow[]; total: number; page: number; perPage: number }>(`/tickets?${query}`),
    [query],
  );
  const catalog = useLoad(() => get<{ filterableFields?: { key: string; label: string; form: string }[] }>('/catalog'), []);
  const [draft, setDraft] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])));
  const cfEntry = [...params.entries()].find(([k]) => k.startsWith('cf.') || k.startsWith('cfc.'));
  const [cfKey, setCfKey] = useState(cfEntry?.[0] ?? '');
  const [cfValue, setCfValue] = useState(cfEntry?.[1] ?? '');

  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    if (cfKey && cfValue) next.set(cfKey, cfValue);
    setParams(next);
  };
  const page = data?.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const goPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  const exportParams = new URLSearchParams(params);
  exportParams.delete('page');

  return (
    <>
      <div className="topline">
        <h1>{t('ui.nav.tickets')}</h1>
        <div className="actions">
          {can('report:export') && (
            <a className="button" href={`/api/v1/reports/tickets.csv?${exportParams}`}>
              {t('ui.tickets.export_csv')}
            </a>
          )}
          {can('ticket:create') && (
            <Link className="button primary" to="/tickets/new">
              {t('ui.nav.new_ticket')}
            </Link>
          )}
        </div>
      </div>

      <form className="card filters" onSubmit={apply}>
        <label>
          {t('ui.tickets.search')}
          <input value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder={t('ui.tickets.search_placeholder')} />
        </label>
        <label>
          {t('ui.tickets.status')}
          <select value={draft.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('ui.common.all')}</option>
            <option value={UNRESOLVED}>{t('ui.tickets.unresolved')}</option>
            {['new', 'open', 'pending_user', 'resolved', 'closed'].map((s) => (
              <option key={s} value={s}>
                {t(`ticket.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.tickets.priority')}
          <select value={draft.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">{t('ui.common.all')}</option>
            {[5, 4, 3, 2, 1].map((p) => (
              <option key={p} value={p}>
                {t(`ticket.priority.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.tickets.assignee')}
          <select value={draft.assignee} onChange={(e) => set('assignee', e.target.value)}>
            <option value="">{t('ui.common.all')}</option>
            <option value="me">{t('ui.tickets.assigned_to_me')}</option>
            <option value="none">{t('ui.tickets.unassigned')}</option>
          </select>
        </label>
        <label>
          {t('ui.tickets.sla')}
          <select value={draft.slaStatus} onChange={(e) => set('slaStatus', e.target.value)}>
            <option value="">{t('ui.common.all')}</option>
            {['on_track', 'at_risk', 'breached', 'met'].map((s) => (
              <option key={s} value={s}>
                {t(`ticket.sla.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.tickets.tags')}
          <input value={draft.tags} onChange={(e) => set('tags', e.target.value)} placeholder="edr,ransomware" />
        </label>
        <label>
          {t('ui.tickets.tags_mode')}
          <select value={draft.tagsMode} onChange={(e) => set('tagsMode', e.target.value)}>
            <option value="any">{t('ui.tickets.tags_any')}</option>
            <option value="all">{t('ui.tickets.tags_all')}</option>
          </select>
        </label>
        {catalog.data?.filterableFields && catalog.data.filterableFields.length > 0 && (
          <>
            <label>
              {t('ui.tickets.custom_field')}
              <select value={cfKey} onChange={(e) => setCfKey(e.target.value)}>
                <option value="">—</option>
                {catalog.data.filterableFields.map((f) => (
                  <option key={f.key} value={`cf.${f.key}`}>
                    {f.label} ({f.form})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('ui.tickets.custom_field_value')}
              <input value={cfValue} onChange={(e) => setCfValue(e.target.value)} />
            </label>
          </>
        )}
        <label className="inline">
          <input type="checkbox" checked={draft.olderThanDays === '3'} onChange={(e) => set('olderThanDays', e.target.checked ? '3' : '')} />
          {t('ui.tickets.older_than_3_days')}
        </label>
        <div className="actions">
          <button className="primary">{t('ui.common.apply')}</button>
          <button
            type="button"
            onClick={() => {
              setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
              setCfKey('');
              setCfValue('');
              setParams(new URLSearchParams());
            }}
          >
            {t('ui.common.reset')}
          </button>
        </div>
      </form>

      <div className="card">
        <ErrorBanner error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ui.tickets.number')}</th>
                  <th>{t('ui.tickets.subject')}</th>
                  <th>{t('ui.tickets.status')}</th>
                  <th>{t('ui.tickets.priority')}</th>
                  <th>{t('ui.tickets.sla')}</th>
                  <th>{t('ui.tickets.requester')}</th>
                  <th>{t('ui.tickets.assignee')}</th>
                  <th>{t('ui.tickets.age')}</th>
                  <th>{t('ui.tickets.created')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className="mono nowrap">
                      <Link to={`/tickets/${row.number}`}>{row.number}</Link>
                    </td>
                    <td className="grow">
                      <Link to={`/tickets/${row.number}`}>{row.subject}</Link>
                      <div>
                        <Tags tags={row.tags} />
                      </div>
                    </td>
                    <td className="nowrap">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="nowrap">
                      <PriorityBadge priority={row.priority} />
                    </td>
                    <td className="nowrap">
                      <SlaBadge status={row.sla.status} paused={row.sla.paused} />
                    </td>
                    <td>{row.requester?.displayName ?? '—'}</td>
                    <td className="nowrap">{row.assignee?.displayName ?? <span className="muted">{t('ui.tickets.unassigned')}</span>}</td>
                    <td className="num nowrap">{t('ui.tickets.age_value', { days: Math.floor(row.ageHours / 24), hours: row.ageHours % 24 })}</td>
                    <td>
                      <DateTime value={row.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="pager">
            <span className="muted small">{t('ui.common.total', { n: data.total })}</span>
            <button disabled={page <= 1} onClick={() => goPage(page - 1)}>
              ‹
            </button>
            <span className="small">
              {page} / {pages}
            </span>
            <button disabled={page >= pages} onClick={() => goPage(page + 1)}>
              ›
            </button>
          </div>
        )}
      </div>
    </>
  );
}
