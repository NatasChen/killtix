import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhTW from 'antd/locale/zh_TW';
import { StrictMode, Suspense, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { BrandingProvider } from './branding';
import { Layout } from './components/Layout';
import { I18nProvider, useI18n } from './i18n';
import { lazyPage } from './lazy';
import { antdTheme, applyTheme, useThemeMode } from './theme';
import { Empty } from './components/common';
// Self-hosted Google Noto fonts (bundled by Vite, same origin, so the CSP stays unchanged)
import '@fontsource-variable/noto-sans-display';
import '@fontsource-variable/noto-sans-tc';
import './styles.css';


// Every page is its own chunk, loaded on first use: the first screen only downloads the shell, React and antd.
const LoginPage = lazyPage(() => import('./pages/AuthPages'), 'LoginPage');
const ChangePasswordPage = lazyPage(() => import('./pages/AuthPages'), 'ChangePasswordPage');
const MfaVerifyPage = lazyPage(() => import('./pages/AuthPages'), 'MfaVerifyPage');
const MfaEnrollPage = lazyPage(() => import('./pages/AuthPages'), 'MfaEnrollPage');
const DashboardPage = lazyPage(() => import('./pages/Dashboard'), 'DashboardPage');
const TicketListPage = lazyPage(() => import('./pages/TicketList'), 'TicketListPage');
const TicketNewPage = lazyPage(() => import('./pages/TicketNew'), 'TicketNewPage');
const TicketDetailPage = lazyPage(() => import('./pages/TicketDetail'), 'TicketDetailPage');
const ProfilePage = lazyPage(() => import('./pages/Profile'), 'ProfilePage');
const AdminRoutes = lazyPage(() => import('./pages/admin/AdminRoutes'), 'AdminRoutes');

/** Ant Design theme (palette.ts tokens, light/dark algorithm) and the locale of antd's built-in labels. */
function ThemeRoot({ children }: { children: ReactNode }) {
  const mode = useThemeMode();
  const { locale } = useI18n();
  return (
    <ConfigProvider
      theme={antdTheme(mode)}
      locale={locale.startsWith('zh') ? zhTW : enUS}
      renderEmpty={() => <Empty />}
      // keep glossary text as written: antd would otherwise turn a two-character CJK label like 登入 into 登 入
      button={{ autoInsertSpace: false }}
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}

function Root() {
  const { user, stage, loading } = useAuth();
  const { locale, setLocale } = useI18n();

  // Apply the signed-in user's saved preferences.
  useEffect(() => {
    if (!user) return;
    applyTheme(user.theme);
    if (user.locale !== locale) setLocale(user.locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (loading) return null;
  // the sign-in pages are lazy too; nothing is shown until their chunk arrives (pages inside Layout show a spinner)
  const signIn = (page: ReactNode) => <Suspense fallback={null}>{page}</Suspense>;
  if (!user || !stage) return signIn(<LoginPage />);
  if (stage === 'password_change') return signIn(<ChangePasswordPage />);
  if (stage === 'mfa_verify') return signIn(<MfaVerifyPage />);
  if (stage === 'mfa_enroll') return signIn(<MfaEnrollPage />);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="tickets" element={<TicketListPage />} />
        <Route path="tickets/new" element={<TicketNewPage />} />
        <Route path="tickets/:id" element={<TicketDetailPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin/*" element={<AdminRoutes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeRoot>
        <BrandingProvider>
          <AuthProvider>
            <BrowserRouter>
              <Root />
            </BrowserRouter>
          </AuthProvider>
        </BrandingProvider>
      </ThemeRoot>
    </I18nProvider>
  </StrictMode>,
);
