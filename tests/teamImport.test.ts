import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, teamMembers, teams } from '../src/server/db/schema.js';
import { decodeCsv, parseCsv } from '../src/server/services/teamImport.js';
import { createTestContext, type TestContext } from './helpers.js';

/** Teams imported from CSV (DECISIONS D26): preview first, then all rows or none. */
let ctx: TestContext;
let admin: Awaited<ReturnType<TestContext['adminClient']>>;

const b64 = (text: string | Uint8Array) => Buffer.from(typeof text === 'string' ? text : text).toString('base64');
const csv = (lines: string[], bom = true) => b64(`${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`);
const HEADER = '團隊名稱 *,TeamID,說明,成員 Email';
const teamCount = async () => (await ctx.db.select().from(teams)).length;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminClient();
  await ctx.createUser('tp1@example.com', 'agent');
  await ctx.createUser('tp2@example.com', 'agent');
  await ctx.createUser('gone@example.com', 'agent', { isActive: false });
  await ctx.createUser('soc-bot@example.com', 'api_client');
  await admin.post('/api/v1/admin/teams', { name: 'Existing Team', teamid: 'e'.repeat(32) });
});
afterAll(async () => {
  await ctx.close();
});

describe('CSV parsing', () => {
  it('reads quoted fields with commas, quotes and line breaks, CRLF or LF', () => {
    expect(parseCsv('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4\n')).toEqual([
      ['a', 'b, c', 'say "hi"', 'x\ny'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('reads UTF-8 with or without a byte-order mark, and Big5 from a Traditional-Chinese Excel', () => {
    expect(decodeCsv(Buffer.from('﻿團隊'))).toBe('團隊');
    expect(decodeCsv(Buffer.from('團隊'))).toBe('團隊');
    const big5 = Buffer.from('b9ceb6a4a657bad92cbba1a9fa2ca6a8adfb20456d61696c0d0ab0aab6afa4c0a4bda571b8eab054b2d52cab6eb0cfbedac2492c0d0a', 'hex');
    expect(parseCsv(decodeCsv(big5))).toEqual([['團隊名稱', '說明', '成員 Email'], ['高雄分公司資訊組', '南區據點', '']]);
  });
});

describe('import', () => {
  it('offers a template with localized headers, to catalog managers only', async () => {
    const res = await admin.raw('GET', '/api/v1/admin/teams/import/template.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.text.trim()).toBe(HEADER); // the client drops the byte-order mark when decoding
    await ctx.createUser('eng@example.com', 'agent');
    expect((await (await ctx.login('eng@example.com')).get('/api/v1/admin/teams/import/template.csv')).status).toBe(403);
  });

  it('previews without writing, then creates the teams with optional members, generated or given TeamIDs', async () => {
    const data = csv([
      HEADER,
      `台北 SOC 藍隊,,總部 SOC,"tp1@example.com; TP2@example.com"`,
      `新竹廠區 IT,${'A'.repeat(32)},,`, // no members: a team can start empty
      ',,,', // blank rows are skipped
    ]);
    const before = await teamCount();
    const preview = (await admin.post('/api/v1/admin/teams/import/preview', { data })).body;
    expect(preview).toMatchObject({ valid: true, teams: 2, members: 2 });
    expect(preview.rows.map((r: any) => [r.line, r.name, r.members])).toEqual([
      [2, '台北 SOC 藍隊', ['tp1@example.com', 'tp2@example.com']],
      [3, '新竹廠區 IT', []],
    ]);
    expect(await teamCount()).toBe(before);

    const res = await admin.post('/api/v1/admin/teams/import', { data });
    expect(res.status).toBe(201);
    const created = res.body.created;
    expect(created.map((t: any) => [t.name, t.members])).toEqual([['台北 SOC 藍隊', 2], ['新竹廠區 IT', 0]]);
    expect(created[0].teamid).toMatch(/^[a-z0-9]{32}$/);
    expect(created[1].teamid).toBe('a'.repeat(32));
    const members = await ctx.db.select().from(teamMembers).where(eq(teamMembers.teamId, created[0].id));
    expect(members).toHaveLength(2);
    const [log] = await ctx.db.select().from(auditLogs).where(eq(auditLogs.action, 'admin.teams_imported'));
    expect(log.detail).toMatchObject({ teams: 2, members: 2 });
  });

  it('accepts English headers, columns in any order, and a file without a byte-order mark', async () => {
    const data = csv(['Description,Team name', 'Lab,English Header Team'], false);
    expect((await admin.post('/api/v1/admin/teams/import', { data })).status).toBe(201);
    const [row] = await ctx.db.select().from(teams).where(eq(teams.name, 'English Header Team'));
    expect(row.description).toBe('Lab');
  });

  it('reports every problem per row and imports nothing while any row is wrong', async () => {
    const data = csv([
      HEADER,
      ',,no name,',
      'existing team,,,', // same name as an existing team, ignoring case
      'Twice,,,',
      'twice,,,',
      `Bad TeamID,short,,`,
      `Used TeamID,${'e'.repeat(32)},,`,
      'Members,,,"tp1@example.com;nobody@example.com;gone@example.com;soc-bot@example.com;not-an-email"',
      'Fine,,,',
    ]);
    const preview = (await admin.post('/api/v1/admin/teams/import/preview', { data })).body;
    expect(preview.valid).toBe(false);
    const errors = Object.fromEntries(preview.rows.map((r: any) => [r.line, r.errors]));
    expect(errors[2]).toEqual([{ code: 'name_required' }]);
    expect(errors[3]).toEqual([{ code: 'name_exists', value: 'existing team' }]);
    expect(errors[4]).toEqual([]);
    expect(errors[5]).toEqual([{ code: 'name_repeated', value: '4' }]);
    expect(errors[6]).toEqual([{ code: 'teamid_invalid', value: 'short' }]);
    expect(errors[7]).toEqual([{ code: 'teamid_exists', value: 'e'.repeat(32) }]);
    expect(errors[8]).toEqual([
      { code: 'member_unknown', value: 'nobody@example.com' },
      { code: 'member_unknown', value: 'gone@example.com' }, // inactive
      { code: 'member_unknown', value: 'soc-bot@example.com' }, // API account
      { code: 'member_invalid', value: 'not-an-email' },
    ]);
    expect(errors[9]).toEqual([]);

    const before = await teamCount();
    const res = await admin.post('/api/v1/admin/teams/import', { data });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('import_invalid');
    expect(res.body.rows).toHaveLength(8);
    expect(await teamCount()).toBe(before);
    expect(await ctx.db.select().from(teams).where(inArray(teams.name, ['Twice', 'Fine']))).toHaveLength(0);
  });

  it('rejects files it cannot use', async () => {
    const code = async (data: string) => (await admin.post('/api/v1/admin/teams/import/preview', { data })).body.code;
    expect(await code(csv(['Name of thing,Other', 'x,y']))).toBe('import_no_header');
    expect(await code(csv([HEADER]))).toBe('import_empty');
    expect(await code('')).toBe('import_empty');
    expect(await code('not base64!')).toBe('import_file_invalid');
    expect(await code(csv([HEADER, ...Array.from({ length: 501 }, (_, i) => `Bulk ${i},,,`)]))).toBe('import_too_many_rows');
    expect(await code(b64(`${HEADER}\r\n${'x'.repeat(1024 * 1024)}\r\n`))).toBe('import_file_invalid');
  });
});
