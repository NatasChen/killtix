import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const base='http://localhost:8080';
await p.goto(base+'/login'); await p.waitForTimeout(800); await p.screenshot({path:'/home/claude/shots/00-login.png'});
await p.fill('input[type=email], input[name=email]', 'admin@ticket.local');
await p.fill('input[type=password]', 'Local-Dev-Pass#2026'); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
const pages=[['01-dashboard','/'],['02-tickets','/tickets'],['03-ticket-new','/tickets/new'],['04-ticket-detail','/tickets/5'],
['05-users','/admin/users'],['06-teams','/admin/teams'],['07-sla','/admin/sla-plans'],['08-help-topics','/admin/help-topics'],
['09-forms','/admin/forms'],['10-canned','/admin/canned-responses'],['11-api-tokens','/admin/api-tokens'],['12-settings','/admin/settings'],
['13-notifications','/admin/notifications'],['14-audit','/admin/audit'],['15-profile','/profile']];
for (const [n,u] of pages){ await p.goto(base+u); await p.waitForTimeout(1500); await p.screenshot({path:`/home/claude/shots/${n}.png`, fullPage:true}); }
await b.close();
