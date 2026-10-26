import { Button, Card, Checkbox, Col, Flex, Form, Input, Row, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { get, patch, post } from '../../api';
import { useAuth } from '../../auth';
import { Choice, DateTime, ErrorBanner, Field, MultiChoice, PageHeader, ToneTag, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { OneTimeSecret, useOptions, sectionTitle, tableProps } from './shared';

const ROLES = ['super_admin', 'it_manager', 'agent', 'vendor', 'end_user'];

export function UsersPage() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => get<any[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  const teams = useOptions('/admin/teams');
  const action = useAction();
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'end_user', teamIds: [] as number[] });
  const roles = ROLES.map((r) => ({ value: r, label: t(`ui.role.${r}`) }));

  const create = () => {
    void action.run(async () => {
      const res = await post('/admin/users', form);
      setSecret({ email: res.user.email, password: res.temporaryPassword });
      setForm({ email: '', displayName: '', role: 'end_user', teamIds: [] });
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
        <MultiChoice
          aria-label={t('ui.tickets.team')}
          value={u.teamIds ?? []}
          onChange={(v) => void update(u.id, { teamIds: v })}
          placeholder="—"
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
                <MultiChoice value={form.teamIds} onChange={(v) => setForm({ ...form, teamIds: v })} options={teams} style={{ width: '100%' }} />
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
