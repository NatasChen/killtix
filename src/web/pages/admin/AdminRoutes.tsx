import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../../auth';
import { lazyPage } from '../../lazy';

/* Admin routes. Each page is its own module and chunk (see lazy.ts), so users who never open a page never
   download it; main.tsx loads this file lazily too, so end users and vendors download none of the admin code. */

const UsersPage = lazyPage(() => import('./UsersPage'), 'UsersPage');
const TeamsPage = lazyPage(() => import('./CatalogPages'), 'TeamsPage');
const SlaPlansPage = lazyPage(() => import('./CatalogPages'), 'SlaPlansPage');
const HelpTopicsPage = lazyPage(() => import('./CatalogPages'), 'HelpTopicsPage');
const CannedResponsesPage = lazyPage(() => import('./CatalogPages'), 'CannedResponsesPage');
const FormsPage = lazyPage(() => import('./FormsPage'), 'FormsPage');
const ApiTokensPage = lazyPage(() => import('./ApiTokensPage'), 'ApiTokensPage');
const SettingsPage = lazyPage(() => import('./SettingsPage'), 'SettingsPage');
const NotificationsPage = lazyPage(() => import('./NotificationsPage'), 'NotificationsPage');
const AuditPage = lazyPage(() => import('./AuditPage'), 'AuditPage');

export function AdminRoutes() {
  const { can } = useAuth();

  return (
    <Routes>
      {can('admin:users') && <Route path="users" element={<UsersPage />} />}
      {can('catalog:manage') && (
        <>
          <Route path="teams" element={<TeamsPage />} />
          <Route path="sla-plans" element={<SlaPlansPage />} />
          <Route path="help-topics" element={<HelpTopicsPage />} />
          <Route path="forms" element={<FormsPage />} />
          <Route path="canned-responses" element={<CannedResponsesPage />} />
        </>
      )}
      {can('admin:tokens') && <Route path="api-tokens" element={<ApiTokensPage />} />}
      {can('admin:settings') && <Route path="settings" element={<SettingsPage />} />}
      {can('admin:settings') && <Route path="notifications" element={<NotificationsPage />} />}
      {can('admin:audit') && <Route path="audit" element={<AuditPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
