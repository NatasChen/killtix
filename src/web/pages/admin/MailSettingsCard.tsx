import { Alert, Button, Card, Checkbox, Col, Descriptions, Form, Input, Row } from 'antd';
import { useEffect, useState } from 'react';
import { get, post, put } from '../../api';
import { useAuth } from '../../auth';
import { Choice, ErrorBanner, Field, ToneTag, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { sectionTitle } from './shared';

type MailSettings = {
  provider: 'env' | 'smtp' | 'resend';
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPassword: boolean; passwordInvalid: boolean };
  resend: { from: string; hasApiKey: boolean; apiKeyInvalid: boolean };
  effective: 'env' | 'smtp' | 'resend' | null;
  env: { host: string; from: string };
};

export function MailSettingsCard() {
  const { t } = useI18n();
  const { user: me } = useAuth();
  const action = useAction();
  const testAction = useAction();
  const mail = useLoad(() => get<MailSettings>('/admin/settings/email'), []);
  const view = mail.data;
  const blank = { provider: 'env' as MailSettings['provider'], smtpHost: '', smtpPort: '587', smtpSecure: false, smtpUser: '', smtpPassword: '', smtpFrom: '', resendApiKey: '', resendFrom: '' };
  const [form, setForm] = useState(blank);
  const [testTo, setTestTo] = useState(me?.email ?? '');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<typeof blank>) => setForm({ ...form, ...patch });

  useEffect(() => {
    if (!view) return;
    setForm({
      provider: view.provider,
      smtpHost: view.smtp.host,
      smtpPort: String(view.smtp.port),
      smtpSecure: view.smtp.secure,
      smtpUser: view.smtp.user,
      smtpPassword: '',
      smtpFrom: view.smtp.from,
      resendApiKey: '',
      resendFrom: view.resend.from,
    });
  }, [view]);

  const save = () =>
    void action.run(async () => {
      const body: Record<string, unknown> = { provider: form.provider };
      if (form.provider === 'smtp') {
        body.smtp = {
          host: form.smtpHost,
          port: Number(form.smtpPort),
          secure: form.smtpSecure,
          user: form.smtpUser,
          from: form.smtpFrom,
          ...(form.smtpPassword ? { password: form.smtpPassword } : {}),
        };
      } else if (form.provider === 'resend') {
        body.resend = { from: form.resendFrom, ...(form.resendApiKey ? { apiKey: form.resendApiKey } : {}) };
      }
      mail.setData(await put<MailSettings>('/admin/settings/email', body));
    });

  const sendTest = () =>
    void testAction.run(async () => {
      setTestResult(null);
      const res = await post<{ ok: boolean; error?: string }>('/admin/settings/email/test', { to: testTo });
      setTestResult({ ok: res.ok, text: res.error ?? testTo });
    });

  const providerOptions = (['env', 'smtp', 'resend'] as const).map((p) => ({ value: p, label: t(`ui.settings.mail.provider.${p}`) }));
  const secretInvalid = (form.provider === 'smtp' && view?.smtp.passwordInvalid) || (form.provider === 'resend' && view?.resend.apiKeyInvalid);

  return (
    <Card title={sectionTitle(t('ui.settings.mail.title'))} style={{ marginBottom: 16 }}>
      <p className="small muted" style={{ marginTop: 0 }}>{t('ui.settings.mail.hint')}</p>
      <ErrorBanner error={action.error ?? mail.error} />
      {view && (
        <Descriptions
          size="small"
          column={1}
          style={{ marginBottom: 12 }}
          items={[
            {
              label: t('ui.settings.mail.effective'),
              children: view.effective ? <ToneTag tone="green">{t(`ui.settings.mail.provider.${view.effective}`)}</ToneTag> : <ToneTag tone="amber">{t('ui.settings.mail.effective_none')}</ToneTag>,
            },
          ]}
        />
      )}
      <Form layout="vertical" requiredMark={false} onFinish={save}>
        <Row gutter={12}>
          <Col xs={24} sm={12} lg={8}>
            <Field label={t('ui.settings.mail.provider_label')}>
              <Choice value={form.provider} onChange={(v) => set({ provider: v as MailSettings['provider'] })} options={providerOptions} />
            </Field>
          </Col>
        </Row>

        {secretInvalid && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={t('ui.settings.mail.secret_invalid')} />}

        {form.provider === 'env' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={t('ui.settings.mail.env_notice')}
            description={
              <Descriptions
                size="small"
                column={1}
                items={[
                  { label: t('ui.settings.mail.host'), children: view?.env.host || '—' },
                  { label: t('ui.settings.mail.from'), children: view?.env.from || '—' },
                ]}
              />
            }
          />
        )}

        {form.provider === 'smtp' && (
          <Row gutter={12}>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.host')} required>
                <Input required value={form.smtpHost} onChange={(e) => set({ smtpHost: e.target.value })} />
              </Field>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Field label={t('ui.settings.mail.port')} required>
                <Input required inputMode="numeric" value={form.smtpPort} onChange={(e) => set({ smtpPort: e.target.value })} />
              </Field>
            </Col>
            <Col xs={12} sm={6} lg={4}>
              <Field label={t('ui.settings.mail.secure')}>
                <Checkbox checked={form.smtpSecure} onChange={(e) => set({ smtpSecure: e.target.checked })}>
                  {t('ui.settings.mail.secure_on')}
                </Checkbox>
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.user')}>
                <Input value={form.smtpUser} autoComplete="off" onChange={(e) => set({ smtpUser: e.target.value })} />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.password')} extra={view?.smtp.hasPassword ? t('ui.settings.mail.password_set') : undefined}>
                <Input.Password value={form.smtpPassword} onChange={(e) => set({ smtpPassword: e.target.value })} autoComplete="new-password" />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.from')} required>
                <Input required value={form.smtpFrom} onChange={(e) => set({ smtpFrom: e.target.value })} placeholder="TicketDesk <no-reply@example.com>" />
              </Field>
            </Col>
          </Row>
        )}

        {form.provider === 'resend' && (
          <Row gutter={12}>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.api_key')} required={!view?.resend.hasApiKey} extra={view?.resend.hasApiKey ? t('ui.settings.mail.api_key_set') : undefined}>
                <Input.Password required={!view?.resend.hasApiKey} value={form.resendApiKey} onChange={(e) => set({ resendApiKey: e.target.value })} autoComplete="new-password" />
              </Field>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Field label={t('ui.settings.mail.from')} required>
                <Input required value={form.resendFrom} onChange={(e) => set({ resendFrom: e.target.value })} placeholder="TicketDesk <no-reply@example.com>" />
              </Field>
            </Col>
          </Row>
        )}

        <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy || !view}>
          {t('ui.common.save')}
        </Button>
      </Form>

      <section aria-label={t('ui.settings.mail.test_title')} style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('ui.settings.mail.test_title')}</h3>
        <ErrorBanner error={testAction.error} />
        <Form layout="vertical" requiredMark={false} onFinish={sendTest}>
          <Row gutter={12} align="bottom">
            <Col xs={24} sm={14} lg={8}>
              <Field label={t('ui.settings.mail.test_to')} required>
                <Input required type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </Field>
            </Col>
            <Col xs={24} sm={10} lg={6}>
              <Form.Item style={{ marginBottom: 12 }}>
                <Button htmlType="submit" loading={testAction.busy} disabled={testAction.busy}>
                  {t('ui.settings.mail.test_send')}
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {testResult && (
          <Alert
            role="status"
            type={testResult.ok ? 'success' : 'error'}
            showIcon
            title={testResult.ok ? t('ui.settings.mail.test_sent') : t('ui.settings.mail.test_failed')}
            description={testResult.text}
          />
        )}
      </section>
    </Card>
  );
}
