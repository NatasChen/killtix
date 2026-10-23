import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { del, get, patch, post } from '../api';
import { useAuth } from '../auth';
import { CustomFieldInput, formatFieldValue } from '../components/CustomFieldInput';
import {
  DateTime,
  ErrorBanner,
  Loading,
  PriorityBadge,
  SlaBadge,
  StatusBadge,
  Tags,
  useAction,
  useLoad,
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
  const staff = can('ticket:note');
  const { data, error, loading, reload, setData } = useLoad(() => get<TicketDetail>(`/tickets/${encodeURIComponent(id!)}`), [id]);
  const catalog = useLoad(() => get<Catalog>('/catalog'), []);
  const action = useAction();
  const [reply, setReply] = useState('');
  const [replyType, setReplyType] = useState<'reply' | 'internal_note'>('reply');
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<Record<string, unknown> | null>(null);
  const [watcherId, setWatcherId] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const update = (body: Record<string, unknown>) =>
    action.run(async () => setData(await patch<TicketDetail>(`/tickets/${data.id}`, body)));

  const sendReply = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      await post(`/tickets/${data.id}/threads`, { type: replyType, body: reply });
      setReply('');
      await reload();
    });
  };

  const assignable = (catalog.data?.users ?? []).filter((u) => ['super_admin', 'it_manager', 'agent', 'vendor'].includes(u.role));
  const canUpdate = can('ticket:update');
  const canTriage = can('ticket:triage');
  const canAssign = can('ticket:assign');

  return (
    <>
      <div className="topline">
        <div>
          <div className="mono muted">
            <Link to="/tickets">{t('ui.nav.tickets')}</Link> / {data.number}
          </div>
          <h1>{data.subject}</h1>
          <div className="actions">
            <StatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} />
            <SlaBadge status={data.sla.status} paused={data.sla.paused} />
            <Tags tags={data.tags} />
          </div>
        </div>
      </div>
      <ErrorBanner error={action.error} />

      <div className="detail">
        <div>
          <div className="card">
            <div className="msg-head">
              <span>
                {data.requester?.displayName ?? '—'} · {t(`ui.source.${data.source}`)}
              </span>
              <DateTime value={data.createdAt} />
            </div>
            <div className="msg-body">{data.description || <span className="muted">{t('ui.tickets.no_description')}</span>}</div>
          </div>

          {data.customFields.length > 0 && (
            <div className="card">
              <div className="topline">
                <h2>{t('ui.tickets.custom_fields')}</h2>
                {canTriage && fieldDraft === null && (
                  <button onClick={() => setFieldDraft(Object.fromEntries(data.customFields.map((f) => [f.key, f.value])))}>{t('ui.common.edit')}</button>
                )}
              </div>
              {fieldDraft === null ? (
                <dl className="props">
                  {data.customFields.map((f) => (
                    <div key={f.key} style={{ display: 'contents' }}>
                      <dt>
                        {f.label}
                        {f.visibility === 'internal' && <span className="small"> 🔒</span>}
                      </dt>
                      <dd>{formatFieldValue(f.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update({ customFields: fieldDraft }).then(() => setFieldDraft(null));
                  }}
                >
                  <div className="form-row">
                    {data.customFields.map((f) => (
                      <label key={f.key}>
                        {f.label}
                        <CustomFieldInput field={f} value={fieldDraft[f.key]} onChange={(v) => setFieldDraft((s) => ({ ...s!, [f.key]: v }))} />
                      </label>
                    ))}
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={action.busy}>
                      {t('ui.common.save')}
                    </button>
                    <button type="button" onClick={() => setFieldDraft(null)}>
                      {t('ui.common.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="card">
            <h2>{t('ui.tickets.conversation')}</h2>
            <div className="thread">
              {data.threads.map((th) =>
                th.type === 'system_event' ? (
                  <div key={th.id} className="msg system_event">
                    <DateTime value={th.createdAt} /> · {th.author?.displayName ?? t('ui.common.system')} · <SystemEvent body={th.body} />
                  </div>
                ) : (
                  <div key={th.id} className={`msg ${th.type}`}>
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
            </div>
          </div>

          {data.status !== 'closed' && can('ticket:reply') && (
            <form className="card form" onSubmit={sendReply}>
              {staff && (
                <div className="actions">
                  <label className="inline">
                    <input type="radio" name="replyType" checked={replyType === 'reply'} onChange={() => setReplyType('reply')} />
                    {t('ui.thread.reply_public')}
                  </label>
                  <label className="inline">
                    <input type="radio" name="replyType" checked={replyType === 'internal_note'} onChange={() => setReplyType('internal_note')} />
                    {t('ui.thread.internal_note')}
                  </label>
                  {catalog.data?.cannedResponses && catalog.data.cannedResponses.length > 0 && (
                    <select
                      aria-label={t('ui.thread.canned')}
                      value=""
                      onChange={(e) => {
                        const c = catalog.data?.cannedResponses?.find((x) => x.id === Number(e.target.value));
                        if (c) {
                          const body = c.body
                            .replaceAll('%{ticket.number}', data.number)
                            .replaceAll('%{ticket.subject}', data.subject)
                            .replaceAll('%{requester.name}', data.requester?.displayName ?? '');
                          setReply((r) => (r ? `${r}\n${body}` : body));
                        }
                      }}
                    >
                      <option value="">{t('ui.thread.canned')}</option>
                      {catalog.data.cannedResponses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <textarea
                required
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={replyType === 'internal_note' ? t('ui.thread.internal_placeholder') : t('ui.thread.reply_placeholder')}
              />
              <div className="actions">
                <button className="primary" disabled={action.busy}>
                  {replyType === 'internal_note' ? t('ui.thread.add_note') : t('ui.thread.send')}
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="card">
          <dl className="props">
            <dt>{t('ui.tickets.status')}</dt>
            <dd>
              {canUpdate && data.allowedTransitions.length ? (
                <select value={data.status} onChange={(e) => void update({ status: e.target.value })} aria-label={t('ui.tickets.status')}>
                  <option value={data.status}>{t(`ticket.status.${data.status}`)}</option>
                  {data.allowedTransitions.map((s) => (
                    <option key={s} value={s}>
                      → {t(`ticket.status.${s}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge status={data.status} />
              )}
            </dd>
            <dt>{t('ui.tickets.priority')}</dt>
            <dd>
              {canTriage ? (
                <select value={data.priority} onChange={(e) => void update({ priority: Number(e.target.value) })} aria-label={t('ui.tickets.priority')}>
                  {[1, 2, 3, 4, 5].map((p) => (
                    <option key={p} value={p}>
                      {t(`ticket.priority.${p}`)}
                    </option>
                  ))}
                </select>
              ) : (
                <PriorityBadge priority={data.priority} />
              )}
            </dd>
            <dt>{t('ui.tickets.assignee')}</dt>
            <dd>
              {canAssign ? (
                <select
                  value={data.assignee?.id ?? ''}
                  onChange={(e) => void update({ assigneeId: e.target.value ? Number(e.target.value) : null })}
                  aria-label={t('ui.tickets.assignee')}
                >
                  <option value="">{t('ui.tickets.unassigned')}</option>
                  {assignable.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} ({t(`ui.role.${u.role}`)})
                    </option>
                  ))}
                </select>
              ) : (
                (data.assignee?.displayName ?? t('ui.tickets.unassigned'))
              )}
            </dd>
            <dt>{t('ui.tickets.team')}</dt>
            <dd>
              {canAssign ? (
                <select value={data.team?.id ?? ''} onChange={(e) => void update({ teamId: e.target.value ? Number(e.target.value) : null })} aria-label={t('ui.tickets.team')}>
                  <option value="">—</option>
                  {catalog.data?.teams?.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              ) : (
                (data.team?.name ?? '—')
              )}
            </dd>
            <dt>{t('ui.tickets.help_topic')}</dt>
            <dd>{data.helpTopic?.name ?? '—'}</dd>
            <dt>{t('ui.tickets.requester')}</dt>
            <dd>
              {data.requester?.displayName ?? '—'}
              {data.requester?.email && <div className="small muted">{data.requester.email}</div>}
            </dd>
            <dt>{t('ui.tickets.tags')}</dt>
            <dd>
              {canTriage && tagDraft !== null ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update({ tags: tagDraft.split(',').map((s) => s.trim()).filter(Boolean) }).then(() => setTagDraft(null));
                  }}
                >
                  <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} autoFocus aria-label={t('ui.tickets.tags')} />
                </form>
              ) : (
                <>
                  <Tags tags={data.tags} />
                  {canTriage && (
                    <button className="link small" onClick={() => setTagDraft(data.tags.join(', '))}>
                      {t('ui.common.edit')}
                    </button>
                  )}
                </>
              )}
            </dd>
            <dt>{t('ui.tickets.sla_plan')}</dt>
            <dd>{data.slaPlan?.name ?? '—'}</dd>
            <dt>{t('ui.tickets.first_response_due')}</dt>
            <dd>
              <DateTime value={data.sla.firstResponseDueAt} />
              {data.sla.firstRespondedAt && <div className="small muted">✓ <DateTime value={data.sla.firstRespondedAt} /></div>}
            </dd>
            <dt>{t('ui.tickets.resolution_due')}</dt>
            <dd>
              <DateTime value={data.sla.resolutionDueAt} />
            </dd>
            {data.reopenCount > 0 && (
              <>
                <dt>{t('ui.tickets.reopened')}</dt>
                <dd>{data.reopenCount}</dd>
              </>
            )}
            <dt>{t('ui.tickets.watchers')}</dt>
            <dd>
              {data.watchers.length === 0 && <span className="muted">—</span>}
              {data.watchers.map((w) => (
                <div key={w.id} className="actions">
                  {w.displayName}
                  {canAssign && (
                    <button
                      className="link small"
                      aria-label={t('ui.common.remove')}
                      onClick={() => void action.run(async () => { await del(`/tickets/${data.id}/watchers/${w.id}`); await reload(); })}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {canAssign && (
                <form
                  className="actions"
                  style={{ marginTop: 6 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!watcherId) return;
                    void action.run(async () => {
                      await post(`/tickets/${data.id}/watchers`, { userId: Number(watcherId) });
                      setWatcherId('');
                      await reload();
                    });
                  }}
                >
                  <select value={watcherId} onChange={(e) => setWatcherId(e.target.value)} aria-label={t('ui.tickets.add_watcher')}>
                    <option value="">{t('ui.tickets.add_watcher')}</option>
                    {catalog.data?.users
                      ?.filter((u) => !data.watchers.some((w) => w.id === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                  </select>
                  <button disabled={!watcherId}>+</button>
                </form>
              )}
            </dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
