import { Hono } from 'hono';
import { z } from 'zod';
import { authOf, guard } from '../auth/session.js';
import type { AppEnv } from '../context.js';
import { audit } from '../services/audit.js';
import {
  addThread,
  addWatcher,
  createTicket,
  createTicketSchema,
  customFieldFiltersFromQuery,
  listTickets,
  loadVisibleTicket,
  removeWatcher,
  threadSchema,
  ticketDetail,
  ticketFilterSchema,
  ticketSummary,
  updateTicket,
  updateTicketSchema,
} from '../services/tickets.js';
import { idParam, parseJson, parseWith, rateLimit } from './util.js';

export const ticketRoutes = new Hono<AppEnv>()
  // Per-token rate limit for external systems.
  .use(async (c, next) => {
    const auth = c.var.auth;
    if (auth?.via === 'token') await rateLimit(c, `token:${auth.tokenId}`, c.var.deps.config.rateLimitPerMin);
    await next();
  })

  .get('/', guard({ tokenScope: 'tickets:read' }), async (c) => {
    const query = c.req.query();
    const filters = { ...parseWith(ticketFilterSchema, query), customFields: customFieldFiltersFromQuery(query) };
    return c.json(await listTickets(c.var.deps, authOf(c), filters));
  })

  .post('/', guard({ permission: 'ticket:create', tokenScope: 'tickets:write' }), async (c) => {
    const auth = authOf(c);
    const input = await parseJson(c, createTicketSchema);
    const idempotencyKey = c.req.header('idempotency-key');
    if (idempotencyKey) input.externalId = parseWith(z.string().trim().min(1).max(255), idempotencyKey);
    const { ticket, created } = await createTicket(c.var.deps, auth, input, auth.via === 'token' ? 'api' : 'web');
    if (created) await audit(c, 'ticket.created', { type: 'ticket', id: ticket.id }, { source: ticket.source });
    else c.header('Idempotent-Replayed', 'true');
    // Replays must not reveal more than the original creation response did.
    return c.json(ticketSummary(ticket, c.var.deps.clock()), created ? 201 : 200);
  })

  .get('/:id', guard({ tokenScope: 'tickets:read' }), async (c) => {
    const auth = authOf(c);
    const ticket = await loadVisibleTicket(c.var.deps, auth, c.req.param('id'));
    return c.json(await ticketDetail(c.var.deps, auth, ticket));
  })

  .patch('/:id', guard(), async (c) => {
    const auth = authOf(c);
    const input = await parseJson(c, updateTicketSchema);
    const ticket = await loadVisibleTicket(c.var.deps, auth, c.req.param('id'));
    const updated = await updateTicket(c.var.deps, auth, ticket, input);
    await audit(c, 'ticket.updated', { type: 'ticket', id: ticket.id }, { fields: Object.keys(input) });
    return c.json(await ticketDetail(c.var.deps, auth, updated));
  })

  .post('/:id/threads', guard(), async (c) => {
    const auth = authOf(c);
    const input = await parseJson(c, threadSchema);
    const ticket = await loadVisibleTicket(c.var.deps, auth, c.req.param('id'));
    const { thread } = await addThread(c.var.deps, auth, ticket, input);
    return c.json(thread, 201);
  })

  .post('/:id/watchers', guard({ permission: 'ticket:assign' }), async (c) => {
    const auth = authOf(c);
    const { userId } = await parseJson(c, z.object({ userId: z.number().int().positive() }));
    const ticket = await loadVisibleTicket(c.var.deps, auth, c.req.param('id'));
    await addWatcher(c.var.deps, ticket, userId);
    await audit(c, 'ticket.watcher_added', { type: 'ticket', id: ticket.id }, { userId });
    return c.body(null, 204);
  })

  .delete('/:id/watchers/:userId', guard({ permission: 'ticket:assign' }), async (c) => {
    const auth = authOf(c);
    const ticket = await loadVisibleTicket(c.var.deps, auth, c.req.param('id'));
    const userId = idParam(c, 'userId');
    await removeWatcher(c.var.deps, ticket, userId);
    await audit(c, 'ticket.watcher_removed', { type: 'ticket', id: ticket.id }, { userId });
    return c.body(null, 204);
  });
