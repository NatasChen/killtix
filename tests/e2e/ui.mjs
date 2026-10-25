// Browser end-to-end test of the main UI flows. Run via scripts/ui-e2e.sh (Playwright in Docker).
// Fails on any JS error, CSP violation or 5xx, and on horizontal overflow at phone width.
import { chromium } from 'playwright';
const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const SHOTS = process.env.SHOTS_DIR ?? '/work/shots';
const VENDOR = `vendor.${Date.now()}@example.com`;
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

step('create ticket through the form');
await page.getByRole('link', { name: '新增工單' }).first().click();
await pick(page.getByLabel('服務類別'), '一般問題');
await page.getByLabel('主旨').fill('UI 測試：印表機無法列印');
await page.getByLabel('問題描述').fill('三樓印表機顯示卡紙，但實際上沒有紙張卡住。');
await pick(page.getByLabel('優先度'), 'L4 高');
await page.getByRole('button', { name: '送出工單' }).click();
await page.getByRole('heading', { name: 'UI 測試：印表機無法列印' }).waitFor();

step('internal note + public reply');
// antd's auto-size textarea keeps a hidden measuring copy in the page, so target the visible one
await page.getByLabel('內部備忘').check();
await page.locator('textarea:visible').last().fill('內部：已通知廠商');
await page.getByRole('button', { name: '新增內部備忘' }).click();
await page.getByText('內部：已通知廠商').waitFor();
await page.getByLabel('對外回覆').check();
await page.locator('textarea:visible').last().fill('您好，我們已安排工程師前往處理。');
await page.getByRole('button', { name: '送出回覆' }).click();
await page.getByText('您好，我們已安排工程師前往處理。').waitFor();
await pick(page.getByLabel('狀態').first(), '→ 等待使用者回覆');
await page.getByText('計時暫停').first().waitFor();
await shot('03-ticket-detail');

step('ticket list + 3-day filter');
await page.getByLabel('主選單').getByRole('link', { name: '工單', exact: true }).click();
await page.getByText('UI 測試：印表機無法列印').first().waitFor();
await shot('04-ticket-list');
await page.getByLabel('只看超過 3 天未結案').check();
await page.getByRole('button', { name: '套用' }).click();
await page.waitForURL(/olderThanDays=3/);
await page.getByText('沒有資料').waitFor();

step('admin: create user');
await page.getByLabel('主選單').getByRole('link', { name: '使用者' }).click();
await page.getByLabel('電子郵件').fill(VENDOR);
await page.getByLabel('顯示名稱').fill('UI Vendor');
await pick(page.getByLabel('角色').first(), '外部廠商');
await page.getByRole('button', { name: '新增' }).first().click();
const temp = (await page.locator('.secret-box').first().innerText()).trim();
await shot('05-admin-users');

step('dark theme + English');
await pick(page.getByLabel('主題'), '深色');
await pick(page.getByLabel('語言'), 'English');
await page.getByLabel('Main menu').getByRole('link', { name: 'Dashboard' }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('dark theme not applied');
await shot('06-dashboard-dark-en');
await page.reload();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') throw new Error('theme not persisted');
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
if (await p2.getByRole('link', { name: '使用者' }).count()) throw new Error('vendor sees admin nav');

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
await noOverflow(p3, 'dashboard');
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
