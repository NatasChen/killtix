import { Button, Card, Checkbox, Flex, Form, Input, Pagination, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { Choice, DateTime, ErrorBanner, Field, PageHeader, PriorityBadge, SlaBadge, StatusBadge, Tags, useLoad } from '../components/common';
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
  const navigate = useNavigate();
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
  const apply = () => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    if (cfKey && cfValue) next.set(cfKey, cfValue);
    setParams(next);
  };
  const page = data?.page ?? 1;
  const goPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  const exportParams = new URLSearchParams(params);
  exportParams.delete('page');

  const columns: TableColumnsType<TicketRow> = [
    { key: 'number', title: t('ui.tickets.number'), className: 'mono nowrap', render: (_, row) => <Link to={`/tickets/${row.number}`}>{row.number}</Link> },
    {
      key: 'subject',
      title: t('ui.tickets.subject'),
      className: 'grow',
      render: (_, row) => (
        <>
          <Link to={`/tickets/${row.number}`}>{row.subject}</Link>
          {row.tags.length > 0 && (
            <div>
              <Tags tags={row.tags} />
            </div>
          )}
        </>
      ),
    },
    { key: 'status', title: t('ui.tickets.status'), className: 'nowrap', render: (_, row) => <StatusBadge status={row.status} /> },
    { key: 'priority', title: t('ui.tickets.priority'), className: 'nowrap', render: (_, row) => <PriorityBadge priority={row.priority} /> },
    { key: 'sla', title: t('ui.tickets.sla'), className: 'nowrap', render: (_, row) => <SlaBadge status={row.sla.status} paused={row.sla.paused} /> },
    { key: 'requester', title: t('ui.tickets.requester'), render: (_, row) => row.requester?.displayName ?? '—' },
    {
      key: 'assignee',
      title: t('ui.tickets.assignee'),
      className: 'nowrap',
      render: (_, row) => row.assignee?.displayName ?? <span className="muted">{t('ui.tickets.unassigned')}</span>,
    },
    {
      key: 'age',
      title: t('ui.tickets.age'),
      className: 'num nowrap',
      render: (_, row) => t('ui.tickets.age_value', { days: Math.floor(row.ageHours / 24), hours: row.ageHours % 24 }),
    },
    { key: 'created', title: t('ui.tickets.created'), render: (_, row) => <DateTime value={row.createdAt} /> },
  ];
  const all = t('ui.common.all');
  const filter = { style: { minWidth: 150 } };

  return (
    <>
      <PageHeader
        title={t('ui.nav.tickets')}
        extra={
          <>
            {can('report:export') && <Button href={`/api/v1/reports/tickets.csv?${exportParams}`}>{t('ui.tickets.export_csv')}</Button>}
            {can('ticket:create') && (
              <Button type="primary" onClick={() => navigate('/tickets/new')}>
                {t('ui.nav.new_ticket')}
              </Button>
            )}
          </>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical" onFinish={apply}>
          <Flex wrap gap="0 12px" align="flex-end">
            <div {...filter}>
              <Field label={t('ui.tickets.search')}>
                <Input value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder={t('ui.tickets.search_placeholder')} />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.status')}>
                <Choice
                  value={draft.status}
                  onChange={(v) => set('status', v)}
                  empty={all}
                  options={[
                    { value: UNRESOLVED, label: t('ui.tickets.unresolved') },
                    ...['new', 'open', 'pending_user', 'resolved', 'closed'].map((s) => ({ value: s, label: t(`ticket.status.${s}`) })),
                  ]}
                />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.priority')}>
                <Choice
                  value={draft.priority}
                  onChange={(v) => set('priority', v)}
                  empty={all}
                  options={[5, 4, 3, 2, 1].map((p) => ({ value: String(p), label: t(`ticket.priority.${p}`) }))}
                />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.assignee')}>
                <Choice
                  value={draft.assignee}
                  onChange={(v) => set('assignee', v)}
                  empty={all}
                  options={[
                    { value: 'me', label: t('ui.tickets.assigned_to_me') },
                    { value: 'none', label: t('ui.tickets.unassigned') },
                  ]}
                />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.sla')}>
                <Choice
                  value={draft.slaStatus}
                  onChange={(v) => set('slaStatus', v)}
                  empty={all}
                  options={['on_track', 'at_risk', 'breached', 'met'].map((s) => ({ value: s, label: t(`ticket.sla.${s}`) }))}
                />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.tags')}>
                <Input value={draft.tags} onChange={(e) => set('tags', e.target.value)} placeholder="edr,ransomware" />
              </Field>
            </div>
            <div {...filter}>
              <Field label={t('ui.tickets.tags_mode')}>
                <Choice
                  value={draft.tagsMode || 'any'}
                  onChange={(v) => set('tagsMode', v)}
                  options={[
                    { value: 'any', label: t('ui.tickets.tags_any') },
                    { value: 'all', label: t('ui.tickets.tags_all') },
                  ]}
                />
              </Field>
            </div>
            {catalog.data?.filterableFields && catalog.data.filterableFields.length > 0 && (
              <>
                <div {...filter}>
                  <Field label={t('ui.tickets.custom_field')}>
                    <Choice
                      value={cfKey}
                      onChange={setCfKey}
                      empty="—"
                      options={catalog.data.filterableFields.map((f) => ({ value: `cf.${f.key}`, label: `${f.label} (${f.form})` }))}
                    />
                  </Field>
                </div>
                <div {...filter}>
                  <Field label={t('ui.tickets.custom_field_value')}>
                    <Input value={cfValue} onChange={(e) => setCfValue(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            <Form.Item style={{ marginBottom: 12 }}>
              <Checkbox checked={draft.olderThanDays === '3'} onChange={(e) => set('olderThanDays', e.target.checked ? '3' : '')}>
                {t('ui.tickets.older_than_3_days')}
              </Checkbox>
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
              <Flex gap={8}>
                <Button type="primary" htmlType="submit">
                  {t('ui.common.apply')}
                </Button>
                <Button
                  onClick={() => {
                    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
                    setCfKey('');
                    setCfValue('');
                    setParams(new URLSearchParams());
                  }}
                >
                  {t('ui.common.reset')}
                </Button>
              </Flex>
            </Form.Item>
          </Flex>
        </Form>
      </Card>

      <Card>
        <ErrorBanner error={error} />
        <Table<TicketRow>
          rowKey="id"
          columns={columns}
          dataSource={data?.items ?? []}
          loading={loading && !data}
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
        />
        {data && (
          <Flex justify="flex-end" align="center" gap={12} style={{ marginTop: 12 }}>
            <span className="muted small">{t('ui.common.total', { n: data.total })}</span>
            <Pagination simple current={page} total={data.total} pageSize={data.perPage} onChange={goPage} />
          </Flex>
        )}
      </Card>
    </>
  );
}
