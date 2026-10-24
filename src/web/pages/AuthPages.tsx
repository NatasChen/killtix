import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { post } from '../api';
import { useAuth, type Me, type Stage } from '../auth';
import { ErrorBanner, useAction } from '../components/common';
import { useI18n } from '../i18n';

type SessionResponse = { stage: Stage; user: Me };

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card ex-auth-form-card">
        <div className="brand">
          <img src="/favicon.svg" width={24} height={24} alt="" /> TicketDesk
        </div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { setSession } = useAuth();
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await post<SessionResponse>('/auth/login', { email, password });
      setSession(res.stage, res.user);
    });
  };

  return (
    <AuthCard title={t('ui.auth.login_title')}>
      <ErrorBanner error={error} />
      <form className="form" onSubmit={submit}>
        <label>
          {t('ui.auth.email')}
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          {t('ui.auth.password')}
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy}>
          {t('ui.auth.login')}
        </button>
      </form>
    </AuthCard>
  );
}

export function PasswordForm({ onDone }: { onDone: (res: SessionResponse) => void }) {
  const { t } = useI18n();
  const { busy, error, setError, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError(new Error(t('ui.password.mismatch')));
      return;
    }
    void run(async () => onDone(await post<SessionResponse>('/auth/change-password', { currentPassword: current, newPassword: next })));
  };

  return (
    <form className="form" onSubmit={submit}>
      <ErrorBanner error={error} />
      <label>
        {t('ui.password.current')}
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        {t('ui.password.new')}
        <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label>
        {t('ui.password.confirm')}
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <p className="small muted">{t('ui.password.policy')}</p>
      <button className="primary" disabled={busy}>
        {t('ui.password.submit')}
      </button>
    </form>
  );
}

export function ChangePasswordPage() {
  const { t } = useI18n();
  const { user, setSession, logout } = useAuth();
  return (
    <AuthCard title={t('ui.password.title')}>
      <div className="banner warning">{user?.isBootstrapAdmin ? t('ui.password.bootstrap_notice') : t('ui.password.must_change')}</div>
      <PasswordForm onDone={(res) => setSession(res.stage, res.user)} />
      <p>
        <button className="link" onClick={() => void logout()}>
          {t('ui.auth.logout')}
        </button>
      </p>
    </AuthCard>
  );
}

export function MfaVerifyPage() {
  const { t } = useI18n();
  const { setSession, logout } = useAuth();
  const { busy, error, run } = useAction();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await post<SessionResponse>('/auth/2fa/verify', useRecovery ? { recoveryCode: code } : { code });
      setSession(res.stage, res.user);
    });
  };

  return (
    <AuthCard title={t('ui.mfa.verify_title')}>
      <ErrorBanner error={error} />
      <form className="form" onSubmit={submit}>
        <label>
          {useRecovery ? t('ui.mfa.recovery_code') : t('ui.mfa.code')}
          <input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy}>
          {t('ui.mfa.verify')}
        </button>
      </form>
      <p className="actions">
        <button className="link" onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? t('ui.mfa.use_app') : t('ui.mfa.use_recovery')}
        </button>
        <button className="link" onClick={() => void logout()}>
          {t('ui.auth.logout')}
        </button>
      </p>
    </AuthCard>
  );
}

/** TOTP enrolment, used both for enforced enrolment and from the profile page. */
export function MfaSetup({ onDone }: { onDone: (res: SessionResponse) => void }) {
  const { t } = useI18n();
  const { busy, error, run } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<{ codes: string[]; res: SessionResponse } | null>(null);

  useEffect(() => {
    void run(async () => setSetup(await post('/auth/2fa/setup')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recovery) {
    return (
      <div className="form">
        <div className="banner success">{t('ui.mfa.enabled')}</div>
        <p>{t('ui.mfa.recovery_hint')}</p>
        <div className="codes mono">
          {recovery.codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <button className="primary" onClick={() => onDone(recovery.res)}>
          {t('ui.mfa.recovery_saved')}
        </button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await post<SessionResponse & { recoveryCodes: string[] }>('/auth/2fa/enable', { code });
      setRecovery({ codes: res.recoveryCodes, res });
    });
  };

  return (
    <form className="form" onSubmit={submit}>
      <ErrorBanner error={error} />
      <p>{t('ui.mfa.scan')}</p>
      {setup && (
        <>
          <img className="qr" src={setup.qrDataUrl} alt={t('ui.mfa.qr_alt')} />
          <div className="secret-box mono small">{setup.secret}</div>
        </>
      )}
      <label>
        {t('ui.mfa.code')}
        <input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button className="primary" disabled={busy || !setup}>
        {t('ui.mfa.enable')}
      </button>
    </form>
  );
}

export function MfaEnrollPage() {
  const { t } = useI18n();
  const { setSession, logout } = useAuth();
  return (
    <AuthCard title={t('ui.mfa.enroll_title')}>
      <div className="banner warning">{t('ui.mfa.enforced_notice')}</div>
      <MfaSetup onDone={(res) => setSession(res.stage, res.user)} />
      <p>
        <button className="link" onClick={() => void logout()}>
          {t('ui.auth.logout')}
        </button>
      </p>
    </AuthCard>
  );
}
