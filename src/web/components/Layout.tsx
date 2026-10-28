import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BellOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FormOutlined,
  IdcardOutlined,
  MessageOutlined,
  MoonOutlined,
  PlusCircleOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, ConfigProvider, Flex, Layout as AntLayout, Menu, Select, Spin, Switch, theme as antdThemes, type MenuProps } from 'antd';
import { Suspense, useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { patch } from '../api';
import { useAuth } from '../auth';
import { Brand } from '../branding';
import { useI18n } from '../i18n';
import type { Mode } from '../palette';
import { applyTheme, useThemeMode } from '../theme';
import { usePalette } from './common';

type NavTile = 'sky' | 'purple' | 'orange' | 'teal';
type Icon = ComponentType<{ style?: CSSProperties }>;
type Item = { to: string; label: string; icon: Icon; end?: boolean };
type Group = { key: string; label: string; icon: Icon; tile: NavTile; items: Item[] };

// Which admin groups are expanded is a per-browser convenience; storage may be unavailable.
const OPEN_KEY = 'td-nav-open';
const readOpen = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};
const saveOpen = (keys: string[]) => {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable: the groups just start closed next time */
  }
};

export function Layout() {
  const { user, can, logout } = useAuth();
  const { t, locale, locales, setLocale } = useI18n();
  const { pathname } = useLocation();
  const p = usePalette();
  const mode = useThemeMode();
  // Phones start with the sidebar collapsed; deciding on the first render (not after antd measures the
  // breakpoint) avoids a frame where the expanded sidebar pushes the page wider than the screen.
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 767.98px)').matches);

  const changeTheme = (value: Mode) => {
    applyTheme(value);
    void patch('/auth/me', { theme: value }).catch(() => undefined);
  };
  const changeLocale = (value: string) => {
    setLocale(value);
    void patch('/auth/me', { locale: value }).catch(() => undefined);
  };
  const isAdmin = can('admin:users');
  const canCatalog = can('catalog:manage');

  // Everyday pages stay at the top level; admin pages sit in collapsible groups, each with its own icon
  // colour: users (orange), ticket settings (purple), system (teal). Empty groups are not shown.
  const work: Item[] = [
    { to: '/', label: t('ui.nav.dashboard'), icon: DashboardOutlined, end: true },
    { to: '/tickets', label: t('ui.nav.tickets'), icon: FileTextOutlined, end: true },
    ...(can('ticket:create') ? [{ to: '/tickets/new', label: t('ui.nav.new_ticket'), icon: PlusCircleOutlined }] : []),
  ];
  const groups: Group[] = [
    {
      key: 'users',
      label: t('ui.nav.group.users'),
      icon: UserOutlined,
      tile: 'orange' as const,
      items: [
        ...(isAdmin ? [{ to: '/admin/users', label: t('ui.nav.users'), icon: IdcardOutlined }] : []),
        ...(canCatalog ? [{ to: '/admin/teams', label: t('ui.nav.teams'), icon: TeamOutlined }] : []),
      ],
    },
    {
      key: 'catalog',
      label: t('ui.nav.group.catalog'),
      icon: AppstoreOutlined,
      tile: 'purple' as const,
      items: canCatalog
        ? [
            { to: '/admin/help-topics', label: t('ui.nav.help_topics'), icon: FolderOpenOutlined },
            { to: '/admin/sla-plans', label: t('ui.nav.sla_plans'), icon: ClockCircleOutlined },
            { to: '/admin/forms', label: t('ui.nav.forms'), icon: FormOutlined },
            { to: '/admin/canned-responses', label: t('ui.nav.canned'), icon: MessageOutlined },
          ]
        : [],
    },
    {
      key: 'system',
      label: t('ui.nav.group.system'),
      icon: SettingOutlined,
      tile: 'teal' as const,
      items: isAdmin
        ? [
            { to: '/admin/settings', label: t('ui.nav.settings'), icon: ToolOutlined },
            { to: '/admin/notifications', label: t('ui.nav.notifications'), icon: BellOutlined },
            { to: '/admin/audit', label: t('ui.nav.audit'), icon: AuditOutlined },
            { to: '/admin/api-tokens', label: t('ui.nav.api_tokens'), icon: ApiOutlined },
          ]
        : [],
    },
  ].filter((g) => g.items.length);
  const toItem = (i: Item, tile: NavTile) => ({
    key: i.to,
    icon: <i.icon aria-hidden style={{ color: p.navTile[tile] }} />,
    label: (
      <NavLink to={i.to} end={i.end}>
        {i.label}
      </NavLink>
    ),
  });
  const items: MenuProps['items'] = [
    ...work.map((i) => toItem(i, 'sky')),
    ...groups.map((g) => ({
      key: `group:${g.key}`,
      icon: <g.icon aria-hidden style={{ color: p.navTile[g.tile] }} />,
      label: g.label,
      children: g.items.map((i) => toItem(i, g.tile)),
    })),
  ];
  // The selected row is the longest nav path that prefixes the current location.
  const selected = [...work, ...groups.flatMap((g) => g.items)]
    .filter((i) => (i.end ? pathname === i.to : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const currentGroup = groups.find((g) => g.items.some((i) => i.to === selected))?.key;

  // Several groups may be open at once; the group of the current page always opens.
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const keys = readOpen();
    return currentGroup && !keys.includes(`group:${currentGroup}`) ? [...keys, `group:${currentGroup}`] : keys;
  });
  useEffect(() => {
    if (currentGroup) setOpenKeys((keys) => (keys.includes(`group:${currentGroup}`) ? keys : [...keys, `group:${currentGroup}`]));
  }, [currentGroup]);
  const changeOpen = (keys: string[]) => {
    // antd closes every group when the sidebar collapses (below the breakpoint); keep the user's choice so the
    // groups are as they were when it expands again
    if (collapsed) return;
    setOpenKeys(keys);
    saveOpen(keys);
  };

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
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selected ? [selected] : []}
            // a collapsed menu shows open groups as floating popups over the page, so none are open while collapsed
            openKeys={collapsed ? [] : openKeys}
            onOpenChange={changeOpen}
            items={items}
            style={{ borderInlineEnd: 'none' }}
          />
          <ConfigProvider theme={navControls}>
            <div className="sidebar-footer" style={{ borderTop: `1px solid ${p.nav.divider}` }}>
              <NavLink to="/profile" style={{ color: p.nav.text, display: 'block' }}>
                {user?.displayName}
                <div style={{ color: p.nav.muted, fontSize: 12 }}>{t(`ui.role.${user?.role}`)}</div>
              </NavLink>
              <Flex justify="space-between" align="center">
                <span style={{ ...label, marginBottom: 0 }}>
                  {t('ui.common.theme')}: {t(`ui.theme.${mode}`)}
                </span>
                {/* off = light (sun), on = dark (moon); track, icon and handle colours come from the theme's palette */}
                <ConfigProvider theme={{ components: { Switch: { handleBg: p.themeSwitch.icon } } }}>
                  <Switch
                    aria-label={t('ui.theme.dark_mode')}
                    checked={mode === 'dark'}
                    onChange={(dark) => changeTheme(dark ? 'dark' : 'light')}
                    checkedChildren={<MoonOutlined style={{ color: p.themeSwitch.icon }} />}
                    unCheckedChildren={<SunOutlined style={{ color: p.themeSwitch.icon }} />}
                    style={{ background: p.themeSwitch.track }}
                  />
                </ConfigProvider>
              </Flex>
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
        {/* pages are lazy chunks (main.tsx): the sidebar stays while the page's chunk downloads */}
        <Suspense
          fallback={
            <Flex justify="center" style={{ padding: 48 }}>
              <Spin aria-label={t('ui.common.loading')} />
            </Flex>
          }>
          <Outlet />
        </Suspense>
      </AntLayout.Content>
    </AntLayout>
  );
}
