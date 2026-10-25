import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhTW from 'antd/locale/zh_TW';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { BrandingProvider } from './branding';
import { Layout } from './components/Layout';
import { I18nProvider, useI18n } from './i18n';
import { ChangePasswordPage, LoginPage, MfaEnrollPage, MfaVerifyPage } from './pages/AuthPages';
import { DashboardPage } from './pages/Dashboard';
import { ProfilePage } from './pages/Profile';
import { TicketDetailPage } from './pages/TicketDetail';
import { TicketListPage } from './pages/TicketList';
import { TicketNewPage } from './pages/TicketNew';
import { AdminRoutes } from './pages/admin/AdminRoutes';
import { antdTheme, applyTheme, useThemeMode, watchSystemTheme } from './theme';
import { Empty } from './components/common';
// Self-hosted Google Noto fonts (bundled by Vite, same origin, so the CSP stays unchanged)
import '@fontsource-variable/noto-sans-display';
import '@fontsource-variable/noto-sans-tc';
import './styles.css';

watchSystemTheme();

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
  if (!user || !stage) return <LoginPage />;
  if (stage === 'password_change') return <ChangePasswordPage />;
  if (stage === 'mfa_verify') return <MfaVerifyPage />;
  if (stage === 'mfa_enroll') return <MfaEnrollPage />;

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
