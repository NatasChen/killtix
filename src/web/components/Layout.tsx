import { NavLink, Outlet } from 'react-router-dom';
import { patch } from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { applyTheme, currentThemePref, type ThemePref } from '../theme';
import { useState } from 'react';

const link = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' active' : ''}`;

export function Layout() {
  const { user, can, logout } = useAuth();
  const { t, locale, locales, setLocale } = useI18n();
  const [theme, setTheme] = useState<ThemePref>(currentThemePref());

  const changeTheme = (value: ThemePref) => {
    setTheme(value);
    applyTheme(value);
    void patch('/auth/me', { theme: value }).catch(() => undefined);
  };
  const changeLocale = (value: string) => {
    setLocale(value);
    void patch('/auth/me', { locale: value }).catch(() => undefined);
  };
  const isAdmin = can('admin:users');
  const canCatalog = can('catalog:manage');

  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t('ui.nav.main')}>
        <div className="brand">
          <img src="/favicon.svg" width={22} height={22} alt="" /> TicketDesk
        </div>
        <NavLink to="/" end className={link}>
          {t('ui.nav.dashboard')}
        </NavLink>
        <NavLink to="/tickets" end className={link}>
          {t('ui.nav.tickets')}
        </NavLink>
        {can('ticket:create') && (
          <NavLink to="/tickets/new" className={link}>
            {t('ui.nav.new_ticket')}
          </NavLink>
        )}
        {(canCatalog || isAdmin) && <div className="nav-section">{t('ui.nav.admin')}</div>}
        {isAdmin && (
          <NavLink to="/admin/users" className={link}>
            {t('ui.nav.users')}
          </NavLink>
        )}
        {canCatalog && (
          <>
            <NavLink to="/admin/teams" className={link}>
              {t('ui.nav.teams')}
            </NavLink>
            <NavLink to="/admin/help-topics" className={link}>
              {t('ui.nav.help_topics')}
            </NavLink>
            <NavLink to="/admin/sla-plans" className={link}>
              {t('ui.nav.sla_plans')}
            </NavLink>
            <NavLink to="/admin/forms" className={link}>
              {t('ui.nav.forms')}
            </NavLink>
            <NavLink to="/admin/canned-responses" className={link}>
              {t('ui.nav.canned')}
            </NavLink>
          </>
        )}
        {isAdmin && (
          <>
            <NavLink to="/admin/api-tokens" className={link}>
              {t('ui.nav.api_tokens')}
            </NavLink>
            <NavLink to="/admin/notifications" className={link}>
              {t('ui.nav.notifications')}
            </NavLink>
            <NavLink to="/admin/settings" className={link}>
              {t('ui.nav.settings')}
            </NavLink>
            <NavLink to="/admin/audit" className={link}>
              {t('ui.nav.audit')}
            </NavLink>
          </>
        )}
        <div className="sidebar-footer">
          <NavLink to="/profile" className={link}>
            {user?.displayName}
            <div className="small muted">{t(`ui.role.${user?.role}`)}</div>
          </NavLink>
          <label>
            {t('ui.common.theme')}
            <select value={theme} onChange={(e) => changeTheme(e.target.value as ThemePref)}>
              <option value="system">{t('ui.theme.system')}</option>
              <option value="light">{t('ui.theme.light')}</option>
              <option value="dark">{t('ui.theme.dark')}</option>
            </select>
          </label>
          <label>
            {t('ui.common.language')}
            <select value={locale} onChange={(e) => changeLocale(e.target.value)}>
              {locales.map((l) => (
                <option key={l} value={l}>
                  {t(`ui.locale.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => void logout()}>{t('ui.auth.logout')}</button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
