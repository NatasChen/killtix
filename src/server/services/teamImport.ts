import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../context.js';
import { teamMembers, teams, users } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { teamidSchema } from './tickets.js';

/*
 * Teams imported from a CSV file (DECISIONS D26): one team per row, all-or-nothing. A file is checked first (preview,
 * nothing written) and imported only when every row is valid. Every team is new: a name or TeamID already in use is
 * an error, as is a member e-mail without an active, non-API account. Members are optional.
 */

export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_MAX_ROWS = 500;
const NAME_MAX = 128;
const DESCRIPTION_MAX = 2000;

export const COLUMNS = ['name', 'teamid', 'description', 'members'] as const;
type Column = (typeof COLUMNS)[number];

// generous cap on the JSON itself; the decoded size is checked against IMPORT_MAX_BYTES with a clear error
export const importSchema = z.object({ data: z.string().max(4 * IMPORT_MAX_BYTES) }).strict();

/** A row's problem; the web page turns `code` into text (ui.teams.import.error.<code>), `value` is the offending input. */
export interface RowError {
  code:
    | 'name_required'
    | 'name_too_long'
    | 'name_exists'
    | 'name_repeated'
    | 'teamid_invalid'
    | 'teamid_exists'
    | 'teamid_repeated'
    | 'description_too_long'
    | 'member_invalid'
    | 'member_unknown';
  value?: string;
}
export interface ImportRow {
  /** the row's number in the spreadsheet (the header is row 1) */
  line: number;
  name: string;
  teamid: string | null;
  description: string;
  members: string[];
  errors: RowError[];
}

/**
 * The file's text. Excel saves "CSV UTF-8" with a byte-order mark; a Traditional-Chinese Windows Excel saving plain
 * "CSV" writes Big5 instead, so anything that is not valid UTF-8 is read as Big5 rather than shown as garbage.
 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('big5').decode(bytes);
  }
}

/** RFC 4180 CSV: quoted fields may hold commas, line breaks and doubled quotes; CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const normalizeHeader = (h: string) => h.replace(/[*＊]/g, '').replace(/\s+/g, '').toLowerCase();

/** Header names accepted for each column: the column key and its label in every built-in locale (template headers). */
function headerAliases(deps: Pick<Deps, 'glossary'>): Map<string, Column> {
  const map = new Map<string, Column>();
  for (const col of COLUMNS) {
    map.set(normalizeHeader(col), col);
    for (const locale of ['zh-TW', 'en-US']) map.set(normalizeHeader(deps.glossary.t(locale, `ui.teams.import.col.${col}`)), col);
  }
  return map;
}

/** The template's header row in the given locale (required columns marked with *). */
export function templateCsv(deps: Pick<Deps, 'glossary'>, locale: string): string {
  const header = COLUMNS.map((col) => `${deps.glossary.t(locale, `ui.teams.import.col.${col}`)}${col === 'name' ? ' *' : ''}`);
  return `﻿${header.join(',')}\r\n`;
}

const isEmail = (v: string) => z.email().safeParse(v).success;

/** Decodes, parses and checks a file; throws ApiError for a file that cannot be read at all. */
export async function checkImport(deps: Deps, base64: string): Promise<ImportRow[]> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ApiError(400, 'import_file_invalid');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ApiError(400, 'import_empty');
  if (bytes.length > IMPORT_MAX_BYTES) throw new ApiError(400, 'import_file_invalid');

  const table = parseCsv(decodeCsv(bytes));
  const aliases = headerAliases(deps);
  const header = (table[0] ?? []).map((h) => aliases.get(normalizeHeader(h)));
  if (!header.includes('name')) throw new ApiError(400, 'import_no_header');
  const cell = (cells: string[], col: Column) => {
    const i = header.indexOf(col);
    return i < 0 ? '' : (cells[i] ?? '').trim();
  };

  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return; // blank lines, e.g. the end of the file
    rows.push({
      line: i + 2,
      name: cell(cells, 'name'),
      teamid: cell(cells, 'teamid') || null,
      description: cell(cells, 'description'),
      members: [...new Set(cell(cells, 'members').split(/[\s,;，；]+/).map((m) => m.toLowerCase()).filter(Boolean))],
      errors: [],
    });
  });
  if (!rows.length) throw new ApiError(400, 'import_empty');
  if (rows.length > IMPORT_MAX_ROWS) throw new ApiError(400, 'import_too_many_rows');

  // existing teams, compared case-insensitively by name
  const names = rows.map((r) => r.name.toLowerCase()).filter(Boolean);
  const existingNames = new Set(
    names.length
      ? (await deps.db.select({ name: teams.name }).from(teams).where(inArray(sql`lower(${teams.name})`, names))).map((r) => r.name.toLowerCase())
      : [],
  );
  const teamids = rows.map((r) => r.teamid?.toLowerCase()).filter((v): v is string => !!v);
  const existingTeamids = new Set(
    teamids.length ? (await deps.db.select({ teamid: teams.teamid }).from(teams).where(inArray(teams.teamid, teamids))).map((r) => r.teamid) : [],
  );
  // members: active accounts that are not API clients (same rule as adding members on the teams page)
  const emails = [...new Set(rows.flatMap((r) => r.members))];
  const known = new Set(
    emails.length
      ? (
          await deps.db
            .select({ email: users.email })
            .from(users)
            .where(and(inArray(users.email, emails), eq(users.isActive, true), ne(users.roleKey, 'api_client')))
        ).map((r) => r.email)
      : [],
  );

  const seenNames = new Map<string, number>();
  const seenTeamids = new Map<string, number>();
  for (const r of rows) {
    const add = (code: RowError['code'], value?: string) => r.errors.push(value === undefined ? { code } : { code, value });
    const lname = r.name.toLowerCase();
    if (!r.name) add('name_required');
    else if (r.name.length > NAME_MAX) add('name_too_long');
    else if (existingNames.has(lname)) add('name_exists', r.name);
    else if (seenNames.has(lname)) add('name_repeated', String(seenNames.get(lname)));
    if (r.name) seenNames.set(lname, seenNames.get(lname) ?? r.line);

    if (r.teamid) {
      const parsed = teamidSchema.safeParse(r.teamid);
      if (!parsed.success) add('teamid_invalid', r.teamid);
      else {
        r.teamid = parsed.data;
        if (existingTeamids.has(r.teamid)) add('teamid_exists', r.teamid);
        else if (seenTeamids.has(r.teamid)) add('teamid_repeated', String(seenTeamids.get(r.teamid)));
        else seenTeamids.set(r.teamid, r.line);
      }
    }
    if (r.description.length > DESCRIPTION_MAX) add('description_too_long');
    for (const m of r.members) {
      if (!isEmail(m)) add('member_invalid', m);
      else if (!known.has(m)) add('member_unknown', m);
    }
  }
  return rows;
}

/** Creates every team and its members in one transaction; the caller has checked that no row has errors. */
export async function importTeams(deps: Deps, rows: ImportRow[]) {
  const emails = [...new Set(rows.flatMap((r) => r.members))];
  const ids = new Map(
    emails.length
      ? (await deps.db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, emails))).map((u) => [u.email, u.id])
      : [],
  );
  return deps.db.transaction(async (tx) => {
    const created: { id: number; name: string; teamid: string; members: number }[] = [];
    for (const r of rows) {
      const [team] = await tx
        .insert(teams)
        .values({ name: r.name, description: r.description || null, ...(r.teamid ? { teamid: r.teamid } : {}) })
        .returning();
      const userIds = r.members.map((m) => ids.get(m)!).filter(Boolean);
      if (userIds.length) await tx.insert(teamMembers).values(userIds.map((userId) => ({ teamId: team.id, userId }))).onConflictDoNothing();
      created.push({ id: team.id, name: team.name, teamid: team.teamid, members: userIds.length });
    }
    return created;
  });
}

/** What the preview reports besides the rows. */
export function summarize(rows: ImportRow[]) {
  return {
    rows,
    valid: rows.every((r) => !r.errors.length),
    teams: rows.length,
    members: rows.reduce((n, r) => n + r.members.length, 0),
  };
}
