import { Button, Card, Checkbox, Col, Descriptions, Flex, Form, Input, Row, Space, type DescriptionsProps } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../api';
import { useAuth } from '../auth';
import { CustomFieldInput, formatFieldValue } from '../components/CustomFieldInput';
import {
  Choice,
  DateTime,
  ErrorBanner,
  Field,
  Loading,
  PageHeader,
  PriorityBadge,
  SlaBadge,
  StatusBadge,
  Tags,
  useAction,
  useLoad,
  usePalette,
} from '../components/common';
import { useI18n } from '../i18n';

interface Person {
  id: number;
  displayName: string;
  email?: string;
}
interface Thread {
  id: number;
  type: 'customer_message' | 'agent_reply' | 'internal_note' | 'system_event';
  body: string;
  createdAt: string;
  author: Person | null;
}
interface TicketDetail {
  id: number;
  number: string;
  subject: string;
  description: string;
  status: string;
  priority: number;
  source: string;
  sla: { status: string; firstResponseDueAt: string | null; resolutionDueAt: string | null; firstRespondedAt: string | null; paused: boolean };
  reopenCount: number;
  createdAt: string;
  requester: Person | null;
  assignee: Person | null;
  helpTopic: { id: number; name: string } | null;
  team: { id: number; name: string } | null;
  slaPlan: { name: string } | null;
  tags: string[];
  customFields: { key: string; label: string; type: string; visibility: string; options: string[]; value: unknown }[];
  threads: Thread[];
  watchers: Person[];
  allowedTransitions: string[];
}
interface Catalog {
  users?: (Person & { role: string })[];
  teams?: { id: number; name: string }[];
  cannedResponses?: { id: number; name: string; body: string }[];
}

function SystemEvent({ body }: { body: string }) {
  const { t } = useI18n();
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(body);
  } catch {
    return <>{body}</>;
  }
  const v = (x: unknown) => (x == null ? '—' : String(x));
  switch (e.event) {
    case 'created':
      return <>{t('ui.event.created', { source: v(e.source) })}</>;
    case 'status':
      return <>{t('ui.event.status', { from: t(`ticket.status.${e.from}`), to: t(`ticket.status.${e.to}`) })}</>;
    case 'priority':
      return <>{t('ui.event.priority', { from: t(`ticket.priority.${e.from}`), to: t(`ticket.priority.${e.to}`) })}</>;
    case 'assignee':
      return <>{t('ui.event.assignee')}</>;
    case 'team':
      return <>{t('ui.event.team')}</>;
    case 'tags':
      return <>{t('ui.event.tags', { tags: ((e.to as string[]) ?? []).join(', ') })}</>;
    case 'help_topic':
      return <>{t('ui.event.help_topic')}</>;
    case 'custom_fields':
      return <>{t('ui.event.custom_fields', { keys: ((e.keys as string[]) ?? []).join(', ') })}</>;
    default:
      return <>{body}</>;
  }
}

export function TicketDetailPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const { can } = useAuth();
  const p = usePalette();
  const staff = can('ticket:note');
  const { data, error, loading, reload, setData } = useLoad(() => get<TicketDetail>(`/tickets/${encodeURIComponent(id!)}`), [id]);
  const catalog = useLoad(() => get<Catalog>('/catalog'), []);
  const action = useAction();
  const [reply, setReply] = useState('');
  const [notify, setNotify] = useState(true);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<Record<string, unknown> | null>(null);
  const [watcherId, setWatcherId] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const update = (body: Record<string, unknown>) =>
    action.run(async () => setData(await patch<TicketDetail>(`/tickets/${data.id}`, body)));

  const sendReply = () => {
    void action.run(async () => {
      await post(`/tickets/${data.id}/threads`, { body: reply, notify });
      setReply('');
      setNotify(true);
      await reload();
    });
  };

  const assignable = (catalog.data?.users ?? []).filter((u) => ['super_admin', 'it_manager', 'agent', 'vendor'].includes(u.role));
  const canUpdate = can('ticket:update');
  const canTriage = can('ticket:triage');
  const canAssign = can('ticket:assign');

  const applyCanned = (id: string) => {
    const c = catalog.data?.cannedResponses?.find((x) => x.id === Number(id));
    if (!c) return;
    const body = c.body
      .replaceAll('%{ticket.number}', data.number)
      .replaceAll('%{ticket.subject}', data.subject)
      .replaceAll('%{requester.name}', data.requester?.displayName ?? '');
    setReply((r) => (r ? `${r}\n${body}` : body));
  };
  // Message surfaces: internal notes keep their own tint in both themes so they never pass for a reply.
  const msgStyle = (type: Thread['type']) =>
    type === 'internal_note'
      ? { background: p.internal, border: `1px solid ${p.internalBorder}` }
      : { background: p.surface, border: `1px solid ${p.hairline}` };
  const full = { style: { width: '100%' } };

  const props: DescriptionsProps['items'] = [
    {
      key: 'status',
      label: t('ui.tickets.status'),
      children:
        canUpdate && data.allowedTransitions.length ? (
          <Choice
            {...full}
            aria-label={t('ui.tickets.status')}
            value={data.status}
            onChange={(v) => void update({ status: v })}
            options={[
              { value: data.status, label: t(`ticket.status.${data.status}`) },
              ...data.allowedTransitions.map((st) => ({ value: st, label: `→ ${t(`ticket.status.${st}`)}` })),
            ]}
          />
        ) : (
          <StatusBadge status={data.status} />
        ),
    },
    {
      key: 'priority',
      label: t('ui.tickets.priority'),
      children: canTriage ? (
        <Choice
          {...full}
          aria-label={t('ui.tickets.priority')}
          value={data.priority}
          onChange={(v) => void update({ priority: Number(v) })}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: t(`ticket.priority.${n}`) }))}
        />
      ) : (
        <PriorityBadge priority={data.priority} />
      ),
    },
    {
      key: 'assignee',
      label: t('ui.tickets.assignee'),
      children: canAssign ? (
        <Choice
          {...full}
          aria-label={t('ui.tickets.assignee')}
          value={data.assignee?.id ?? ''}
          onChange={(v) => void update({ assigneeId: v ? Number(v) : null })}
          empty={t('ui.tickets.unassigned')}
          options={assignable.map((u) => ({ value: u.id, label: `${u.displayName} (${t(`ui.role.${u.role}`)})` }))}
        />
      ) : (
        (data.assignee?.displayName ?? t('ui.tickets.unassigned'))
      ),
    },
    {
      key: 'team',
      label: t('ui.tickets.team'),
      children: canAssign ? (
        <Choice
          {...full}
          aria-label={t('ui.tickets.team')}
          value={data.team?.id ?? ''}
          onChange={(v) => void update({ teamId: v ? Number(v) : null })}
          empty="—"
          options={catalog.data?.teams?.map((tm) => ({ value: tm.id, label: tm.name })) ?? []}
        />
      ) : (
        (data.team?.name ?? '—')
      ),
    },
    { key: 'topic', label: t('ui.tickets.help_topic'), children: data.helpTopic?.name ?? '—' },
    {
      key: 'requester',
      label: t('ui.tickets.requester'),
      children: (
        <div>
          {data.requester?.displayName ?? '—'}
          {data.requester?.email && <div className="small muted">{data.requester.email}</div>}
        </div>
      ),
    },
    {
      key: 'tags',
      label: t('ui.tickets.tags'),
      children:
        canTriage && tagDraft !== null ? (
          <Form onFinish={() => void update({ tags: tagDraft.split(',').map((x) => x.trim()).filter(Boolean) }).then(() => setTagDraft(null))} style={{ width: '100%' }}>
            <Input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} autoFocus aria-label={t('ui.tickets.tags')} />
          </Form>
        ) : (
          <div>
            <Tags tags={data.tags} />
            {canTriage && (
              <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => setTagDraft(data.tags.join(', '))}>
                {t('ui.common.edit')}
              </Button>
            )}
          </div>
        ),
    },
    { key: 'sla_plan', label: t('ui.tickets.sla_plan'), children: data.slaPlan?.name ?? '—' },
    {
      key: 'first_response',
      label: t('ui.tickets.first_response_due'),
      children: (
        <div>
          <DateTime value={data.sla.firstResponseDueAt} />
          {data.sla.firstRespondedAt && (
            <div className="small muted">
              ✓ <DateTime value={data.sla.firstRespondedAt} />
            </div>
          )}
        </div>
      ),
    },
    { key: 'resolution', label: t('ui.tickets.resolution_due'), children: <DateTime value={data.sla.resolutionDueAt} /> },
    ...(data.reopenCount > 0 ? [{ key: 'reopened', label: t('ui.tickets.reopened'), children: data.reopenCount }] : []),
    {
      key: 'watchers',
      label: t('ui.tickets.watchers'),
      children: (
        <Flex vertical gap={6} style={{ width: '100%' }}>
          {data.watchers.length === 0 && <span className="muted">—</span>}
          {data.watchers.map((w) => (
            <Flex key={w.id} align="center" gap={4}>
              {w.displayName}
              {canAssign && (
                <Button
                  type="text"
                  size="small"
                  aria-label={t('ui.common.remove')}
                  onClick={() => void action.run(async () => { await del(`/tickets/${data.id}/watchers/${w.id}`); await reload(); })}
                >
                  ✕
                </Button>
              )}
            </Flex>
          ))}
          {canAssign && (
            <Space.Compact style={{ width: '100%' }}>
              <Choice
                aria-label={t('ui.tickets.add_watcher')}
                value={watcherId}
                onChange={setWatcherId}
                empty={t('ui.tickets.add_watcher')}
                options={
                  catalog.data?.users?.filter((u) => !data.watchers.some((w) => w.id === u.id)).map((u) => ({ value: u.id, label: u.displayName })) ?? []
                }
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                disabled={!watcherId}
                onClick={() =>
                  void action.run(async () => {
                    await post(`/tickets/${data.id}/watchers`, { userId: Number(watcherId) });
                    setWatcherId('');
                    await reload();
                  })
                }
              >
                +
              </Button>
            </Space.Compact>
          )}
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={data.subject}>
        <div className="mono muted">
          <Link to="/tickets">{t('ui.nav.tickets')}</Link> / {data.number}
        </div>
      </PageHeader>
      <Flex wrap gap={6} style={{ marginTop: -8, marginBottom: 16 }}>
        <StatusBadge status={data.status} />
        <PriorityBadge priority={data.priority} />
        <SlaBadge status={data.sla.status} paused={data.sla.paused} />
        <Tags tags={data.tags} />
      </Flex>
      <ErrorBanner error={action.error} />

      <Row gutter={[16, 16]} align="top">
        <Col xs={24} lg={16}>
          <Flex vertical gap={16}>
            <Card>
              <div className="msg-head">
                <span>
                  {data.requester?.displayName ?? '—'} · {t(`ui.source.${data.source}`)}
                </span>
                <DateTime value={data.createdAt} />
              </div>
              <div className="msg-body">{data.description || <span className="muted">{t('ui.tickets.no_description')}</span>}</div>
            </Card>

            {data.customFields.length > 0 && (
              <Card
                title={<h2 style={{ fontSize: 16, margin: 0 }}>{t('ui.tickets.custom_fields')}</h2>}
                extra={
                  canTriage &&
                  fieldDraft === null && (
                    <Button onClick={() => setFieldDraft(Object.fromEntries(data.customFields.map((f) => [f.key, f.value])))}>{t('ui.common.edit')}</Button>
                  )
                }
              >
                {fieldDraft === null ? (
                  <Descriptions
                    column={1}
                    size="small"
                    colon={false}
                    items={data.customFields.map((f) => ({
                      key: f.key,
                      label: (
                        <>
                          {f.label}
                          {f.visibility === 'internal' && <span className="small"> 🔒</span>}
                        </>
                      ),
                      children: formatFieldValue(f.value),
                    }))}
                  />
                ) : (
                  <Form layout="vertical" onFinish={() => void update({ customFields: fieldDraft }).then(() => setFieldDraft(null))}>
                    <Row gutter={12}>
                      {data.customFields.map((f) => (
                        <Col key={f.key} xs={24} sm={12}>
                          <Field label={f.label}>
                            <CustomFieldInput field={f} value={fieldDraft[f.key]} onChange={(v) => setFieldDraft((st) => ({ ...st!, [f.key]: v }))} />
                          </Field>
                        </Col>
                      ))}
                    </Row>
                    <Flex gap={8}>
                      <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
                        {t('ui.common.save')}
                      </Button>
                      <Button onClick={() => setFieldDraft(null)}>{t('ui.common.cancel')}</Button>
                    </Flex>
                  </Form>
                )}
              </Card>
            )}

            <Card title={<h2 style={{ fontSize: 16, margin: 0 }}>{t('ui.tickets.conversation')}</h2>}>
              <Flex vertical gap={12}>
                {data.threads.map((th) =>
                  th.type === 'system_event' ? (
                    <div key={th.id} className="msg system_event" style={{ border: `1px dashed ${p.hairline}`, color: p.ink3 }}>
                      <DateTime value={th.createdAt} /> · {th.author?.displayName ?? t('ui.common.system')} · <SystemEvent body={th.body} />
                    </div>
                  ) : (
                    <div key={th.id} className={`msg ${th.type}`} style={msgStyle(th.type)}>
                      <div className="msg-head">
                        <span>
                          <strong>{th.author?.displayName ?? '—'}</strong> · {t(`ui.thread.${th.type}`)}
                        </span>
                        <DateTime value={th.createdAt} />
                      </div>
                      <div className="msg-body">{th.body}</div>
                    </div>
                  ),
                )}
              </Flex>
            </Card>

            {data.status !== 'closed' && can('ticket:reply') && (
              <Card>
                <Form onFinish={sendReply}>
                  {staff && catalog.data?.cannedResponses && catalog.data.cannedResponses.length > 0 && (
                    <Flex wrap gap={12} align="center" style={{ marginBottom: 12 }}>
                      <Choice
                        aria-label={t('ui.thread.canned')}
                        value=""
                        onChange={applyCanned}
                        empty={t('ui.thread.canned')}
                        options={catalog.data.cannedResponses.map((c) => ({ value: c.id, label: c.name }))}
                      />
                    </Flex>
                  )}
                  <Input.TextArea
                    required
                    autoSize={{ minRows: 4 }}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={t('ui.thread.reply_placeholder')}
                  />
                  <Flex wrap gap={16} align="center" style={{ marginTop: 12 }}>
                    <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
                      {t('ui.thread.send')}
                    </Button>
                    <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)}>
                      {t('ui.thread.notify_email')}
                    </Checkbox>
                  </Flex>
                </Form>
              </Card>
            )}
          </Flex>
        </Col>

        <Col xs={24} lg={8}>
          <Card>
            <Descriptions className="ticket-props" column={1} size="small" colon={false} items={props} styles={{ label: { width: 104 } }} />
          </Card>
        </Col>
      </Row>
    </>
  );
}
