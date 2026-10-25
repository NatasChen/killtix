import { Alert, Button, Card, Checkbox, Col, Flex, Form, Input, Row, Table, Upload, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { del, get, patch, post, put } from '../../api';
import { useAuth } from '../../auth';
import { useBranding, type LogoUrls } from '../../branding';
import { Choice, DateTime, ErrorBanner, Field, PageHeader, ToneTag, useAction, useLoad, usePalette } from '../../components/common';
import { useI18n } from '../../i18n';
import { CrudPage } from './Crud';

const ROLES = ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user'];
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'url'];

type Opt = { id: number; name: string };
const useOptions = (path: string) => useLoad(() => get<Opt[]>(path), [path]).data?.map((o) => ({ value: o.id, label: o.name })) ?? [];
const sectionTitle = (text: string) => <h2 style={{ fontSize: 16, margin: 0 }}>{text}</h2>;
const tableProps = { rowKey: 'id', pagination: false, size: 'middle', scroll: { x: 'max-content' } } as const;

/** Shows a secret exactly once with a copy button. */
function OneTimeSecret({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const { t } = useI18n();
  const p = usePalette();
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      title={<strong>{label}</strong>}
      description={
        <>
          <div className="secret-box mono" style={{ margin: '8px 0', background: p.surface }}>
            {value}
          </div>
          <Flex gap={8}>
            <Button onClick={() => void navigator.clipboard?.writeText(value)}>{t('ui.common.copy')}</Button>
            <Button onClick={onClose}>{t('ui.common.close')}</Button>
          </Flex>
        </>
      }
    />
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
  const roles = ROLES.map((r) => ({ value: r, label: t(`ui.role.${r}`) }));

  const create = () => {
    void action.run(async () => {
      const res = await post('/admin/users', { ...form, teamId: form.teamId ? Number(form.teamId) : null });
      setSecret({ email: res.user.email, password: res.temporaryPassword });
      setForm({ email: '', displayName: '', role: 'end_user', teamId: '' });
      await reload();
    });
  };
  const update = (id: number, body: Record<string, unknown>) => action.run(async () => { await patch(`/admin/users/${id}`, body); await reload(); });

  const columns: TableColumnsType<any> = [
    {
      key: 'email',
      title: t('ui.auth.email'),
      render: (_, u) => (
        <>
          {u.displayName}
          <div className="small muted">{u.email}</div>
          {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <ToneTag tone="red">{t('ui.admin.locked')}</ToneTag>}
        </>
      ),
    },
    {
      key: 'role',
      title: t('ui.admin.role'),
      render: (_, u) => (
        <Choice aria-label={t('ui.admin.role')} value={u.role} disabled={u.id === me?.id} onChange={(v) => void update(u.id, { role: v })} options={roles} />
      ),
    },
    {
      key: 'team',
      title: t('ui.tickets.team'),
      render: (_, u) => (
        <Choice
          aria-label={t('ui.tickets.team')}
          value={u.teamId ?? ''}
          onChange={(v) => void update(u.id, { teamId: v ? Number(v) : null })}
          empty="—"
          options={teams}
        />
      ),
    },
    { key: '2fa', title: '2FA', render: (_, u) => (u.twoFactorEnabled ? '✓' : '—') },
    { key: 'last_login', title: t('ui.admin.last_login'), className: 'nowrap', render: (_, u) => <DateTime value={u.lastLoginAt} /> },
    {
      key: 'active',
      title: t('ui.admin.active'),
      render: (_, u) => (
        <Checkbox checked={u.isActive} disabled={u.id === me?.id} onChange={(e) => void update(u.id, { isActive: e.target.checked })} aria-label={t('ui.admin.active')} />
      ),
    },
    {
      key: 'actions',
      title: '',
      className: 'nowrap',
      render: (_, u) => (
        <Flex gap={4}>
          <Button
            type="link"
            onClick={() =>
              void action.run(async () => {
                const res = await post(`/admin/users/${u.id}/reset-password`);
                setSecret({ email: u.email, password: res.temporaryPassword });
              })
            }
          >
            {t('ui.admin.reset_password')}
          </Button>
          {u.twoFactorEnabled && (
            <Button type="link" onClick={() => void action.run(async () => { await post(`/admin/users/${u.id}/reset-2fa`); await reload(); })}>
              {t('ui.admin.reset_2fa')}
            </Button>
          )}
          {u.lockedUntil && (
            <Button type="link" onClick={() => void action.run(async () => { await post(`/admin/users/${u.id}/unlock`); await reload(); })}>
              {t('ui.admin.unlock')}
            </Button>
          )}
        </Flex>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.users')} />
      {secret && (
        <OneTimeSecret label={t('ui.admin.temp_password_for', { email: secret.email })} value={secret.password} onClose={() => setSecret(null)} />
      )}
      <ErrorBanner error={action.error} />
      <Card title={sectionTitle(t('ui.admin.create_user'))} style={{ marginBottom: 16 }}>
        <Form layout="vertical" requiredMark={false} onFinish={create}>
          <Row gutter={12}>
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.auth.email')}>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.profile.display_name')}>
                <Input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.admin.role')}>
                <Choice value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={roles} style={{ width: '100%' }} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.tickets.team')}>
                <Choice value={form.teamId} onChange={(v) => setForm({ ...form, teamId: v })} empty="—" options={teams} style={{ width: '100%' }} />
              </Field>
            </Col>
          </Row>
          <p className="small muted">{t('ui.admin.create_user_hint')}</p>
          <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
            {t('ui.common.add')}
          </Button>
        </Form>
      </Card>
      <Card>
        <Form layout="vertical" style={{ maxWidth: 260 }}>
          <Field label={t('ui.tickets.search')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </Form>
        <ErrorBanner error={error} />
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
      </Card>
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
  const toggle = (id: number, key: string) => (e: { target: { checked: boolean } }) =>
    void action.run(async () => { await patch(`/admin/fields/${id}`, { [key]: e.target.checked }); await reload(); });

  const columns: TableColumnsType<any> = [
    { key: 'key', title: 'key', className: 'mono', render: (_, f) => f.key },
    {
      key: 'label',
      title: t('ui.admin.label'),
      render: (_, f) => (
        <>
          {f.label}
          {f.options?.length > 0 && <div className="small muted">{f.options.join(', ')}</div>}
        </>
      ),
    },
    { key: 'type', title: t('ui.admin.type'), render: (_, f) => f.type },
    { key: 'required', title: t('ui.admin.required'), render: (_, f) => <Checkbox checked={f.isRequired} onChange={toggle(f.id, 'isRequired')} aria-label={t('ui.admin.required')} /> },
    { key: 'visibility', title: t('ui.admin.visibility'), render: (_, f) => t(`ui.visibility.${f.visibility}`) },
    { key: 'filterable', title: t('ui.admin.filterable'), render: (_, f) => <Checkbox checked={f.isFilterable} onChange={toggle(f.id, 'isFilterable')} aria-label={t('ui.admin.filterable')} /> },
    { key: 'active', title: t('ui.admin.active'), render: (_, f) => <Checkbox checked={f.isActive} onChange={toggle(f.id, 'isActive')} aria-label={t('ui.admin.active')} /> },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.forms')} />
      <ErrorBanner error={action.error ?? error} />
      <Card style={{ marginBottom: 16 }}>
        <Form
          onFinish={() =>
            void action.run(async () => {
              const created = await post('/admin/forms', { name: formName });
              setFormName('');
              setSelected(created.id);
              await reload();
            })
          }
        >
          <Flex gap={8} wrap>
            <Input required placeholder={t('ui.admin.form_name')} value={formName} onChange={(e) => setFormName(e.target.value)} aria-label={t('ui.admin.form_name')} style={{ maxWidth: 320 }} />
            <Button type="primary" htmlType="submit">
              {t('ui.admin.add_form')}
            </Button>
          </Flex>
        </Form>
      </Card>
      <Card loading={loading && !data}>
        {data && data.length > 0 && (
          <>
            <Flex gap={8} wrap style={{ marginBottom: 12 }}>
              {data.map((f) => (
                <Button key={f.id} type={f.id === current?.id ? 'primary' : 'default'} onClick={() => setSelected(f.id)}>
                  {f.name}
                </Button>
              ))}
            </Flex>
            <p className="small muted">{t('ui.admin.form_hint')}</p>
          </>
        )}
        <Table {...tableProps} columns={columns} dataSource={current?.fields ?? []} />
        {current && (
          <Form
            layout="vertical"
            requiredMark={false}
            style={{ marginTop: 16 }}
            onFinish={() =>
              void action.run(async () => {
                await post(`/admin/forms/${current.id}/fields`, {
                  ...field,
                  regex: field.regex || null,
                  options: field.options.split(',').map((x) => x.trim()).filter(Boolean),
                });
                setField(empty);
                await reload();
              })
            }
          >
            <h3>{t('ui.admin.add_field')}</h3>
            <Row gutter={12}>
              <Col xs={24} sm={12} lg={6}>
                <Field label="key">
                  <Input required pattern="[A-Za-z0-9_\-]{1,64}" value={field.key} onChange={(e) => setField({ ...field, key: e.target.value })} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.label')}>
                  <Input required value={field.label} onChange={(e) => setField({ ...field, label: e.target.value })} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.type')}>
                  <Choice value={field.type} onChange={(v) => setField({ ...field, type: v })} options={FIELD_TYPES.map((ft) => ({ value: ft, label: ft }))} style={{ width: '100%' }} />
                </Field>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Field label={t('ui.admin.visibility')}>
                  <Choice
                    value={field.visibility}
                    onChange={(v) => setField({ ...field, visibility: v })}
                    options={[
                      { value: 'public', label: t('ui.visibility.public') },
                      { value: 'internal', label: t('ui.visibility.internal') },
                    ]}
                    style={{ width: '100%' }}
                  />
                </Field>
              </Col>
              {(field.type === 'select' || field.type === 'multiselect') && (
                <Col xs={24} sm={12} lg={6}>
                  <Field label={t('ui.admin.options')}>
                    <Input required value={field.options} onChange={(e) => setField({ ...field, options: e.target.value })} placeholder="prod, dev" />
                  </Field>
                </Col>
              )}
              {(field.type === 'text' || field.type === 'textarea') && (
                <Col xs={24} sm={12} lg={6}>
                  <Field label={t('ui.admin.regex')}>
                    <Input value={field.regex} onChange={(e) => setField({ ...field, regex: e.target.value })} placeholder="^[A-Z0-9-]+$" />
                  </Field>
                </Col>
              )}
            </Row>
            <Flex gap={16} align="center" wrap>
              <Checkbox checked={field.isRequired} onChange={(e) => setField({ ...field, isRequired: e.target.checked })}>
                {t('ui.admin.required')}
              </Checkbox>
              <Checkbox checked={field.isFilterable} onChange={(e) => setField({ ...field, isFilterable: e.target.checked })}>
                {t('ui.admin.filterable')}
              </Checkbox>
              <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy}>
                {t('ui.common.add')}
              </Button>
            </Flex>
          </Form>
        )}
      </Card>
    </>
  );
}

function ApiTokensPage() {
  const { t } = useI18n();
  const { data, error, loading, reload } = useLoad(() => get<any[]>('/admin/api-tokens'), []);
  const action = useAction();
  const [form, setForm] = useState({ name: '', write: true, read: true, expiresInDays: '' });
  const [secret, setSecret] = useState<string | null>(null);

  const columns: TableColumnsType<any> = [
    { key: 'name', title: t('ui.admin.token_name'), render: (_, tok) => tok.name },
    { key: 'prefix', title: t('ui.admin.prefix'), className: 'mono', render: (_, tok) => `td_${tok.prefix}_…` },
    { key: 'scopes', title: t('ui.admin.scopes'), className: 'mono small', render: (_, tok) => tok.scopes.join(', ') },
    { key: 'expires', title: t('ui.admin.expires'), render: (_, tok) => <DateTime value={tok.expiresAt} /> },
    { key: 'last_used', title: t('ui.admin.last_used'), render: (_, tok) => <DateTime value={tok.lastUsedAt} /> },
    {
      key: 'revoke',
      title: '',
      render: (_, tok) =>
        tok.revokedAt ? (
          <ToneTag tone="grey">{t('ui.admin.revoked')}</ToneTag>
        ) : (
          <Button danger onClick={() => void action.run(async () => { await del(`/admin/api-tokens/${tok.id}`); await reload(); })}>
            {t('ui.admin.revoke')}
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.api_tokens')} />
      {secret && <OneTimeSecret label={t('ui.admin.token_once')} value={secret} onClose={() => setSecret(null)} />}
      <ErrorBanner error={action.error ?? error} />
      <Card style={{ marginBottom: 16 }}>
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={() => {
            const scopes = [form.write && 'tickets:write', form.read && 'tickets:read'].filter(Boolean);
            void action.run(async () => {
              const res = await post('/admin/api-tokens', { name: form.name, scopes, expiresInDays: form.expiresInDays ? Number(form.expiresInDays) : null });
              setSecret(res.token);
              setForm({ name: '', write: true, read: true, expiresInDays: '' });
              await reload();
            });
          }}
        >
          <Row gutter={12}>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.admin.token_name')}>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SOC / SIEM" />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.admin.expires_in_days')}>
                <Input type="number" min={1} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} />
              </Field>
            </Col>
          </Row>
          <Flex gap={16} align="center" wrap>
            <Checkbox checked={form.write} onChange={(e) => setForm({ ...form, write: e.target.checked })}>
              tickets:write
            </Checkbox>
            <Checkbox checked={form.read} onChange={(e) => setForm({ ...form, read: e.target.checked })}>
              tickets:read
            </Checkbox>
            <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy || (!form.read && !form.write)}>
              {t('ui.common.add')}
            </Button>
          </Flex>
        </Form>
      </Card>
      <Card>
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
      </Card>
    </>
  );
}

/** Company logo upload (PNG, checked on the server); the dark-background logo is optional. */
function LogoSettings() {
  const { t } = useI18n();
  const p = usePalette();
  const { logo, setLogo } = useBranding();
  const action = useAction();
  const [active, setActive] = useState<keyof LogoUrls>(); // the variant being uploaded, for its button's spinner
  const upload = (variant: keyof LogoUrls, file: File) =>
    void action.run(async () => {
      setActive(variant);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      setLogo((await put<{ logo: LogoUrls }>(`/admin/branding/logo/${variant}`, { data })).logo);
    });
  const remove = (variant: keyof LogoUrls) =>
    void action.run(async () => setLogo((await del<{ logo: LogoUrls }>(`/admin/branding/logo/${variant}`)).logo));

  const variants = [
    { key: 'light' as const, label: t('ui.settings.logo_light'), bg: p.surface, hint: undefined },
    { key: 'dark' as const, label: t('ui.settings.logo_dark'), bg: p.nav.bg, hint: t('ui.settings.logo_dark_hint') },
  ];
  return (
    <Card title={sectionTitle(t('ui.settings.logo'))} style={{ marginBottom: 16 }}>
      <p className="small muted" style={{ marginTop: 0 }}>{t('ui.settings.logo_hint')}</p>
      <ErrorBanner error={action.error} />
      <Row gutter={[16, 16]}>
        {variants.map((v) => (
          <Col key={v.key} xs={24} md={12}>
            <section aria-label={v.label}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{v.label}</h3>
              {/* preview on the background the logo will sit on */}
              <div className="logo-preview" style={{ background: v.bg, borderColor: p.hairline }}>
                {logo[v.key] ? (
                  <img className="brand-logo" src={logo[v.key]!} alt={v.label} />
                ) : (
                  <span className="small" style={{ color: v.key === 'dark' ? p.nav.muted : p.ink3 }}>{t('ui.settings.logo_none')}</span>
                )}
              </div>
              {v.hint && <p className="small muted">{v.hint}</p>}
              <Flex gap={8} style={{ marginTop: 8 }}>
                <Upload
                  accept="image/png"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    upload(v.key, file);
                    return false; // we send it ourselves as JSON
                  }}
                >
                  <Button loading={action.busy && active === v.key} disabled={action.busy}>
                    {t('ui.settings.logo_upload')}
                  </Button>
                </Upload>
                {logo[v.key] && (
                  <Button disabled={action.busy} onClick={() => remove(v.key)}>
                    {t('ui.common.remove')}
                  </Button>
                )}
              </Flex>
            </section>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

function SettingsPage() {
  const { t, locales } = useI18n();
  const settings = useLoad(() => get<{ '2faEnforced': boolean }>('/admin/settings'), []);
  const glossary = useLoad(() => get<any[]>('/admin/glossary'), []);
  const action = useAction();
  const [term, setTerm] = useState({ locale: locales[0] ?? 'zh-TW', key: '', value: '' });

  const columns: TableColumnsType<any> = [
    { key: 'locale', title: t('ui.common.language'), render: (_, g) => g.locale },
    { key: 'key', title: 'key', className: 'mono', render: (_, g) => g.key },
    { key: 'value', title: t('ui.settings.value'), render: (_, g) => g.value },
    {
      key: 'remove',
      title: '',
      render: (_, g) => (
        <Button type="link" onClick={() => void action.run(async () => { await del(`/admin/glossary/${g.id}`); await glossary.reload(); })}>
          {t('ui.common.remove')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('ui.nav.settings')} />
      <ErrorBanner error={action.error ?? settings.error} />
      <Card title={sectionTitle(t('ui.settings.security'))} style={{ marginBottom: 16 }}>
        {settings.data && (
          <Checkbox
            checked={settings.data['2faEnforced']}
            onChange={(e) =>
              void action.run(async () => {
                await patch('/admin/settings', { '2faEnforced': e.target.checked });
                await settings.reload();
              })
            }
          >
            {t('ui.settings.enforce_2fa')}
          </Checkbox>
        )}
        <p className="small muted">{t('ui.settings.enforce_2fa_hint')}</p>
      </Card>
      <LogoSettings />
      <Card title={sectionTitle(t('ui.settings.glossary'))}>
        <p className="small muted">{t('ui.settings.glossary_hint')}</p>
        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={() =>
            void action.run(async () => {
              await put('/admin/glossary', term);
              setTerm({ ...term, key: '', value: '' });
              await glossary.reload();
            })
          }
        >
          <Row gutter={12} align="bottom">
            <Col xs={24} sm={12} lg={6}>
              <Field label={t('ui.common.language')}>
                <Choice
                  value={term.locale}
                  onChange={(v) => setTerm({ ...term, locale: v })}
                  options={locales.map((l) => ({ value: l, label: t(`ui.locale.${l}`) }))}
                  style={{ width: '100%' }}
                />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Field label="key">
                <Input required value={term.key} onChange={(e) => setTerm({ ...term, key: e.target.value })} placeholder="ticket.status.open" />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.value')}>
                <Input required value={term.value} onChange={(e) => setTerm({ ...term, value: e.target.value })} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={4}>
              <Form.Item style={{ marginBottom: 12 }}>
                <Button type="primary" htmlType="submit">
                  {t('ui.common.save')}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {glossary.data && glossary.data.length > 0 && <Table {...tableProps} columns={columns} dataSource={glossary.data} />}
      </Card>
    </>
  );
}

function NotificationsPage() {
  const { t } = useI18n();
  const p = usePalette();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<any[]>(`/admin/notifications${status ? `?status=${status}` : ''}`), [status]);
  const action = useAction();
  const columns: TableColumnsType<any> = [
    { key: 'created', title: t('ui.tickets.created'), className: 'nowrap', render: (_, n) => <DateTime value={n.createdAt} /> },
    { key: 'channel', title: t('ui.notify.channel'), render: (_, n) => n.channel },
    { key: 'recipient', title: t('ui.notify.recipient'), className: 'small', render: (_, n) => n.recipient },
    {
      key: 'subject',
      title: t('ui.tickets.subject'),
      render: (_, n) => (
        <>
          {n.subject}
          {n.lastError && (
            <div className="small" style={{ color: p.danger }}>
              {n.lastError}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'status',
      title: t('ui.tickets.status'),
      render: (_, n) => <ToneTag tone={n.status === 'sent' ? 'green' : n.status === 'dead' ? 'red' : 'grey'}>{t(`ui.notify.${n.status}`)}</ToneTag>,
    },
    { key: 'attempts', title: t('ui.notify.attempts'), className: 'num', render: (_, n) => n.attempts },
    {
      key: 'retry',
      title: '',
      render: (_, n) =>
        (n.status === 'dead' || n.status === 'skipped') && (
          <Button type="link" onClick={() => void action.run(async () => { await post(`/admin/notifications/${n.id}/retry`); await reload(); })}>
            {t('ui.notify.retry')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title={t('ui.nav.notifications')} />
      <ErrorBanner error={action.error ?? error} />
      <Card>
        <Form layout="vertical" style={{ maxWidth: 260 }}>
          <Field label={t('ui.tickets.status')}>
            <Choice
              value={status}
              onChange={setStatus}
              empty={t('ui.common.all')}
              options={['pending', 'sent', 'dead', 'skipped'].map((x) => ({ value: x, label: t(`ui.notify.${x}`) }))}
              style={{ width: '100%' }}
            />
          </Field>
        </Form>
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
      </Card>
    </>
  );
}

function AuditPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => get<any[]>(`/admin/audit-logs?page=${page}`), [page]);
  const columns: TableColumnsType<any> = [
    { key: 'created', title: t('ui.tickets.created'), className: 'nowrap', render: (_, a) => <DateTime value={a.createdAt} /> },
    { key: 'actor', title: t('ui.audit.actor'), className: 'small', render: (_, a) => a.actorEmail ?? '—' },
    { key: 'action', title: t('ui.audit.action'), className: 'mono small', render: (_, a) => a.action },
    { key: 'target', title: t('ui.audit.target'), className: 'small', render: (_, a) => (a.targetType ? `${a.targetType}#${a.targetId}` : '—') },
    { key: 'ip', title: 'IP', className: 'small', render: (_, a) => a.ip },
    { key: 'detail', title: t('ui.audit.detail'), className: 'mono small', render: (_, a) => (a.detail ? JSON.stringify(a.detail) : '') },
  ];
  return (
    <>
      <PageHeader title={t('ui.nav.audit')} />
      <ErrorBanner error={error} />
      <Card>
        <Table {...tableProps} columns={columns} dataSource={data ?? []} loading={loading && !data} />
        {/* the audit API pages by 100 rows and returns no total, so the pager only steps back and forth */}
        <Flex justify="flex-end" align="center" gap={8} style={{ marginTop: 12 }}>
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </Button>
          <span className="small">{page}</span>
          <Button disabled={(data?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>
            ›
          </Button>
        </Flex>
      </Card>
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
