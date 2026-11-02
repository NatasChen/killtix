import { Hono } from 'hono';
import { z } from 'zod';
import { authOf, guard } from '../auth/session.js';
import type { AppEnv } from '../context.js';
import { forbidden } from '../errors.js';
import { audit } from '../services/audit.js';
import {
  advisoryCsvRows,
  advisoryDetail,
  advisoryFilterSchema,
  canManageAdvisories,
  canRespondAdvisories,
  createAdvisory,
  createAdvisorySchema,
  deleteAdvisory,
  listAdvisories,
  loadVisibleAdvisory,
  publishAdvisory,
  remindAdvisory,
  respondSchema,
  respondToAdvisory,
  setAdvisoryStatus,
  updateAdvisory,
  updateAdvisorySchema,
} from '../services/advisories.js';
import { csvCell } from './reports.js';
import { idParam, parseJson, parseWith } from './util.js';

/**
 * Threat-intel advisories (DECISIONS D24). Web only: no API-token scope, so tokens get 403 insufficient_scope.
 * HQ (advisory:manage) writes and follows them; teams (advisory:respond) answer for their own teams.
 */
const manage = guard({ permission: 'advisory:manage' });

export const advisoryRoutes = new Hono<AppEnv>()
  .get('/', guard(), async (c) => {
    const auth = authOf(c);
    if (!canManageAdvisories(auth.permissions) && !canRespondAdvisories(auth.permissions)) throw forbidden();
    return c.json(await listAdvisories(c.var.deps, auth, parseWith(advisoryFilterSchema, c.req.query())));
  })

  .post('/', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await createAdvisory(c.var.deps, auth, await parseJson(c, createAdvisorySchema));
    await audit(c, 'advisory.created', { type: 'advisory', id: advisory.id }, { status: advisory.status });
    return c.json(await advisoryDetail(c.var.deps, auth, advisory), 201);
  })

  .get('/:id', guard(), async (c) => {
    const auth = authOf(c);
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    return c.json(await advisoryDetail(c.var.deps, auth, advisory));
  })

  .patch('/:id', manage, async (c) => {
    const auth = authOf(c);
    const input = await parseJson(c, updateAdvisorySchema);
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    const updated = await updateAdvisory(c.var.deps, auth, advisory, input);
    await audit(c, 'advisory.updated', { type: 'advisory', id: advisory.id }, { fields: Object.keys(input) });
    return c.json(await advisoryDetail(c.var.deps, auth, updated));
  })

  .delete('/:id', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    await deleteAdvisory(c.var.deps, advisory);
    await audit(c, 'advisory.deleted', { type: 'advisory', id: advisory.id }, { number: advisory.number });
    return c.body(null, 204);
  })

  .post('/:id/publish', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await publishAdvisory(c.var.deps, auth, await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id')));
    await audit(c, 'advisory.published', { type: 'advisory', id: advisory.id });
    return c.json(await advisoryDetail(c.var.deps, auth, advisory));
  })

  .post('/:id/close', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await setAdvisoryStatus(c.var.deps, await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id')), 'closed');
    await audit(c, 'advisory.closed', { type: 'advisory', id: advisory.id });
    return c.json(await advisoryDetail(c.var.deps, auth, advisory));
  })

  .post('/:id/reopen', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await setAdvisoryStatus(c.var.deps, await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id')), 'published');
    await audit(c, 'advisory.reopened', { type: 'advisory', id: advisory.id });
    return c.json(await advisoryDetail(c.var.deps, auth, advisory));
  })

  .post('/:id/remind', manage, async (c) => {
    const auth = authOf(c);
    const { teamIds } = await parseJson(c, z.object({ teamIds: z.array(z.number().int().positive()).max(500).optional() }).strict());
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    const reminded = await remindAdvisory(c.var.deps, auth, advisory, teamIds);
    await audit(c, 'advisory.reminded', { type: 'advisory', id: advisory.id }, { teams: reminded });
    return c.json({ reminded });
  })

  // a team's answer: members of that team (advisory:respond), or HQ on the team's behalf
  .put('/:id/teams/:teamId', guard(), async (c) => {
    const auth = authOf(c);
    const input = await parseJson(c, respondSchema);
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    const teamId = idParam(c, 'teamId');
    await respondToAdvisory(c.var.deps, auth, advisory, teamId, input);
    await audit(c, 'advisory.responded', { type: 'advisory', id: advisory.id }, { teamId, exposure: input.exposure });
    return c.json(await advisoryDetail(c.var.deps, auth, advisory));
  })

  .get('/:id/responses.csv', manage, async (c) => {
    const auth = authOf(c);
    const advisory = await loadVisibleAdvisory(c.var.deps, auth, c.req.param('id'));
    const header = [
      'advisory', 'title', 'severity', 'team', 'exposure', 'affected_scope', 'action_plan', 'action_detail', 'action_status',
      'target_date', 'complete', 'overdue', 'responded_by', 'responded_at',
    ];
    const rows = await advisoryCsvRows(c.var.deps, auth, advisory);
    await audit(c, 'advisory.exported', { type: 'advisory', id: advisory.id }, { rows: rows.length });
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${advisory.number}.csv"`);
    // UTF-8 BOM so Excel opens Chinese text correctly
    return c.body(`﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
  });
