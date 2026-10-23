# Cloudflare Workers track — EXPERIMENTAL, NOT IMPLEMENTED

`wrangler.toml.example` is a planning sketch carried over from the original design documents.
**There is no Workers build of TicketDesk yet**; the supported deployment is Docker
(see [the deployment guide](../../docs/DEPLOYMENT_GUIDE.md)).

What porting would involve, so the decision can be made with eyes open:

| Area | Docker today | Workers gap |
| --- | --- | --- |
| HTTP framework | Hono | Hono runs on Workers unchanged |
| Database | PostgreSQL via Drizzle | D1 is SQLite: needs a second Drizzle schema/migrations (no `jsonb`, sequences, `ilike`, partial indexes) |
| Background jobs | in-process timers | Cron Triggers + Queues consumers |
| Rate limit | Redis | KV or Durable Objects |
| Password hashing | bcrypt cost 12 | CPU time limits; bcrypt at cost 12 may exceed the free/standard CPU budget |
| E-mail | SMTP (nodemailer) | No raw TCP SMTP; use an HTTP mail API |
| AD/LDAP (v1.1) | direct LDAPS | Not possible from Workers without Cloudflare Tunnel + relay service |

Recommendation: keep Docker as the only supported track until the v1.1 SSO work is done,
then decide whether the edge track is still needed.
