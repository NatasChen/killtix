import { Button, Card, Checkbox, Col, Flex, Form, Input, Row, Table, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { del, get, post } from '../../api';
import { DateTime, ErrorBanner, Field, PageHeader, ToneTag, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { OneTimeSecret, tableProps } from './shared';

export function ApiTokensPage() {
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
