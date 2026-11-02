import { Button, Card, Flex, Form, Input, Pagination, Progress, Table, Tag, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { useAuth } from '../auth';
import { ActionBadge, AdvisoryStatusBadge, ExposureBadge, SeverityBadge, TodoCheckbox } from '../components/advisory';
import { Choice, DateTime, ErrorBanner, Field, PageHeader, useLoad, usePalette } from '../components/common';
import { useI18n } from '../i18n';

interface Progress {
  total: number;
  responded: number;
  affected: number;
  complete: number;
  overdueResponse: number;
  overdueAction: number;
}
interface AdvisoryRow {
  id: number;
  number: string;
  title: string;
  severity: string;
  status: string;
  cves: string[];
  responseDueAt: string | null;
  createdAt: string;
  progress: Progress;
  myTeams: { teamId: number; team: string; exposure: string; actionStatus: string | null }[];
}

const FILTER_KEYS = ['q', 'status', 'todo'];

/**
 * Threat-intel advisories (DECISIONS D24). HQ sees every advisory with each one's response progress; a team member
 * sees the advisories sent to their teams with their own teams' answers.
 */
export function AdvisoryListPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const p = usePalette();
  const navigate = useNavigate();
  const manage = can('advisory:manage');
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const { data, error, loading } = useLoad(
    () => get<{ items: AdvisoryRow[]; total: number; page: number; perPage: number }>(`/advisories?${query}`),
    [query],
  );
  const [draft, setDraft] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])));
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = () => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(draft)) if (v) next.set(k, v);
    setParams(next);
  };
  const goPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };
  const alert = (n: number) => (n ? <span style={{ color: p.danger, fontWeight: 650 }}>{n}</span> : <span className="muted">0</span>);

  const columns: TableColumnsType<AdvisoryRow> = [
    { key: 'number', title: t('ui.advisory.number'), className: 'mono nowrap', render: (_, r) => <Link to={`/advisories/${r.number}`}>{r.number}</Link> },
    {
      key: 'title',
      title: t('ui.advisory.title'),
      className: 'grow',
      render: (_, r) => (
        <>
          <Link to={`/advisories/${r.number}`}>{r.title}</Link>
          {r.cves.length > 0 && (
            <div>
              {r.cves.slice(0, 4).map((c) => (
                <Tag key={c} className="mono">
                  {c}
                </Tag>
              ))}
              {r.cves.length > 4 && <span className="small muted">+{r.cves.length - 4}</span>}
            </div>
          )}
        </>
      ),
    },
    { key: 'severity', title: t('ui.advisory.severity'), className: 'nowrap', render: (_, r) => <SeverityBadge severity={r.severity} /> },
    { key: 'status', title: t('ui.advisory.status'), className: 'nowrap', render: (_, r) => <AdvisoryStatusBadge status={r.status} /> },
    { key: 'due', title: t('ui.advisory.response_due'), className: 'nowrap', render: (_, r) => <DateTime value={r.responseDueAt} /> },
    ...(manage
      ? ([
          {
            key: 'responded',
            title: t('ui.advisory.responded'),
            className: 'nowrap',
            render: (_, r) =>
              r.status === 'draft' ? (
                <span className="muted">{t('ui.advisory.teams_count', { n: r.progress.total })}</span>
              ) : (
                <Flex vertical gap={0} style={{ minWidth: 120 }}>
                  <span className="small">
                    {r.progress.responded} / {r.progress.total}
                  </span>
                  <Progress
                    percent={r.progress.total ? Math.round((r.progress.responded / r.progress.total) * 100) : 0}
                    showInfo={false}
                    size="small"
                    aria-label={t('ui.advisory.responded')}
                  />
                </Flex>
              ),
          },
          { key: 'affected', title: t('ui.advisory.affected_teams'), className: 'num', render: (_, r) => alert(r.progress.affected) },
          {
            key: 'complete',
            title: t('ui.advisory.complete_teams'),
            className: 'num nowrap',
            render: (_, r) => `${r.progress.complete} / ${r.progress.total}`,
          },
          {
            key: 'overdue',
            title: t('ui.advisory.overdue'),
            className: 'num',
            render: (_, r) => (r.status === 'published' ? alert(r.progress.overdueResponse + r.progress.overdueAction) : <span className="muted">—</span>),
          },
        ] as TableColumnsType<AdvisoryRow>)
      : ([
          {
            key: 'mine',
            title: t('ui.advisory.my_teams'),
            render: (_, r) => (
              <Flex vertical gap={4}>
                {r.myTeams.map((m) => (
                  <Flex key={m.teamId} gap={6} wrap align="center">
                    <span>{m.team}</span>
                    <ExposureBadge exposure={m.exposure} />
                    {m.exposure === 'affected' && <ActionBadge status={m.actionStatus} />}
                  </Flex>
                ))}
              </Flex>
            ),
          },
        ] as TableColumnsType<AdvisoryRow>)),
  ];

  return (
    <>
      <PageHeader
        title={t('ui.nav.advisories')}
        extra={
          manage && (
            <Button type="primary" onClick={() => navigate('/advisories/new')}>
              {t('ui.advisory.new')}
            </Button>
          )
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Form layout="vertical" onFinish={apply}>
          <Flex wrap gap="0 12px" align="flex-end">
            <div style={{ minWidth: 220 }}>
              <Field label={t('ui.tickets.search')}>
                <Input value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder={t('ui.advisory.search_placeholder')} />
              </Field>
            </div>
            <div style={{ minWidth: 150 }}>
              <Field label={t('ui.advisory.status')}>
                <Choice
                  value={draft.status}
                  onChange={(v) => set('status', v)}
                  empty={t('ui.common.all')}
                  options={(manage ? ['draft', 'published', 'closed'] : ['published', 'closed']).map((s) => ({ value: s, label: t(`ui.advisory.status.${s}`) }))}
                />
              </Field>
            </div>
            {!manage && (
              <Form.Item style={{ marginBottom: 12 }}>
                <TodoCheckbox checked={draft.todo === '1'} onChange={(v) => set('todo', v ? '1' : '')} />
              </Form.Item>
            )}
            <Form.Item style={{ marginBottom: 12 }}>
              <Flex gap={8}>
                <Button type="primary" htmlType="submit">
                  {t('ui.common.apply')}
                </Button>
                <Button
                  onClick={() => {
                    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])));
                    setParams(new URLSearchParams());
                  }}>
                  {t('ui.common.reset')}
                </Button>
              </Flex>
            </Form.Item>
          </Flex>
        </Form>
      </Card>
      <Card>
        <ErrorBanner error={error} />
        <Table<AdvisoryRow>
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
            <Pagination simple current={data.page} total={data.total} pageSize={data.perPage} onChange={goPage} />
          </Flex>
        )}
      </Card>
    </>
  );
}
