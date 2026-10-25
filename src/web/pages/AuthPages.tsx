import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { post } from '../api';
import { useAuth, type Me, type Stage } from '../auth';
import { ErrorBanner, Field, usePalette, useAction } from '../components/common';
import { Brand } from '../branding';
import { useI18n } from '../i18n';
import { useThemeMode } from '../theme';

type SessionResponse = { stage: Stage; user: Me };

/** ex-auth-form-card: the centred sign-in card used by login, password change and 2FA. */
function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const mode = useThemeMode();
  return (
    <div className="auth-wrap">
      <Card className="auth-card ex-auth-form-card">
        <Brand on={mode} />
        <Typography.Title level={1} style={{ fontSize: 20, marginTop: 0 }}>
          {title}
        </Typography.Title>
        {children}
      </Card>
    </div>
  );
}

/** Vertical antd form for layout; values stay in component state and native `required` still applies. */
function AuthForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <Form layout="vertical" requiredMark={false} onFinish={onSubmit}>
      {children}
    </Form>
  );
}

function SubmitButton({ busy, disabled, danger, children }: { busy?: boolean; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <Button type="primary" danger={danger} htmlType="submit" block loading={busy} disabled={busy || disabled}>
      {children}
    </Button>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { setSession } = useAuth();
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    void run(async () => {
      const res = await post<SessionResponse>('/auth/login', { email, password });
      setSession(res.stage, res.user);
    });
  };

  return (
    <AuthCard title={t('ui.auth.login_title')}>
      <ErrorBanner error={error} />
      <AuthForm onSubmit={submit}>
        <Field label={t('ui.auth.email')}>
          <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label={t('ui.auth.password')}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <SubmitButton busy={busy}>{t('ui.auth.login')}</SubmitButton>
      </AuthForm>
    </AuthCard>
  );
}

export function PasswordForm({ onDone }: { onDone: (res: SessionResponse) => void }) {
  const { t } = useI18n();
  const { busy, error, setError, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const submit = () => {
    if (next !== confirm) {
      setError(new Error(t('ui.password.mismatch')));
      return;
    }
    void run(async () => onDone(await post<SessionResponse>('/auth/change-password', { currentPassword: current, newPassword: next })));
  };

  return (
    <AuthForm onSubmit={submit}>
      <ErrorBanner error={error} />
      <Field label={t('ui.password.current')}>
        <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label={t('ui.password.new')}>
        <Input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={t('ui.password.confirm')}>
        <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <p className="small muted">{t('ui.password.policy')}</p>
      <SubmitButton busy={busy}>{t('ui.password.submit')}</SubmitButton>
    </AuthForm>
  );
}

export function ChangePasswordPage() {
  const { t } = useI18n();
  const { user, setSession, logout } = useAuth();
  return (
    <AuthCard title={t('ui.password.title')}>
      <Alert type="warning" showIcon title={user?.isBootstrapAdmin ? t('ui.password.bootstrap_notice') : t('ui.password.must_change')} style={{ marginBottom: 16 }} />
      <PasswordForm onDone={(res) => setSession(res.stage, res.user)} />
      <Button type="link" style={{ paddingInline: 0, marginTop: 8 }} onClick={() => void logout()}>
        {t('ui.auth.logout')}
      </Button>
    </AuthCard>
  );
}

export function MfaVerifyPage() {
  const { t } = useI18n();
  const { setSession, logout } = useAuth();
  const { busy, error, run } = useAction();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  const submit = () => {
    void run(async () => {
      const res = await post<SessionResponse>('/auth/2fa/verify', useRecovery ? { recoveryCode: code } : { code });
      setSession(res.stage, res.user);
    });
  };

  return (
    <AuthCard title={t('ui.mfa.verify_title')}>
      <ErrorBanner error={error} />
      <AuthForm onSubmit={submit}>
        <Field label={useRecovery ? t('ui.mfa.recovery_code') : t('ui.mfa.code')}>
          <Input
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <SubmitButton busy={busy}>{t('ui.mfa.verify')}</SubmitButton>
      </AuthForm>
      <Flex gap={16} style={{ marginTop: 8 }}>
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => setUseRecovery(!useRecovery)}>
          {useRecovery ? t('ui.mfa.use_app') : t('ui.mfa.use_recovery')}
        </Button>
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => void logout()}>
          {t('ui.auth.logout')}
        </Button>
      </Flex>
    </AuthCard>
  );
}

/** TOTP enrolment, used both for enforced enrolment and from the profile page. */
export function MfaSetup({ onDone }: { onDone: (res: SessionResponse) => void }) {
  const { t } = useI18n();
  const p = usePalette();
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
      <Flex vertical gap={12}>
        <Alert type="success" showIcon title={t('ui.mfa.enabled')} />
        <p style={{ margin: 0 }}>{t('ui.mfa.recovery_hint')}</p>
        <div className="codes mono">
          {recovery.codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button type="primary" onClick={() => onDone(recovery.res)}>
          {t('ui.mfa.recovery_saved')}
        </Button>
      </Flex>
    );
  }

  const submit = () => {
    void run(async () => {
      const res = await post<SessionResponse & { recoveryCodes: string[] }>('/auth/2fa/enable', { code });
      setRecovery({ codes: res.recoveryCodes, res });
    });
  };

  return (
    <AuthForm onSubmit={submit}>
      <ErrorBanner error={error} />
      <p>{t('ui.mfa.scan')}</p>
      {setup && (
        <Flex vertical gap={8} style={{ marginBottom: 12 }}>
          {/* the QR code needs a white quiet zone to stay scannable in both themes */}
          <img className="qr" src={setup.qrDataUrl} alt={t('ui.mfa.qr_alt')} style={{ background: p.qrCanvas }} />
          <div className="secret-box mono small" style={{ background: p.surface2 }}>
            {setup.secret}
          </div>
        </Flex>
      )}
      <Field label={t('ui.mfa.code')}>
        <Input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <SubmitButton busy={busy} disabled={!setup}>
        {t('ui.mfa.enable')}
      </SubmitButton>
    </AuthForm>
  );
}

export function MfaEnrollPage() {
  const { t } = useI18n();
  const { setSession, logout } = useAuth();
  return (
    <AuthCard title={t('ui.mfa.enroll_title')}>
      <Alert type="warning" showIcon title={t('ui.mfa.enforced_notice')} style={{ marginBottom: 16 }} />
      <MfaSetup onDone={(res) => setSession(res.stage, res.user)} />
      <Button type="link" style={{ paddingInline: 0, marginTop: 8 }} onClick={() => void logout()}>
        {t('ui.auth.logout')}
      </Button>
    </AuthCard>
  );
}
