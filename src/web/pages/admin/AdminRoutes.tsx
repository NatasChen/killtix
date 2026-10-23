import { useState, type FormEvent } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { del, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { DateTime, Empty, ErrorBanner, Loading, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { CrudPage } from './Crud';

const ROLES = ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user'];
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'url'];

type Opt = { id: number; name: string };
const useOptions = (path: string) => useLoad(() => get<Opt[]>(path), [path]).data?.map((o) => ({ value: o.id, label: o.name })) ?? [];

/** Shows a secret exactly once with a copy button. */
function OneTimeSecret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="banner warning">
      <strong>{label}</strong>
      <div className="secret-box mono" style={{ margin: '8px 0' }}>
        {value}
      </div>
      <div className="actions">
        <button onClick={() => void navigator.clipboard?.writeText(value)}>{t('ui.common.copy')}</button>
        <button onClick={onClose}>{t('ui.common.close')}</button>
      </div>
    </div>
  );
}

function UsersPage() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<any[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const teams = useOptions('/admin/teams');
  const action = useAction();
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'end_user', teamId: '' });

  const create = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      const res = await post('/admin/users', { ...form, teamId: form.teamId ? Number(form.teamId) : null });
      setSecret({ email: res.user.email, password: res.temporaryPassword });
      setForm({ email: '', displayName: '', role: 'end_user', teamId: '' });
      await reload();
    });
  };
  const update = (id: number, body: Record<string, unknown>) => action.run(async () => { await patch(`/admin/users/${id}`, body); await reload(); });

  return (
    <>
      <h1>{t('ui.nav.users')}</h1>
      {secret && (
        <OneTimeSecret label={t('ui.admin.temp_password_for', { email: secret.email })} value={secret.password} onClose={() => setSecret(null)} />
      )}
      <ErrorBanner error={action.error} />
      <form className="card form" onSubmit={create}>
        <h2>{t('ui.admin.create_user')}</h2>
        <div className="form-row">
          <label>
            {t('ui.auth.email')}
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            {t('ui.profile.display_name')}
            <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </label>
          <label>
            {t('ui.admin.role')}
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`ui.role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('ui.tickets.team')}
            <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
              <option value="">—</option>
              {teams.map((tm) => (
                <option key={tm.value} value={tm.value}>
                  {tm.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small muted">{t('ui.admin.create_user_hint')}</p>
        <div className="actions">
          <button className="primary" disabled={action.busy}>
            {t('ui.common.add')}
          </button>
        </div>
      </form>
      <div className="card">
        <div className="filters">
          <label>
            {t('ui.tickets.search')}
            <input value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <ErrorBanner error={error} />
        {loading && !data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ui.auth.email')}</th>
                  <th>{t('ui.admin.role')}</th>
                  <th>{t('ui.tickets.team')}</th>
                  <th>2FA</th>
                  <th>{t('ui.admin.last_login')}</th>
                  <th>{t('ui.admin.active')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <div className="small muted">{u.email}</div>
                      {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <span className="badge breached">{t('ui.admin.locked')}</span>}
                    </td>
                    <td>
                      <select value={u.role} disabled={u.id === me?.id} onChange={(e) => void update(u.id, { role: e.target.value })} aria-label={t('ui.admin.role')}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`ui.role.${r}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={u.teamId ?? ''}
                        onChange={(e) => void update(u.id, { teamId: e.target.value ? Number(e.target.value) : null })}
                        aria-label={t('ui.tickets.team')}
                      >
                        <option value="">—</option>
                        {teams.map((tm) => (
                          <option key={tm.value} value={tm.value}>
                            {tm.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{u.twoFactorEnabled ? '✓' : '—'}</td>
                    <td>
                      <DateTime value={u.lastLoginAt} />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={u.isActive}
                        disabled={u.id === me?.id}
                        onChange={(e) => void update(u.id, { isActive: e.target.checked })}
                        aria-label={t('ui.admin.active')}
                      />
                    </td>
                    <td className="actions">
                      <button
                        className="link"
                        onClick={() =>
                          void action.run(async () => {
                            const res = await post(`/admin/users/${u.id}/reset-password`);
                            setSecret({ email: u.email, password: res.temporaryPassword });
                          })
                        }
                      >
                        {t('ui.admin.reset_password')}
                      </button>
                      {u.twoFactorEnabled && (
                        <button className="link" onClick={() => void action.run(async () => { await post(`/admin/users/${u.id}/reset-2fa`); await reload(); })}>
                          {t('ui.admin.reset_2fa')}
                        </button>
                      )}
                      {u.lockedUntil && (
                        <button className="link" onClick={() => void action.run(async () => { await post(`/admin/users/${u.id}/unlock`); await reload(); })}>
                          {t('ui.admin.unlock')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function FormsPage() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<any[]>('/admin/forms'), []);
  const action = useAction();
  const [formName, setFormName] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const empty = { key: '', label: '', type: 'text', isRequired: false, options: '', regex: '', visibility: 'public', isFilterable: false };
  const [field, setField] = useState(empty);
  const current = data?.find((f) => f.id === selected) ?? data?.[0];

  return (
    <>
      <h1>{t('ui.nav.forms')}</h1>
      <ErrorBanner error={action.error ?? error} />
      <form
        className="card actions"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const created = await post('/admin/forms', { name: formName });
            setFormName('');
            setSelected(created.id);
            await reload();
          });
        }}
      >
        <input required placeholder={t('ui.admin.form_name')} value={formName} onChange={(e) => setFormName(e.target.value)} aria-label={t('ui.admin.form_name')} />
        <button className="primary">{t('ui.admin.add_form')}</button>
      </form>
      {loading && !data ? (
        <Loading />
      ) : !data?.length ? (
        <div className="card">
          <Empty />
        </div>
      ) : (
        <div className="card">
          <div className="actions" style={{ marginBottom: 12 }}>
            {data.map((f) => (
              <button key={f.id} className={f.id === current?.id ? 'primary' : ''} onClick={() => setSelected(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          <p className="small muted">{t('ui.admin.form_hint')}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>key</th>
                  <th>{t('ui.admin.label')}</th>
                  <th>{t('ui.admin.type')}</th>
                  <th>{t('ui.admin.required')}</th>
                  <th>{t('ui.admin.visibility')}</th>
                  <th>{t('ui.admin.filterable')}</th>
                  <th>{t('ui.admin.active')}</th>
                </tr>
              </thead>
              <tbody>
                {current?.fields.map((f: any) => (
                  <tr key={f.id}>
                    <td className="mono">{f.key}</td>
                    <td>
                      {f.label}
                      {f.options?.length > 0 && <div className="small muted">{f.options.join(', ')}</div>}
                    </td>
                    <td>{f.type}</td>
                    <td>
                      <input type="checkbox" checked={f.isRequired} onChange={(e) => void action.run(async () => { await patch(`/admin/fields/${f.id}`, { isRequired: e.target.checked }); await reload(); })} aria-label={t('ui.admin.required')} />
                    </td>
                    <td>{t(`ui.visibility.${f.visibility}`)}</td>
                    <td>
                      <input type="checkbox" checked={f.isFilterable} onChange={(e) => void action.run(async () => { await patch(`/admin/fields/${f.id}`, { isFilterable: e.target.checked }); await reload(); })} aria-label={t('ui.admin.filterable')} />
                    </td>
                    <td>
                      <input type="checkbox" checked={f.isActive} onChange={(e) => void action.run(async () => { await patch(`/admin/fields/${f.id}`, { isActive: e.target.checked }); await reload(); })} aria-label={t('ui.admin.active')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current && (
            <form
              className="form"
              style={{ marginTop: 16 }}
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await post(`/admin/forms/${current.id}/fields`, {
                    ...field,
                    regex: field.regex || null,
                    options: field.options.split(',').map((s) => s.trim()).filter(Boolean),
                  });
                  setField(empty);
                  await reload();
                });
              }}
            >
              <h3>{t('ui.admin.add_field')}</h3>
              <div className="form-row">
                <label>
                  key
                  <input required pattern="[A-Za-z0-9_\-]{1,64}" value={field.key} onChange={(e) => setField({ ...field, key: e.target.value })} />
                </label>
                <label>
                  {t('ui.admin.label')}
                  <input required value={field.label} onChange={(e) => setField({ ...field, label: e.target.value })} />
                </label>
                <label>
                  {t('ui.admin.type')}
                  <select value={field.type} onChange={(e) => setField({ ...field, type: e.target.value })}>
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('ui.admin.visibility')}
                  <select value={field.visibility} onChange={(e) => setField({ ...field, visibility: e.target.value })}>
                    <option value="public">{t('ui.visibility.public')}</option>
                    <option value="internal">{t('ui.visibility.internal')}</option>
                  </select>
                </label>
                {(field.type === 'select' || field.type === 'multiselect') && (
                  <label>
                    {t('ui.admin.options')}
                    <input required value={field.options} onChange={(e) => setField({ ...field, options: e.target.value })} placeholder="prod, dev" />
                  </label>
                )}
                {(field.type === 'text' || field.type === 'textarea') && (
                  <label>
                    {t('ui.admin.regex')}
                    <input value={field.regex} onChange={(e) => setField({ ...field, regex: e.target.value })} placeholder="^[A-Z0-9-]+$" />
                  </label>
                )}
              </div>
              <div className="actions">
                <label className="inline">
                  <input type="checkbox" checked={field.isRequired} onChange={(e) => setField({ ...field, isRequired: e.target.checked })} />
                  {t('ui.admin.required')}
                </label>
                <label className="inline">
                  <input type="checkbox" checked={field.isFilterable} onChange={(e) => setField({ ...field, isFilterable: e.target.checked })} />
                  {t('ui.admin.filterable')}
                </label>
                <button className="primary" disabled={action.busy}>
                  {t('ui.common.add')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}

function ApiTokensPage() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<any[]>('/admin/api-tokens'), []);
  const action = useAction();
  const [form, setForm] = useState({ name: '', write: true, read: true, expiresInDays: '' });
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <>
      <h1>{t('ui.nav.api_tokens')}</h1>
      {secret && <OneTimeSecret label={t('ui.admin.token_once')} value={secret} onClose={() => setSecret(null)} />}
      <ErrorBanner error={action.error ?? error} />
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          const scopes = [form.write && 'tickets:write', form.read && 'tickets:read'].filter(Boolean);
          void action.run(async () => {
            const res = await post('/admin/api-tokens', { name: form.name, scopes, expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null });
            setSecret(res.token);
            setForm({ name: '', write: true, read: true, expiresInDays: '' });
            await reload();
          });
        }}
      >
        <div className="form-row">
          <label>
            {t('ui.admin.token_name')}
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SOC / SIEM" />
          </label>
          <label>
            {t('ui.admin.expires_in_days')}
            <input type="number" min={1} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} />
          </label>
        </div>
        <div className="actions">
          <label className="inline">
            <input type="checkbox" checked={form.write} onChange={(e) => setForm({ ...form, write: e.target.checked })} />
            tickets:write
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.read} onChange={(e) => setForm({ ...form, read: e.target.checked })} />
            tickets:read
          </label>
          <button className="primary" disabled={action.busy || (!form.read && !form.write)}>
            {t('ui.common.add')}
          </button>
        </div>
      </form>
      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ui.admin.token_name')}</th>
                  <th>{t('ui.admin.prefix')}</th>
                  <th>{t('ui.admin.scopes')}</th>
                  <th>{t('ui.admin.expires')}</th>
                  <th>{t('ui.admin.last_used')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((tok) => (
                  <tr key={tok.id}>
                    <td>{tok.name}</td>
                    <td className="mono">td_{tok.prefix}_…</td>
                    <td className="mono small">{tok.scopes.join(', ')}</td>
                    <td>
                      <DateTime value={tok.expiresAt} />
                    </td>
                    <td>
                      <DateTime value={tok.lastUsedAt} />
                    </td>
                    <td>
                      {tok.revokedAt ? (
                        <span className="badge">{t('ui.admin.revoked')}</span>
                      ) : (
                        <button className="danger" onClick={() => void action.run(async () => { await del(`/admin/api-tokens/${tok.id}`); await reload(); })}>
                          {t('ui.admin.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function SettingsPage() {
  const { t, locales } = useI18n();
  const settings = useLoad(() => get<{ '2faEnforced': boolean }>('/admin/settings'), []);
  const glossary = useLoad(() => get<any[]>('/admin/glossary'), []);
  const action = useAction();
  const [term, setTerm] = useState({ locale: locales[0] ?? 'zh-TW', key: '', value: '' });

  return (
    <>
      <h1>{t('ui.nav.settings')}</h1>
      <ErrorBanner error={action.error ?? settings.error} />
      <div className="card">
        <h2>{t('ui.settings.security')}</h2>
        {settings.data && (
          <label className="inline">
            <input
              type="checkbox"
              checked={settings.data['2faEnforced']}
              onChange={(e) =>
                void action.run(async () => {
                  await patch('/admin/settings', { '2faEnforced': e.target.checked });
                  await settings.reload();
                })
              }
            />
            {t('ui.settings.enforce_2fa')}
          </label>
        )}
        <p className="small muted">{t('ui.settings.enforce_2fa_hint')}</p>
      </div>
      <div className="card">
        <h2>{t('ui.settings.glossary')}</h2>
        <p className="small muted">{t('ui.settings.glossary_hint')}</p>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await put('/admin/glossary', term);
              setTerm({ ...term, key: '', value: '' });
              await glossary.reload();
            });
          }}
        >
          <label>
            {t('ui.common.language')}
            <select value={term.locale} onChange={(e) => setTerm({ ...term, locale: e.target.value })}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {t(`ui.locale.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            key
            <input required value={term.key} onChange={(e) => setTerm({ ...term, key: e.target.value })} placeholder="ticket.status.open" />
          </label>
          <label>
            {t('ui.settings.value')}
            <input required value={term.value} onChange={(e) => setTerm({ ...term, value: e.target.value })} />
          </label>
          <div className="actions" style={{ alignSelf: 'end' }}>
            <button className="primary">{t('ui.common.save')}</button>
          </div>
        </form>
        {glossary.data && glossary.data.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {glossary.data.map((g) => (
                <tr key={g.id}>
                  <td>{g.locale}</td>
                  <td className="mono">{g.key}</td>
                  <td>{g.value}</td>
                  <td>
                    <button className="link" onClick={() => void action.run(async () => { await del(`/admin/glossary/${g.id}`); await glossary.reload(); })}>
                      {t('ui.common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NotificationsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<any[]>(`/admin/notifications${status ? `?status=${status}` : ''}`), [status]);
  const action = useAction();
  return (
    <>
      <h1>{t('ui.nav.notifications')}</h1>
      <ErrorBanner error={action.error ?? error} />
      <div className="card">
        <div className="filters">
          <label>
            {t('ui.tickets.status')}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('ui.common.all')}</option>
              {['pending', 'sent', 'dead', 'skipped'].map((s) => (
                <option key={s} value={s}>
                  {t(`ui.notify.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading && !data ? (
          <Loading />
        ) : !data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ui.tickets.created')}</th>
                  <th>{t('ui.notify.channel')}</th>
                  <th>{t('ui.notify.recipient')}</th>
                  <th>{t('ui.tickets.subject')}</th>
                  <th>{t('ui.tickets.status')}</th>
                  <th>{t('ui.notify.attempts')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <DateTime value={n.createdAt} />
                    </td>
                    <td>{n.channel}</td>
                    <td className="small">{n.recipient}</td>
                    <td>
                      {n.subject}
                      {n.lastError && <div className="small" style={{ color: 'var(--danger)' }}>{n.lastError}</div>}
                    </td>
                    <td>
                      <span className={`badge ${n.status === 'sent' ? 'met' : n.status === 'dead' ? 'breached' : ''}`}>{t(`ui.notify.${n.status}`)}</span>
                    </td>
                    <td className="num">{n.attempts}</td>
                    <td>
                      {(n.status === 'dead' || n.status === 'skipped') && (
                        <button className="link" onClick={() => void action.run(async () => { await post(`/admin/notifications/${n.id}/retry`); await reload(); })}>
                          {t('ui.notify.retry')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function AuditPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => get<any[]>(`/admin/audit-logs?page=${page}`), [page]);
  return (
    <>
      <h1>{t('ui.nav.audit')}</h1>
      <ErrorBanner error={error} />
      <div className="card">
        {loading && !data ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('ui.tickets.created')}</th>
                  <th>{t('ui.audit.actor')}</th>
                  <th>{t('ui.audit.action')}</th>
                  <th>{t('ui.audit.target')}</th>
                  <th>IP</th>
                  <th>{t('ui.audit.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <DateTime value={a.createdAt} />
                    </td>
                    <td className="small">{a.actorEmail ?? '—'}</td>
                    <td className="mono small">{a.action}</td>
                    <td className="small">{a.targetType ? `${a.targetType}#${a.targetId}` : '—'}</td>
                    <td className="small">{a.ip}</td>
                    <td className="mono small">{a.detail ? JSON.stringify(a.detail) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span className="small">{page}</span>
          <button disabled={(data?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      </div>
    </>
  );
}

export function AdminRoutes() {
  const { t } = useI18n();
  const { can } = useAuth();
  const teams = useOptions('/admin/teams');
  const slaPlans = useOptions('/admin/sla-plans');
  const forms = useOptions('/admin/forms');
  const topics = useOptions('/admin/help-topics');
  const yes = (v: unknown) => (v ? '✓' : '—');

  return (
    <Routes>
      {can('admin:users') && <Route path="users" element={<UsersPage />} />}
      {can('catalog:manage') && (
        <>
          <Route
            path="teams"
            element={
              <CrudPage
                title={t('ui.nav.teams')}
                path="/admin/teams"
                columns={[
                  { label: t('ui.admin.name'), render: (r: any) => r.name },
                  { label: t('ui.admin.description'), render: (r: any) => r.description },
                ]}
                fields={[
                  { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
                  { key: 'description', label: t('ui.admin.description'), type: 'textarea' },
                ]}
              />
            }
          />
          <Route
            path="sla-plans"
            element={
              <CrudPage
                title={t('ui.nav.sla_plans')}
                path="/admin/sla-plans"
                columns={[
                  { label: t('ui.admin.name'), render: (r: any) => r.name },
                  { label: t('ui.admin.first_response_minutes'), render: (r: any) => r.firstResponseMinutes },
                  { label: t('ui.admin.resolution_minutes'), render: (r: any) => r.resolutionMinutes },
                  { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
                ]}
                fields={[
                  { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
                  { key: 'firstResponseMinutes', label: t('ui.admin.first_response_minutes'), type: 'number', required: true },
                  { key: 'resolutionMinutes', label: t('ui.admin.resolution_minutes'), type: 'number', required: true },
                  { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox', createOnly: false },
                ]}
                defaults={{ isActive: true }}
              />
            }
          />
          <Route
            path="help-topics"
            element={
              <CrudPage
                title={t('ui.nav.help_topics')}
                path="/admin/help-topics"
                columns={[
                  { label: t('ui.admin.name'), render: (r: any) => r.name },
                  { label: 'slug', render: (r: any) => <span className="mono">{r.slug}</span> },
                  { label: t('ui.nav.forms'), render: (r: any) => forms.find((f) => f.value === r.formId)?.label ?? '—' },
                  { label: t('ui.nav.sla_plans'), render: (r: any) => slaPlans.find((s) => s.value === r.slaPlanId)?.label ?? '—' },
                  { label: t('ui.admin.public'), render: (r: any) => yes(r.isPublic) },
                  { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
                ]}
                fields={[
                  { key: 'slug', label: 'slug', type: 'text', required: true },
                  { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
                  { key: 'description', label: t('ui.admin.description'), type: 'textarea' },
                  { key: 'parentId', label: t('ui.admin.parent'), type: 'select', options: topics },
                  { key: 'formId', label: t('ui.nav.forms'), type: 'select', options: forms },
                  { key: 'slaPlanId', label: t('ui.nav.sla_plans'), type: 'select', options: slaPlans },
                  { key: 'defaultTeamId', label: t('ui.admin.default_team'), type: 'select', options: teams },
                  { key: 'autoTags', label: t('ui.admin.auto_tags'), type: 'tags' },
                  { key: 'isPublic', label: t('ui.admin.public'), type: 'checkbox' },
                  { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox' },
                ]}
                defaults={{ isPublic: true, isActive: true }}
              />
            }
          />
          <Route path="forms" element={<FormsPage />} />
          <Route
            path="canned-responses"
            element={
              <CrudPage
                title={t('ui.nav.canned')}
                path="/admin/canned-responses"
                columns={[
                  { label: t('ui.admin.name'), render: (r: any) => r.name },
                  { label: t('ui.admin.body'), render: (r: any) => <span className="small">{String(r.body).slice(0, 120)}</span> },
                  { label: t('ui.admin.active'), render: (r: any) => yes(r.isActive) },
                ]}
                fields={[
                  { key: 'name', label: t('ui.admin.name'), type: 'text', required: true },
                  { key: 'body', label: t('ui.admin.body_hint'), type: 'textarea', required: true },
                  { key: 'teamId', label: t('ui.tickets.team'), type: 'select', options: teams },
                  { key: 'isActive', label: t('ui.admin.active'), type: 'checkbox' },
                ]}
                defaults={{ isActive: true }}
              />
            }
          />
        </>
      )}
      {can('admin:tokens') && <Route path="api-tokens" element={<ApiTokensPage />} />}
      {can('admin:settings') && <Route path="settings" element={<SettingsPage />} />}
      {can('admin:settings') && <Route path="notifications" element={<NotificationsPage />} />}
      {can('admin:audit') && <Route path="audit" element={<AuditPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
