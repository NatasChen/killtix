-- Custom SQL migration file, put your code below! --
-- Copy the deprecated users.team_id into team_members before 0004 drops the column (DECISIONS D14).
-- Deployments that already ran v0.5.0 or v0.6.0 did this at startup and recorded the flag below; they are
-- skipped, so members an administrator removed since then are not added back.
INSERT INTO "team_members" ("team_id", "user_id")
SELECT "team_id", "id" FROM "users"
WHERE "team_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "system_settings" WHERE "key" = 'migrations.team_members_backfilled')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The startup backfill is gone with the column, so its flag is no longer read.
DELETE FROM "system_settings" WHERE "key" = 'migrations.team_members_backfilled';
