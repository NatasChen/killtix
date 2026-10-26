import { Button, ConfigProvider, Layout as AntLayout, Menu, Select, theme as antdThemes, type MenuProps } from 'antd';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { patch } from '../api';
import { useAuth } from '../auth';
import { Brand } from '../branding';
import { useI18n } from '../i18n';
import { applyTheme, currentThemePref, type ThemePref } from '../theme';
import { usePalette } from './common';

type NavTile = 'sky' | 'purple' | 'orange' | 'teal';
type Item = { to: string; label: string; tile: NavTile; end?: boolean };

export function Layout() {
  const { user, can, logout } = useAuth();
  const { t, locale, locales, setLocale } = useI18n();
  const { pathname } = useLocation();
  const p = usePalette();
  const [theme, setTheme] = useState<ThemePref>(currentThemePref());
  // Phones start with the sidebar collapsed; deciding on the first render (not after antd measures the
  // breakpoint) avoids a frame where the expanded sidebar pushes the page wider than the screen.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 767.98px)').matches);

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

  // A colour tile per nav group: tickets (sky), catalog (purple), system admin (orange), records (teal).
  const work: Item[] = [
    { to: '/', label: t('ui.nav.dashboard'), tile: 'sky', end: true },
    { to: '/tickets', label: t('ui.nav.tickets'), tile: 'sky', end: true },
    ...(can('ticket:create') ? [{ to: '/tickets/new', label: t('ui.nav.new_ticket'), tile: 'sky' as const }] : []),
  ];
  const admin: Item[] = [
    ...(isAdmin ? [{ to: '/admin/users', label: t('ui.nav.users'), tile: 'orange' as const }] : []),
    ...(canCatalog
      ? [
          { to: '/admin/teams', label: t('ui.nav.teams'), tile: 'purple' as const },
          { to: '/admin/help-topics', label: t('ui.nav.help_topics'), tile: 'purple' as const },
          { to: '/admin/sla-plans', label: t('ui.nav.sla_plans'), tile: 'purple' as const },
          { to: '/admin/forms', label: t('ui.nav.forms'), tile: 'purple' as const },
          { to: '/admin/canned-responses', label: t('ui.nav.canned'), tile: 'purple' as const },
        ]
      : []),
    ...(isAdmin
      ? [
          { to: '/admin/api-tokens', label: t('ui.nav.api_tokens'), tile: 'orange' as const },
          { to: '/admin/notifications', label: t('ui.nav.notifications'), tile: 'teal' as const },
          { to: '/admin/settings', label: t('ui.nav.settings'), tile: 'orange' as const },
          { to: '/admin/audit', label: t('ui.nav.audit'), tile: 'teal' as const },
        ]
      : []),
  ];
  const toItem = (i: Item) => ({
    key: i.to,
    icon: <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: p.navTile[i.tile] }} />,
    label: (
      <NavLink to={i.to} end={i.end}>
        {i.label}
      </NavLink>
    ),
  });
  const items: MenuProps['items'] = [
    ...work.map(toItem),
    ...(admin.length ? [{ type: 'group' as const, key: 'admin', label: t('ui.nav.admin'), children: admin.map(toItem) }] : []),
  ];
  // The selected row is the longest nav path that prefixes the current location.
  const selected = [...work, ...admin]
    .filter((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;

  // Footer controls sit on the indigo sidebar, so they get the dark algorithm and the nav colours. The
  // dropdowns need their own elevated background: the app theme's (white in light mode) would otherwise
  // be inherited and leave the light option text unreadable.
  const navControls = {
    algorithm: antdThemes.darkAlgorithm,
    token: {
      colorBgContainer: p.nav.field,
      colorBgElevated: p.nav.field,
      colorBorder: p.nav.fieldBorder,
      colorText: p.nav.text,
      colorTextSecondary: p.nav.muted,
      colorPrimary: p.nav.indicator,
      controlItemBgHover: p.nav.hover,
      controlItemBgActive: p.nav.active,
    },
  };
  const label = { display: 'block', color: p.nav.muted, fontSize: 12, marginBottom: 4 } as const;

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <AntLayout.Sider
        width={220}
        breakpoint="md"
        collapsedWidth={0}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        zeroWidthTriggerStyle={{ top: 8 }}
        style={{ borderRight: `1px solid ${p.nav.divider}` }}>
        <nav aria-label={t('ui.nav.main')} style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <Brand on="dark" color={p.nav.text} />
          <Menu theme="dark" mode="inline" selectedKeys={selected ? [selected] : []} items={items} style={{ borderInlineEnd: 'none' }} />
          <ConfigProvider theme={navControls}>
            <div className="sidebar-footer" style={{ borderTop: `1px solid ${p.nav.divider}` }}>
              <NavLink to="/profile" style={{ color: p.nav.text, display: 'block' }}>
                {user?.displayName}
                <div style={{ color: p.nav.muted, fontSize: 12 }}>{t(`ui.role.${user?.role}`)}</div>
              </NavLink>
              <div>
                <label htmlFor="nav-theme" style={label}>
                  {t('ui.common.theme')}
                </label>
                <Select
                  id="nav-theme"
                  value={theme}
                  onChange={(v) => changeTheme(v)}
                  style={{ width: '100%' }}
                  options={[
                    { value: 'system', label: t('ui.theme.system') },
                    { value: 'light', label: t('ui.theme.light') },
                    { value: 'dark', label: t('ui.theme.dark') },
                  ].map((o) => ({ ...o, title: o.label }))}
                />
              </div>
              <div>
                <label htmlFor="nav-locale" style={label}>
                  {t('ui.common.language')}
                </label>
                <Select
                  id="nav-locale"
                  value={locale}
                  onChange={(v) => changeLocale(v)}
                  style={{ width: '100%' }}
                  options={locales.map((l) => ({ value: l, label: t(`ui.locale.${l}`), title: t(`ui.locale.${l}`) }))}
                />
              </div>
              <Button block onClick={() => void logout()}>
                {t('ui.auth.logout')}
              </Button>
            </div>
          </ConfigProvider>
        </nav>
      </AntLayout.Sider>
      <AntLayout.Content className="main">
        <Outlet />
      </AntLayout.Content>
    </AntLayout>
  );
}
