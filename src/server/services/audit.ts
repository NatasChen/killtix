import { auditLogs } from '../db/schema.js';
import { clientIp, type AppContext } from '../context.js';

export async function audit(
  c: AppContext,
  action: string,
  target?: { type: string; id: string | number },
  detail?: Record<string, unknown>,
  actorId: number | null = c.var.auth?.user.id ?? null,
) {
  await c.var.deps.db.insert(auditLogs).values({
    actorId,
    action,
    targetType: target?.type,
    targetId: target === undefined ? undefined : String(target.id),
    detail,
    ip: clientIp(c),
  });
}
