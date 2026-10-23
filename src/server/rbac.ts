import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import { tickets, ticketWatchers, type User } from './db/schema.js';

/**
 * Permission catalogue.
 *  ticket:read:all | ticket:read:team | ticket:read:own  - which tickets are visible
 *  ticket:note    - staff: see/write internal notes and internal custom fields
 *  ticket:update  - change status
 *  ticket:triage  - change priority, tags, help topic
 *  ticket:assign  - change assignee/team, manage watchers
 */
export const ROLE_DEFINITIONS: Record<string, { name: string; description: string; permissions: string[] }> = {
  super_admin: { name: '系統管理員', description: '全功能系統管理', permissions: ['*'] },
  it_manager: {
    name: 'IT 服務主管',
    description: '全部工單、報表匯出、目錄管理',
    permissions: [
      'ticket:create', 'ticket:read:all', 'ticket:reply', 'ticket:note', 'ticket:update', 'ticket:triage',
      'ticket:assign', 'report:export', 'catalog:manage',
    ],
  },
  agent: {
    name: '內部工程師',
    description: '所屬團隊佇列、被指派與關注的工單',
    permissions: [
      'ticket:create', 'ticket:read:team', 'ticket:reply', 'ticket:note', 'ticket:update', 'ticket:triage', 'ticket:assign',
    ],
  },
  vendor: {
    name: '外部廠商',
    description: '僅被指派或被加入關注的工單',
    permissions: ['ticket:read:own', 'ticket:reply', 'ticket:update'],
  },
  end_user: {
    name: '一般使用者',
    description: '開單、回覆、檢視自身或被加入關注的工單',
    permissions: ['ticket:create', 'ticket:read:own', 'ticket:reply'],
  },
  api_client: {
    name: '外部系統',
    description: '透過 API Token 開單與查詢自己開立的工單',
    permissions: ['ticket:create', 'ticket:read:own'],
  },
};

export const can = (perms: string[], permission: string) => perms.includes('*') || perms.includes(permission);

/** Staff can see internal notes and internal custom fields. */
export const isStaff = (perms: string[]) => can(perms, 'ticket:note');

/**
 * Row-level visibility condition for tickets, applied in the SQL query itself so that
 * unauthorized rows are never loaded (IDOR protection). Returns undefined for "all".
 */
export function ticketScope(user: Pick<User, 'id' | 'teamId'>, perms: string[], tokenId?: number): SQL | undefined {
  if (can(perms, 'ticket:read:all')) return undefined;
  const related = or(
    eq(tickets.requesterId, user.id),
    eq(tickets.assigneeId, user.id),
    // API clients also see tickets they opened on behalf of another requester.
    tokenId ? eq(tickets.externalSource, `token:${tokenId}`) : undefined,
    exists(
      sql`(select 1 from ${ticketWatchers} where ${and(
        eq(ticketWatchers.ticketId, tickets.id),
        eq(ticketWatchers.userId, user.id),
      )})`,
    ),
  )!;
  if (can(perms, 'ticket:read:team') && user.teamId != null) {
    return or(related, eq(tickets.teamId, user.teamId))!;
  }
  if (can(perms, 'ticket:read:team') || can(perms, 'ticket:read:own')) return related;
  return sql`false`;
}
