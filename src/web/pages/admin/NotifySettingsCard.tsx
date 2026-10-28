import { Alert, Button, Card, Col, Form, Input, Row, Space, Switch } from 'antd';
import { useState } from 'react';
import { get, patch, put } from '../../api';
import { ErrorBanner, Field, ToneTag, useAction, useLoad } from '../../components/common';
import { useI18n } from '../../i18n';
import { sectionTitle } from './shared';

type Channels = {
  telegram: { hasBotToken: boolean; botTokenInvalid: boolean };
  teams: { hasWebhookUrl: boolean; webhookUrlInvalid: boolean };
};

/** Master switch plus the Telegram and Teams channels; e-mail has its own card (MailSettingsCard). DECISIONS D13. */
export function NotifySettingsCard() {
  const { t } = useI18n();
  const action = useAction();
  const settings = useLoad(() => get<{ notificationsEnabled: boolean }>('/admin/settings'), []);
  const channels = useLoad(() => get<Channels>('/admin/settings/channels'), []);
  const view = channels.data;
  const [form, setForm] = useState({ botToken: '', webhookUrl: '' });

  const saveChannels = (body: Record<string, unknown>) =>
    void action.run(async () => {
      channels.setData(await put<Channels>('/admin/settings/channels', body));
      setForm({ botToken: '', webhookUrl: '' });
    });
  const save = () =>
    saveChannels({
      ...(form.botToken ? { telegram: { botToken: form.botToken } } : {}),
      ...(form.webhookUrl ? { teams: { webhookUrl: form.webhookUrl } } : {}),
    });
  const status = (configured: boolean | undefined) =>
    configured ? <ToneTag tone="green">{t('ui.settings.notify.configured')}</ToneTag> : <ToneTag tone="amber">{t('ui.settings.notify.not_configured')}</ToneTag>;
  const invalid = view?.telegram.botTokenInvalid || view?.teams.webhookUrlInvalid;

  return (
    <Card title={sectionTitle(t('ui.settings.notify.title'))} style={{ marginBottom: 16 }}>
      <p className="small muted" style={{ marginTop: 0 }}>{t('ui.settings.notify.hint')}</p>
      <ErrorBanner error={action.error ?? settings.error ?? channels.error} />
      {settings.data && (
        <Form layout="vertical" requiredMark={false}>
          <Field label={t('ui.settings.notify.enabled')} extra={t('ui.settings.notify.enabled_hint')}>
            <Switch
              checked={settings.data.notificationsEnabled}
              loading={action.busy}
              onChange={(on) =>
                void action.run(async () => {
                  settings.setData(await patch<{ notificationsEnabled: boolean }>('/admin/settings', { notificationsEnabled: on }));
                })
              }
            />
          </Field>
        </Form>
      )}

      {invalid && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={t('ui.settings.notify.secret_invalid')} />}
      <Form layout="vertical" requiredMark={false} onFinish={save}>
        <Row gutter={12}>
          <Col xs={24} lg={12}>
            <Field
              label={
                <Space size={8}>
                  {t('ui.settings.notify.telegram_token')}
                  {status(view?.telegram.hasBotToken)}
                </Space>
              }
              extra={view?.telegram.hasBotToken ? t('ui.settings.notify.secret_set') : t('ui.settings.notify.telegram_hint')}>
              <Input.Password value={form.botToken} onChange={(e) => setForm({ ...form, botToken: e.target.value })} autoComplete="new-password" />
            </Field>
          </Col>
          <Col xs={24} lg={12}>
            <Field
              label={
                <Space size={8}>
                  {t('ui.settings.notify.teams_webhook')}
                  {status(view?.teams.hasWebhookUrl)}
                </Space>
              }
              extra={view?.teams.hasWebhookUrl ? t('ui.settings.notify.secret_set') : t('ui.settings.notify.teams_hint')}>
              <Input.Password value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} autoComplete="new-password" />
            </Field>
          </Col>
        </Row>
        <Space wrap>
          <Button type="primary" htmlType="submit" loading={action.busy} disabled={action.busy || !view || (!form.botToken && !form.webhookUrl)}>
            {t('ui.common.save')}
          </Button>
          {view?.telegram.hasBotToken && (
            <Button disabled={action.busy} onClick={() => saveChannels({ telegram: { botToken: null } })}>
              {t('ui.settings.notify.remove_telegram')}
            </Button>
          )}
          {view?.teams.hasWebhookUrl && (
            <Button disabled={action.busy} onClick={() => saveChannels({ teams: { webhookUrl: null } })}>
              {t('ui.settings.notify.remove_teams')}
            </Button>
          )}
        </Space>
      </Form>
    </Card>
  );
}
