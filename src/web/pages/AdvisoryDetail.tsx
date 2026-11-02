import { DownloadOutlined, EditOutlined, NotificationOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Descriptions, Flex, Modal, Popconfirm, Row, Statistic, Table, Tag, type TableColumnsType } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, post, put } from '../api';
import {
  ActionSummary,
  AdvisoryStatusBadge,
  ExposureBadge,
  ResponseForm,
  ResponseHistory,
  SeverityBadge,
  type Answer,
  type HistoryEntry,
} from '../components/advisory';
import { DateTime, Empty, ErrorBanner, Loading, PageHeader, useAction, useLoad, usePalette } from '../components/common';
import { useI18n } from '../i18n';

interface Target extends Answer {
  id: number;
  teamId: number;
  team: string;
  respondedAt: string | null;
  respondedBy: { id: number; displayName: string } | null;
  complete: boolean;
  overdue: boolean;
  canRespond: boolean;
  history: HistoryEntry[];
}
interface Advisory {
  id: number;
  number: string;
  title: string;
  severity: string;
  status: string;
  source: string | null;
  summary: string;
  cves: string[];
  affectedProducts: string;
  iocs: string;
  references: string;
  recommendation: string;
  responseDueAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  createdBy: { displayName: string } | null;
  progress: { total: number; responded: number; affected: number; complete: number; overdueResponse: number; overdueAction: number };
  targets: Target[];
  canManage: boolean;
}

/** Multi-line text as written; http(s) lines become links (references). */
function Text({ value, links, mono }: { value: string; links?: boolean; mono?: boolean }) {
  if (!value.trim()) return <span className="muted">—</span>;
  if (!links) return <div className={mono ? 'mono small' : undefined} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div>;
  return (
    <Flex vertical gap={2}>
      {value
        .split('\n')
        .filter((l) => l.trim())
        .map((l, i) =>
          /^https?:\/\/\S+$/.test(l.trim()) ? (
            <a key={i} href={l.trim()} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>
              {l.trim()}
            </a>
          ) : (
            <span key={i}>{l}</span>
          ),
        )}
    </Flex>
  );
}

const cardTitle = (text: ReactNode) => <h2 style={{ fontSize: 16, margin: 0 }}>{text}</h2>;

export function AdvisoryDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const p = usePalette();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { data, error, loading, setData } = useLoad(() => get<Advisory>(`/advisories/${encodeURIComponent(id!)}`), [id]);
  const action = useAction();
  const answering = useAction();
  const [onBehalf, setOnBehalf] = useState<Target | null>(null); // HQ recording a team's answer
  const [editing, setEditing] = useState<number | null>(null); // team member editing their team's answer

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;
  const base = `/advisories/${data.number}`;
  const run = (path: string) => void action.run(async () => setData(await post<Advisory>(`${base}/${path}`)));
  const remind = () =>
    void action.run(async () => {
      const { reminded } = await post<{ reminded: number }>(`${base}/remind`);
      void message.success(t('ui.advisory.reminded', { n: reminded }));
    });
  const answer = (target: Target, a: Answer & { note: string }) =>
    void answering.run(async () => {
      setData(await put<Advisory>(`${base}/teams/${target.teamId}`, a));
      setOnBehalf(null);
      setEditing(null);
      void message.success(t('ui.advisory.response_saved'));
    });
  const pr = data.progress;
  const published = data.status === 'published';

  const columns: TableColumnsType<Target> = [
    {
      key: 'team',
      title: t('ui.tickets.team'),
      className: 'nowrap',
      render: (_, r) => (
        <Flex vertical gap={2} align="flex-start">
          <strong>{r.team}</strong>
          {r.overdue && <span style={{ color: p.danger, fontWeight: 650 }} className="small">{t('ui.advisory.overdue')}</span>}
          {published && (
            <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setOnBehalf(r)}>
              {t('ui.advisory.respond_on_behalf')}
            </Button>
          )}
        </Flex>
      ),
    },
    {
      key: 'exposure',
      title: t('ui.advisory.exposure'),
      className: 'nowrap',
      render: (_, r) => (
        <Flex gap={4} align="center">
          <ExposureBadge exposure={r.exposure} />
          {r.complete && <span title={t('ui.advisory.complete')} aria-label={t('ui.advisory.complete')}>✓</span>}
        </Flex>
      ),
    },
    { key: 'scope', title: t('ui.advisory.affected_scope'), render: (_, r) => <div style={{ maxWidth: 220 }}><Text value={r.affectedScope} /></div> },
    { key: 'action', title: t('ui.advisory.action'), render: (_, r) => <ActionSummary answer={r} /> },
    {
      key: 'updated',
      title: t('ui.advisory.last_update'),
      render: (_, r) =>
        r.respondedAt ? (
          <div className="small">
            <DateTime value={r.respondedAt} />
            <div className="muted">{r.respondedBy?.displayName}</div>
          </div>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  const stat = (label: string, value: ReactNode, alert = false) => (
    <Statistic title={label} value={value as string} styles={{ content: { fontSize: 22, fontWeight: 650, color: alert ? p.danger : undefined } }} />
  );

  return (
    <>
      <PageHeader
        title={data.title}
        extra={
          data.canManage && (
            <>
              {data.status !== 'closed' && (
                <Button icon={<EditOutlined />} onClick={() => navigate(`${base}/edit`)}>
                  {t('ui.common.edit')}
                </Button>
              )}
              {data.status === 'draft' && (
                <>
                  <Button type="primary" loading={action.busy} disabled={action.busy} onClick={() => run('publish')}>
                    {t('ui.advisory.publish')}
                  </Button>
                  <Popconfirm
                    title={t('ui.advisory.delete_confirm')}
                    okText={t('ui.common.delete')}
                    cancelText={t('ui.common.cancel')}
                    onConfirm={() => void action.run(async () => { await del(base); navigate('/advisories'); })}>
                    <Button danger>{t('ui.common.delete')}</Button>
                  </Popconfirm>
                </>
              )}
              {published && (
                <Button icon={<NotificationOutlined />} loading={action.busy} disabled={action.busy || pr.complete === pr.total} onClick={remind}>
                  {t('ui.advisory.remind')}
                </Button>
              )}
              {data.status !== 'draft' && (
                <Button icon={<DownloadOutlined />} href={`/api/v1${base}/responses.csv`}>
                  {t('ui.advisory.export_csv')}
                </Button>
              )}
              {published && (
                <Popconfirm title={t('ui.advisory.close_confirm')} okText={t('ui.advisory.close')} cancelText={t('ui.common.cancel')} onConfirm={() => run('close')}>
                  <Button>{t('ui.advisory.close')}</Button>
                </Popconfirm>
              )}
              {data.status === 'closed' && (
                <Button loading={action.busy} disabled={action.busy} onClick={() => run('reopen')}>
                  {t('ui.advisory.reopen')}
                </Button>
              )}
            </>
          )
        }>
        <div className="mono muted">
          <Link to="/advisories">{t('ui.nav.advisories')}</Link> / {data.number}
        </div>
      </PageHeader>
      <Flex wrap gap={6} style={{ marginTop: -8, marginBottom: 16 }}>
        <SeverityBadge severity={data.severity} />
        <AdvisoryStatusBadge status={data.status} />
        {data.cves.map((c) => (
          <Tag key={c} className="mono">
            {c}
          </Tag>
        ))}
      </Flex>
      <ErrorBanner error={action.error} />

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={16}>
          <Flex vertical gap={16}>
            {/* HQ: every team's answer in one table */}
            {data.canManage && data.status !== 'draft' && (
              <Card title={cardTitle(t('ui.advisory.team_responses'))}>
                <Table<Target>
                  rowKey="id"
                  size="small"
                  columns={columns}
                  dataSource={data.targets}
                  pagination={false}
                  // a fixed minimum lets long cells wrap inside the card instead of scrolling sideways
                  scroll={{ x: 720 }}
                  expandable={{
                    expandedRowRender: (r) => <ResponseHistory entries={r.history} />,
                    rowExpandable: (r) => r.history.length > 0,
                  }}
                />
              </Card>
            )}

            {/* a team member: their own team's answer, editable while published */}
            {!data.canManage &&
              data.targets.map((r) => (
                <Card
                  key={r.id}
                  title={cardTitle(t('ui.advisory.team_response', { team: r.team }))}
                  extra={r.canRespond && editing !== r.teamId && r.exposure !== 'pending' && <Button onClick={() => setEditing(r.teamId)}>{t('ui.advisory.update_response')}</Button>}>
                  {r.canRespond && (r.exposure === 'pending' || editing === r.teamId) ? (
                    <>
                      {r.exposure === 'pending' && <p className="muted" style={{ marginTop: 0 }}>{t('ui.advisory.respond_prompt')}</p>}
                      <ResponseForm
                        initial={r}
                        busy={answering.busy}
                        error={answering.error}
                        onSubmit={(a) => answer(r, a)}
                        onCancel={editing === r.teamId ? () => setEditing(null) : undefined}
                      />
                    </>
                  ) : (
                    <Descriptions
                      column={1}
                      size="small"
                      colon={false}
                      styles={{ label: { width: 120 } }}
                      items={[
                        { key: 'exposure', label: t('ui.advisory.exposure'), children: <ExposureBadge exposure={r.exposure} /> },
                        { key: 'scope', label: t('ui.advisory.affected_scope'), children: <Text value={r.affectedScope} /> },
                        { key: 'action', label: t('ui.advisory.action'), children: <ActionSummary answer={r} /> },
                        { key: 'detail', label: t('ui.advisory.action_detail'), children: <Text value={r.actionDetail} /> },
                      ]}
                    />
                  )}
                  <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>{t('ui.advisory.history')}</h3>
                  <ResponseHistory entries={r.history} />
                </Card>
              ))}
            {!data.canManage && !data.targets.length && <Empty />}

            <Card title={cardTitle(t('ui.advisory.content'))}>
              <Descriptions
                column={1}
                colon={false}
                styles={{ label: { width: 120, verticalAlign: 'top' } }}
                items={[
                  { key: 'summary', label: t('ui.advisory.summary'), children: <Text value={data.summary} /> },
                  {
                    key: 'cves',
                    label: t('ui.advisory.cves'),
                    children: data.cves.length ? (
                      <Flex wrap gap={6}>
                        {data.cves.map((c) => (
                          <a key={c} className="mono" href={`https://nvd.nist.gov/vuln/detail/${c}`} target="_blank" rel="noopener noreferrer">
                            {c}
                          </a>
                        ))}
                      </Flex>
                    ) : (
                      <span className="muted">—</span>
                    ),
                  },
                  { key: 'products', label: t('ui.advisory.affected_products'), children: <Text value={data.affectedProducts} /> },
                  { key: 'iocs', label: t('ui.advisory.iocs'), children: <Text value={data.iocs} mono /> },
                  { key: 'recommendation', label: t('ui.advisory.recommendation'), children: <Text value={data.recommendation} /> },
                  { key: 'references', label: t('ui.advisory.references'), children: <Text value={data.references} links /> },
                ]}
              />
            </Card>
          </Flex>
        </Col>

        <Col xs={24} lg={8}>
          <Flex vertical gap={16}>
            {data.canManage && data.status !== 'draft' && (
              <Card title={cardTitle(t('ui.advisory.progress'))}>
                <Row gutter={[12, 12]}>
                  <Col span={12}>{stat(t('ui.advisory.responded'), `${pr.responded} / ${pr.total}`)}</Col>
                  <Col span={12}>{stat(t('ui.advisory.affected_teams'), pr.affected, pr.affected > 0)}</Col>
                  <Col span={12}>{stat(t('ui.advisory.complete_teams'), `${pr.complete} / ${pr.total}`)}</Col>
                  <Col span={12}>{stat(t('ui.advisory.overdue'), published ? pr.overdueResponse + pr.overdueAction : '—', published && pr.overdueResponse + pr.overdueAction > 0)}</Col>
                </Row>
              </Card>
            )}
            <Card>
              <Descriptions
                column={1}
                size="small"
                colon={false}
                styles={{ label: { width: 104 } }}
                items={[
                  { key: 'due', label: t('ui.advisory.response_due'), children: <DateTime value={data.responseDueAt} /> },
                  { key: 'source', label: t('ui.advisory.source'), children: data.source ?? '—' },
                  ...(data.canManage
                    ? [{ key: 'teams', label: t('ui.advisory.teams'), children: data.targets.map((x) => x.team).join(', ') || '—' }]
                    : []),
                  { key: 'published', label: t('ui.advisory.published_at'), children: <DateTime value={data.publishedAt} /> },
                  ...(data.closedAt ? [{ key: 'closed', label: t('ui.advisory.closed_at'), children: <DateTime value={data.closedAt} /> }] : []),
                  { key: 'author', label: t('ui.advisory.created_by'), children: data.createdBy?.displayName ?? '—' },
                ]}
              />
            </Card>
          </Flex>
        </Col>
      </Row>

      <Modal
        open={!!onBehalf}
        title={t('ui.advisory.respond_on_behalf_title', { team: onBehalf?.team ?? '' })}
        footer={null}
        onCancel={() => setOnBehalf(null)}
        destroyOnHidden
        width={640}>
        {onBehalf && (
          <ResponseForm initial={onBehalf} busy={answering.busy} error={answering.error} onSubmit={(a) => answer(onBehalf, a)} onCancel={() => setOnBehalf(null)} />
        )}
      </Modal>
    </>
  );
}
