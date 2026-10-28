// Browser end-to-end test of the main UI flows. Run via scripts/ui-e2e.sh (Playwright in Docker).
// Fails on any JS error, CSP violation or 5xx, and on horizontal overflow at phone width.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR ?? '/work/shots';
const RUN = Date.now();
const VENDOR = `vendor.${RUN}@example.com`;
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@ticket.local', password: process.env.ADMIN_PASSWORD };
if (!ADMIN.password) throw new Error('ADMIN_PASSWORD is required (a fully set-up super admin)');
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, locale: 'zh-TW' });
const page = await ctx.newPage();
// Expected 4xx responses (e.g. /auth/me before login, a rejected weak password) are logged by the
// browser as resource errors; anything else (JS exceptions, CSP violations, 5xx) fails the run.
const expected = (t) => /Failed to load resource: the server responded with a status of 4\d\d/.test(t);
const onConsole = (m) => { if (m.type() === 'error' && !expected(m.text())) errors.push(m.text()); };
page.on('console', onConsole);
page.on('pageerror', (e) => errors.push(String(e)));
const step = (s) => console.log('step:', s);
// Ant Design selects are not native <select>: open the one the label points at, then click the option.
const pick = async (field, option) => {
  await field.click();
  await field.page().locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(option, { exact: true }).click();
};
// Sidebar link; admin pages sit in collapsible groups, so open the group first when the link is hidden.
const nav = async (name, group, pg = page, menuName = '主選單') => {
  const menu = pg.getByLabel(menuName);
  const link = menu.getByRole('link', { name, exact: true });
  if (group && !(await link.isVisible())) await menu.getByRole('menuitem', { name: group }).click();
  await link.click();
};
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

step('reset admin preferences');
{
  const api = ctx.request;
  const h = { 'X-Requested-With': 'XMLHttpRequest' };
  await api.post(`${BASE}/api/v1/auth/login`, { data: ADMIN, headers: h });
  await api.patch(`${BASE}/api/v1/auth/me`, { data: { locale: 'zh-TW', theme: 'light' }, headers: h });
  await api.post(`${BASE}/api/v1/auth/logout`, { headers: h });
}
step('login page');
await page.goto(BASE);
await page.getByLabel('電子郵件').fill(ADMIN.email);
await page.getByLabel('密碼').fill(ADMIN.password);
await shot('01-login');
await page.getByRole('button', { name: '登入' }).click();
await page.getByRole('heading', { name: '儀表板' }).waitFor();
await shot('02-dashboard');

step('sidebar admin groups start collapsed and expand on click');
{
  const menu = page.getByLabel('主選單');
  const group = menu.getByRole('menuitem', { name: '系統相關' });
  if ((await group.getAttribute('aria-expanded')) !== 'false') throw new Error('system group should start collapsed');
  if (await menu.getByRole('link', { name: '稽核日誌' }).isVisible()) throw new Error('collapsed group shows its links');
  await group.click();
  await menu.getByRole('link', { name: '稽核日誌' }).waitFor();
  await shot('02b-sidebar-groups');
  await group.click();
  await menu.getByRole('link', { name: '稽核日誌' }).waitFor({ state: 'hidden' });
}

step('create ticket through the form');
await page.getByRole('link', { name: '新增工單' }).first().click();
// pages are lazy chunks: the previous page stays until the new one has loaded, so wait for its heading
await page.getByRole('heading', { name: '新增工單' }).waitFor();
await pick(page.getByLabel('服務類別'), '一般問題');
await page.getByLabel('主旨').fill('UI 測試：印表機無法列印');
await page.getByLabel('問題描述').fill('三樓印表機顯示卡紙，但實際上沒有紙張卡住。');
await pick(page.getByLabel('優先度'), 'L4 高');
await pick(page.getByLabel('負責人'), 'Bootstrap Administrator (系統管理員)');
await page.getByRole('button', { name: '送出工單' }).click();
await page.getByRole('heading', { name: 'UI 測試：印表機無法列印' }).waitFor();
await page.locator('.ant-descriptions').getByText('Bootstrap Administrator (系統管理員)').waitFor(); // assigned on creation

step('replies with and without email notification');
// antd's auto-size textarea keeps a hidden measuring copy in the page, so target the visible one
await page.getByLabel('寄送 Email 通知').uncheck();
await page.locator('textarea:visible').last().fill('已通知廠商，等待回覆。');
await page.getByRole('button', { name: '送出回覆' }).click();
await page.getByText('已通知廠商，等待回覆。').waitFor();
if (!(await page.getByLabel('寄送 Email 通知').isChecked())) throw new Error('notify checkbox should reset to checked');
await page.locator('textarea:visible').last().fill('您好，我們已安排工程師前往處理。');
await page.getByRole('button', { name: '送出回覆' }).click();
await page.getByText('您好，我們已安排工程師前往處理。').waitFor();
await pick(page.getByLabel('狀態').first(), '→ 等待使用者回覆');
await page.getByText('計時暫停').first().waitFor();
await shot('03-ticket-detail');

step('ticket list + 3-day filter');
await page.getByLabel('主選單').getByRole('link', { name: '工單', exact: true }).click();
await page.getByRole('heading', { name: '工單', exact: true }).waitFor();
await page.getByText('UI 測試：印表機無法列印').first().waitFor();
await shot('04-ticket-list');
await page.getByLabel('只看超過 3 天未結案').check();
await page.getByRole('button', { name: '套用' }).click();
await page.waitForURL(/olderThanDays=3/);
await page.getByText('沒有資料').waitFor();

step('admin: create user');
await nav('使用者', '使用者管理');
await page.getByRole('heading', { name: '使用者', exact: true }).waitFor();
await page.getByLabel('電子郵件').fill(VENDOR);
await page.getByLabel('顯示名稱').fill('UI Vendor');
await pick(page.getByLabel('角色').first(), '外部廠商');
await page.getByRole('button', { name: '新增' }).first().click();
const temp = (await page.locator('.secret-box').first().innerText()).trim();
await shot('05-admin-users');

step('teams: assign a ticket to a team, filter, claim, multi-team user');
const NET = `E2E 網路組 ${RUN}`;
const DESK = `E2E 桌面支援 ${RUN}`;
for (const name of [NET, DESK]) {
  const res = await page.request.post(`${BASE}/api/v1/admin/teams`, { data: { name }, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok()) throw new Error(`create team ${name}: ${res.status()}`);
}
await page.getByLabel('主選單').getByRole('link', { name: '新增工單' }).click();
await page.getByRole('heading', { name: '新增工單' }).waitFor();
await page.getByLabel('主旨').fill('UI 測試：交換器斷線');
await pick(page.getByLabel('團隊'), NET);
await page.getByRole('button', { name: '送出工單' }).click();
await page.getByRole('heading', { name: 'UI 測試：交換器斷線' }).waitFor();
await page.locator('.ant-descriptions').getByText('新建立').waitFor(); // a team alone does not start the work
await page.getByLabel('主選單').getByRole('link', { name: '工單', exact: true }).click();
await page.getByRole('heading', { name: '工單', exact: true }).waitFor();
await pick(page.getByLabel('團隊'), NET);
await page.getByRole('button', { name: '套用' }).click();
await page.waitForURL(/teamId=\d+/);
const teamRow = page.getByRole('row').filter({ hasText: 'UI 測試：交換器斷線' });
await teamRow.getByText(NET).waitFor();
// the list reloads after the filter applies: tickets of other teams must go away
await page.getByRole('row').filter({ hasText: 'UI 測試：印表機無法列印' }).first().waitFor({ state: 'detached' });
await teamRow.getByRole('link', { name: 'UI 測試：交換器斷線' }).click();
await page.getByRole('button', { name: '我來處理' }).click();
await page.locator('.ant-descriptions').getByText('Bootstrap Administrator (系統管理員)').waitFor();
await page.locator('.ant-descriptions').getByText('處理中').waitFor();
if (await page.getByRole('button', { name: '我來處理' }).count()) throw new Error('claim button should disappear once claimed');
await shot('05a-ticket-claimed');
await nav('使用者', '使用者管理');
await page.getByRole('heading', { name: '使用者', exact: true }).waitFor();
const vendorTeams = page.getByRole('row').filter({ hasText: VENDOR }).getByLabel('團隊');
await vendorTeams.click(); // a multiple select stays open: pick both, then close it
for (const name of [NET, DESK]) {
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle(name, { exact: true }).click();
  await page.getByRole('row').filter({ hasText: VENDOR }).getByText(name).waitFor();
}
await page.keyboard.press('Escape');
await page.waitForLoadState('networkidle');
await page.reload();
const vendorRow = page.getByRole('row').filter({ hasText: VENDOR });
await vendorRow.getByText(NET).waitFor();
await vendorRow.getByText(DESK).waitFor();

step('teams page: expand a team, see its members and their state, add and remove members');
await nav('團隊', '使用者管理');
await page.getByRole('heading', { name: '團隊', exact: true }).waitFor();
const netTeamRow = page.getByRole('row').filter({ hasText: NET }).first();
await netTeamRow.getByRole('button', { name: '展開列' }).click();
const members = page.getByRole('region', { name: `${NET} 的成員` });
// the vendor added on the users page is listed, with the note that team membership shows them nothing
await members.getByRole('row').filter({ hasText: 'UI Vendor' }).getByText('不會因團隊看到工單').waitFor();
await members.getByLabel('加入成員').click(); // a multiple select stays open: pick, then close it
await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByTitle('Bootstrap Administrator (系統管理員)', { exact: true }).click();
await page.keyboard.press('Escape');
await members.getByRole('button', { name: '新增' }).click();
const adminMember = members.getByRole('row').filter({ hasText: 'Bootstrap Administrator' });
await adminMember.getByText('啟用').waitFor();
await adminMember.getByRole('link', { name: /^\d+$/ }).waitFor(); // open tickets assigned to the admin above, linked to the list
await netTeamRow.getByRole('cell', { name: '2', exact: true }).waitFor(); // member count in the team list follows
await shot('05b-team-members');
await members.getByRole('button', { name: '把 UI Vendor 移出團隊' }).click();
await members.getByRole('row').filter({ hasText: 'UI Vendor' }).waitFor({ state: 'detached' });
await netTeamRow.getByRole('cell', { name: '1', exact: true }).waitFor();

step('dashboard charts: render, drill down by status and by tag');
const TAG = `e2etag${RUN}`;
{
  const res = await page.request.post(`${BASE}/api/v1/tickets`, {
    data: { subject: 'UI 測試：標籤統計', tags: [TAG] },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok()) throw new Error(`create tagged ticket: ${res.status()}`);
}
await page.getByLabel('主選單').getByRole('link', { name: '儀表板' }).click();
await page.getByRole('heading', { name: '儀表板' }).waitFor();
await page.getByRole('img', { name: /新增與解決趨勢/ }).waitFor();
await page.getByRole('img', { name: /狀態分佈/ }).waitFor();
await page.getByRole('img', { name: /未結案天數/ }).waitFor();
await page.getByRole('group', { name: new RegExp(`常見標籤.*${TAG}`) }).waitFor();
await page.getByRole('heading', { name: '工程師負載（未結案）' }).waitFor(); // staff-only row
{
  // the trend line chart fills its card instead of stopping at a fixed size
  const [svg, body] = await page.getByRole('img', { name: /新增與解決趨勢/ }).evaluate((el) => [
    el.getBoundingClientRect().width,
    el.closest('.ant-card-body').clientWidth,
  ]);
  if (svg < body * 0.9) throw new Error(`trend chart ${svg}px wide in a ${body}px card`);
}
await shot('05d-dashboard-charts');
// the donut legend is keyboard-reachable links: status → filtered list
await page.getByRole('list', { name: '狀態分佈' }).getByRole('link', { name: '等待使用者回覆' }).click();
await page.waitForURL(/\/tickets\?status=pending_user/);
await page.getByRole('row').filter({ hasText: 'UI 測試：印表機無法列印' }).first().waitFor();
await page.getByRole('row').filter({ hasText: 'UI 測試：交換器斷線' }).first().waitFor({ state: 'detached' });
await page.getByLabel('主選單').getByRole('link', { name: '儀表板' }).click();
await page.getByRole('group', { name: /常見標籤/ }).getByRole('link', { name: new RegExp(TAG) }).click();
await page.waitForURL(new RegExp(`/tickets\\?tags=${TAG}`));
await page.getByRole('row').filter({ hasText: 'UI 測試：標籤統計' }).first().waitFor();
if ((await page.getByLabel('標籤', { exact: true }).inputValue()) !== TAG) throw new Error('tag filter not applied');

step('dashboard period: preset, section heading, drill-down keeps the dates');
await page.getByLabel('主選單').getByRole('link', { name: '儀表板' }).click();
await page.getByRole('heading', { name: '目前狀態' }).waitFor();
await page.getByLabel('統計期間').click();
await page.locator('.ant-picker-presets').getByText('近 7 天', { exact: true }).click();
await page.waitForURL(/[?&]from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
{
  const url = new URL(page.url());
  const [from, to] = [url.searchParams.get('from'), url.searchParams.get('to')];
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 !== 6) throw new Error(`7-day preset gave ${from} ~ ${to}`);
  await page.getByRole('heading', { name: `期間統計：${from} ~ ${to}` }).waitFor();
  // one hover target per day in the trend chart
  const points = await page.getByRole('img', { name: /新增與解決趨勢/ }).locator('rect[tabindex="0"]').count();
  if (points !== 7) throw new Error(`trend has ${points} points for 7 days`);
  await shot('05f-dashboard-period');
  // the period KPI opens the list filtered by the same created dates, shown in the filter form
  await page.locator('.kpi').filter({ hasText: '期間新增' }).getByRole('link').click();
  await page.waitForURL(new RegExp(`/tickets\\?createdFrom=${from}&createdTo=${to}`));
  await page.getByRole('row').filter({ hasText: 'UI 測試：標籤統計' }).first().waitFor();
  if ((await page.getByLabel('建立日期').inputValue()) !== from) throw new Error('created-date filter not shown');
}

step('admin: company logo');
await nav('系統設定', '系統相關');
// draw a test logo in the page so the run needs no fixture file
const logo = Buffer.from(
  await page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 360, height: 90 });
    const g = c.getContext('2d');
    g.fillStyle = '#e8590c';
    g.fillRect(0, 10, 70, 70);
    g.fillStyle = '#888';
    g.font = 'bold 44px sans-serif';
    g.fillText('ACME 測試', 86, 62);
    return c.toDataURL('image/png').split(',')[1];
  }),
  'base64',
);
await page.locator('section[aria-label="淺色背景用"] input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
await page.getByLabel('主選單').getByRole('img', { name: '公司標誌' }).waitFor();
// the name stays beside the uploaded logo, and a new name shows at once in the sidebar and the tab title
await page.getByLabel('主選單').locator('.brand-name', { hasText: 'TicketDesk' }).waitFor();
await page.getByLabel('系統名稱').fill('ACME 服務台');
await page.getByRole('button', { name: '儲存', exact: true }).first().click();
await page.getByLabel('主選單').locator('.brand-name', { hasText: 'ACME 服務台' }).waitFor();
if ((await page.title()) !== 'ACME 服務台') throw new Error(`tab title not renamed: ${await page.title()}`);
await shot('05b-settings-logo');

step('admin: notification settings');
{
  const card = page.locator('.ant-card').filter({ has: page.getByRole('heading', { name: '通知設定' }) });
  const enabled = card.getByRole('switch', { name: '啟用通知' });
  // off by default, so nothing this run creates is ever sent
  if ((await enabled.getAttribute('aria-checked')) !== 'false') throw new Error('notifications should start switched off');
  await enabled.click();
  await card.locator('.ant-switch-checked').waitFor();
  await enabled.click();
  await card.locator('.ant-switch-checked').waitFor({ state: 'detached' });
  await card.getByLabel('Teams Webhook URL').fill('https://example.com/e2e-webhook');
  await card.getByRole('button', { name: '儲存' }).click();
  await card.getByRole('button', { name: '移除 Teams 設定' }).waitFor();
  if ((await card.getByLabel('Teams Webhook URL').inputValue()) !== '') throw new Error('webhook URL was echoed back');
  await shot('05c-settings-notify');
  await card.getByRole('button', { name: '移除 Teams 設定' }).click();
  await card.getByRole('button', { name: '移除 Teams 設定' }).waitFor({ state: 'detached' });
}

step('admin: mail settings');
// No e-mail set up in this deployment: the test e-mail reports "not configured" without leaving the server.
const mail = page.locator('.ant-card').filter({ has: page.getByRole('heading', { name: '郵件設定' }) });
await mail.getByRole('button', { name: '寄送測試信' }).click();
await mail.getByRole('status').getByText('測試信寄送失敗').waitFor();
if (await mail.getByText('環境變數').count()) throw new Error('the environment-variable provider should be gone');
await pick(page.getByLabel('寄信方式'), 'Resend');
await page.getByLabel('Resend API Key').fill('re_e2e_not_a_real_key');
await page.getByLabel('寄件者').fill('TicketDesk <no-reply@example.com>');
await mail.getByRole('button', { name: '儲存' }).click();
await page.getByText('已設定（留空表示不變更）').waitFor();
if ((await page.getByLabel('Resend API Key').inputValue()) !== '') throw new Error('API key was echoed back');
await shot('05c-settings-mail');
// notifications stay switched off, so later steps never call the real Resend API

step('sidebar language menu and theme switch are readable in the light theme');
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'light') throw new Error('expected the light theme');
// contrast between two computed colours, run in the page (CSP forbids the eval that waitForFunction needs)
const contrastOf = async (locator, fg, bgLocator) =>
  locator.evaluate((el, [fgProp, bgEl]) => {
    const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (c) => {
      const [r, g, b] = rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(getComputedStyle(el)[fgProp]), lum(getComputedStyle(bgEl).backgroundColor)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }, [fg, await bgLocator.elementHandle()]);
const themeSwitch = page.getByLabel('主選單').getByRole('switch', { name: '深色主題' });
{
  await page.getByLabel('主選單').getByLabel('語言').click();
  // the language select's own dropdown (another one may still be playing its close animation)
  const menu = page.locator('.ant-select-dropdown').filter({ has: page.locator('#nav-locale_list') });
  const option = menu.locator('.ant-select-item-option').first();
  await option.waitFor();
  // wait for the open animation (it fades in) before measuring and taking the screenshot
  for (let i = 0; i < 40 && (await menu.evaluate((el) => getComputedStyle(el).opacity)) !== '1'; i++) await page.waitForTimeout(50);
  const ratio = await contrastOf(option, 'color', menu);
  if (ratio < 4.5) throw new Error(`sidebar language option contrast ${ratio.toFixed(2)} < 4.5`);
  await page.keyboard.press('Escape');
  if ((await themeSwitch.getAttribute('aria-checked')) !== 'false') throw new Error('theme switch should be off in the light theme');
  const sun = themeSwitch.locator('.anticon-sun');
  if ((await contrastOf(sun, 'color', themeSwitch)) < 3) throw new Error('sun icon contrast < 3');
  await shot('05e-sidebar-theme-switch-light');
}

step('dark theme + English');
await themeSwitch.click();
if ((await themeSwitch.getAttribute('aria-checked')) !== 'true') throw new Error('theme switch should be on in the dark theme');
if ((await contrastOf(themeSwitch.locator('.anticon-moon'), 'color', themeSwitch)) < 3) throw new Error('moon icon contrast < 3');
await pick(page.getByLabel('主選單').getByLabel('語言'), 'English');
await page.getByLabel('Main menu').getByRole('link', { name: 'Dashboard' }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('dark theme not applied');
await shot('06-dashboard-dark-en');
await page.reload();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('theme not persisted');
await nav('Settings', 'System', page, 'Main menu');
await page.getByRole('heading', { name: 'E-mail settings' }).waitFor();
await shot('06b-settings-dark-en');
await page.getByRole('button', { name: 'Sign out' }).click();

step('new user forced password change');
const p2 = await (await browser.newContext({ locale: 'zh-TW' })).newPage();
p2.on('console', onConsole);
await p2.goto(BASE);
await p2.getByLabel('電子郵件').fill(VENDOR);
await p2.getByLabel('密碼').fill(temp);
await p2.getByRole('button', { name: '登入' }).click();
await p2.getByRole('heading', { name: '變更密碼' }).waitFor();
await p2.getByLabel('目前密碼').fill(temp);
await p2.getByLabel('新密碼', { exact: true }).fill('weak');
await p2.getByLabel('確認新密碼').fill('weak');
await p2.getByRole('button', { name: '變更密碼' }).click();
await p2.getByText('至少 12 個字元').first().waitFor();
await p2.screenshot({ path: `${SHOTS}/07-password-policy.png` });
await p2.getByLabel('新密碼', { exact: true }).fill('Vendor-UI-Passw0rd!');
await p2.getByLabel('確認新密碼').fill('Vendor-UI-Passw0rd!');
await p2.getByRole('button', { name: '變更密碼' }).click();
await p2.getByRole('heading', { name: '儀表板' }).waitFor();
// The vendor is assigned nothing, so the list is empty and admin pages are absent.
if (await p2.getByLabel('主選單').getByRole('menuitem', { name: /使用者管理|工單設定|系統相關/ }).count()) throw new Error('vendor sees admin nav');

step('mobile viewport');
await p2.setViewportSize({ width: 390, height: 844 });
await p2.goto(`${BASE}/tickets`);
await p2.screenshot({ path: `${SHOTS}/08-mobile.png`, fullPage: true });
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
if (overflow > 1) errors.push(`horizontal overflow on mobile: ${overflow}px`);

// 375px is the narrowest supported phone width (PRD FR-5.4): no horizontal scrollbar on any screen.
step('375px login page in light and dark');
const noOverflow = async (target, label) => {
  const px = await target.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (px > 1) errors.push(`horizontal overflow at 375px on ${label}: ${px}px`);
};
const p3 = await (await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-TW' })).newPage();
p3.on('console', onConsole);
p3.on('pageerror', (e) => errors.push(String(e)));
await p3.goto(BASE);
await p3.getByLabel('電子郵件').waitFor();
await p3.getByRole('img', { name: '公司標誌' }).waitFor(); // uploaded in the logo step
await p3.locator('.brand-name', { hasText: 'ACME 服務台' }).waitFor(); // renamed in the logo step
await noOverflow(p3, 'login page (light)');
await p3.screenshot({ path: `${SHOTS}/09-login-375-light.png`, fullPage: true });
await p3.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await noOverflow(p3, 'login page (dark)');
await p3.screenshot({ path: `${SHOTS}/10-login-375-dark.png`, fullPage: true });

step('375px signed-in screens');
// The admin's saved preferences are dark + en-US after the theme step; reset them so labels match.
{
  const api = ctx.request;
  const h = { 'X-Requested-With': 'XMLHttpRequest' };
  await api.post(`${BASE}/api/v1/auth/login`, { data: ADMIN, headers: h });
  await api.patch(`${BASE}/api/v1/auth/me`, { data: { locale: 'zh-TW', theme: 'light' }, headers: h });
  await api.post(`${BASE}/api/v1/auth/logout`, { headers: h });
}
await p3.goto(BASE);
await p3.getByLabel('電子郵件').fill(ADMIN.email);
await p3.getByLabel('密碼').fill(ADMIN.password);
await p3.getByRole('button', { name: '登入' }).click();
await p3.getByRole('heading', { name: '儀表板' }).waitFor();
await p3.getByRole('img', { name: /新增與解決趨勢/ }).waitFor();
await noOverflow(p3, 'dashboard');
await p3.screenshot({ path: `${SHOTS}/11a-dashboard-375-light.png`, fullPage: true });
await p3.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await noOverflow(p3, 'dashboard (dark)');
await p3.screenshot({ path: `${SHOTS}/11b-dashboard-375-dark.png`, fullPage: true });
await p3.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
for (const [label, path] of [['ticket list', '/tickets'], ['admin users', '/admin/users']]) {
  await p3.goto(`${BASE}${path}`);
  await p3.waitForLoadState('networkidle');
  await noOverflow(p3, label);
}
await p3.screenshot({ path: `${SHOTS}/11-admin-users-375.png`, fullPage: true });
await p3.goto(`${BASE}/tickets`);
await p3.getByRole('link', { name: 'UI 測試：印表機無法列印' }).first().click();
await p3.getByRole('heading', { name: 'UI 測試：印表機無法列印' }).waitFor();
await noOverflow(p3, 'ticket detail');
await p3.screenshot({ path: `${SHOTS}/12-ticket-detail-375.png`, fullPage: true });

await browser.close();
if (errors.length) { console.log('BROWSER ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('UI E2E PASS');
