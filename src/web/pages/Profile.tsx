import { useState, type FormEvent } from 'react';
import { patch, post } from '../api';
import { useAuth } from '../auth';
import { ErrorBanner, useAction } from '../components/common';
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

  const saveProfile = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void profile.run(async () => {
      await patch('/auth/me', { displayName, telegramChatId: telegramChatId || null });
      await refresh();
      setSaved(true);
    });
  };

  return (
    <>
      <h1>{t('ui.nav.profile')}</h1>
      <div className="grid grid-2">
        <form className="card form" onSubmit={saveProfile}>
          <h2>{t('ui.profile.details')}</h2>
          <ErrorBanner error={profile.error} />
          {saved && <div className="banner success">{t('ui.common.saved')}</div>}
          <label>
            {t('ui.auth.email')}
            <input value={user.email} disabled />
          </label>
          <label>
            {t('ui.profile.display_name')}
            <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            {t('ui.profile.telegram_chat_id')}
            <input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} inputMode="numeric" />
            <span className="small">{t('ui.profile.telegram_hint')}</span>
          </label>
          <div className="actions">
            <button className="primary" disabled={profile.busy}>
              {t('ui.common.save')}
            </button>
          </div>
        </form>

        <div className="card">
          <h2>{t('ui.password.title')}</h2>
          {passwordChanged && <div className="banner success">{t('ui.password.changed')}</div>}
          <PasswordForm
            onDone={() => {
              setPasswordChanged(true);
              void refresh();
            }}
          />
        </div>

        <div className="card">
          <h2>{t('ui.mfa.title')}</h2>
          <ErrorBanner error={mfa.error} />
          {user.twoFactorEnabled ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void mfa.run(async () => {
                  await post('/auth/2fa/disable', disable);
                  setDisable({ password: '', code: '' });
                  await refresh();
                });
              }}
            >
              <div className="banner success">{t('ui.mfa.status_on')}</div>
              <label>
                {t('ui.auth.password')}
                <input type="password" required value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
              </label>
              <label>
                {t('ui.mfa.code')}
                <input required inputMode="numeric" value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} />
              </label>
              <div className="actions">
                <button className="danger" disabled={mfa.busy}>
                  {t('ui.mfa.disable')}
                </button>
              </div>
            </form>
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
              <button className="primary" onClick={() => setEnrolling(true)}>
                {t('ui.mfa.enable')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
