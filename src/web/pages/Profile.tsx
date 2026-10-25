import { Alert, Button, Card, Col, Form, Input, Row } from 'antd';
import { useState } from 'react';
import { patch, post } from '../api';
import { useAuth } from '../auth';
import { ErrorBanner, Field, PageHeader, useAction } from '../components/common';
import { useI18n } from '../i18n';
import { MfaSetup, PasswordForm } from './AuthPages';

export function ProfilePage() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const profile = useAction();
  const mfa = useAction();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [telegramChatId, setTelegramChatId] = useState(user?.telegramChatId ?? '');
  const [saved, setSaved] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [disable, setDisable] = useState({ password: '', code: '' });

  if (!user) return null;

  const saveProfile = () => {
    setSaved(false);
    void profile.run(async () => {
      await patch('/auth/me', { displayName, telegramChatId: telegramChatId || null });
      await refresh();
      setSaved(true);
    });
  };

  const title = (key: string) => <h2 style={{ fontSize: 16, margin: 0 }}>{t(key)}</h2>;

  return (
    <>
      <PageHeader title={t('ui.nav.profile')} />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={title('ui.profile.details')}>
            <Form layout="vertical" requiredMark={false} onFinish={saveProfile}>
              <ErrorBanner error={profile.error} />
              {saved && <Alert type="success" showIcon title={t('ui.common.saved')} style={{ marginBottom: 12 }} />}
              <Field label={t('ui.auth.email')}>
                <Input value={user.email} disabled />
              </Field>
              <Field label={t('ui.profile.display_name')}>
                <Input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              <Field label={t('ui.profile.telegram_chat_id')} extra={t('ui.profile.telegram_hint')}>
                <Input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} inputMode="numeric" />
              </Field>
              <Button type="primary" htmlType="submit" loading={profile.busy} disabled={profile.busy}>
                {t('ui.common.save')}
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={title('ui.password.title')}>
            {passwordChanged && <Alert type="success" showIcon title={t('ui.password.changed')} style={{ marginBottom: 12 }} />}
            <PasswordForm
              onDone={() => {
                setPasswordChanged(true);
                void refresh();
              }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={title('ui.mfa.title')}>
            <ErrorBanner error={mfa.error} />
            {user.twoFactorEnabled ? (
              <Form
                layout="vertical"
                requiredMark={false}
                onFinish={() =>
                  void mfa.run(async () => {
                    await post('/auth/2fa/disable', disable);
                    setDisable({ password: '', code: '' });
                    await refresh();
                  })
                }
              >
                <Alert type="success" showIcon title={t('ui.mfa.status_on')} style={{ marginBottom: 12 }} />
                <Field label={t('ui.auth.password')}>
                  <Input type="password" required value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
                </Field>
                <Field label={t('ui.mfa.code')}>
                  <Input required inputMode="numeric" value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} />
                </Field>
                <Button danger htmlType="submit" loading={mfa.busy} disabled={mfa.busy}>
                  {t('ui.mfa.disable')}
                </Button>
              </Form>
            ) : enrolling ? (
              <MfaSetup
                onDone={() => {
                  setEnrolling(false);
                  void refresh();
                }}
              />
            ) : (
              <>
                <p className="muted">{t('ui.mfa.status_off')}</p>
                <Button type="primary" onClick={() => setEnrolling(true)}>
                  {t('ui.mfa.enable')}
                </Button>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
