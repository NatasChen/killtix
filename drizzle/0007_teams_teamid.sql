ALTER TABLE "teams" ADD COLUMN "teamid" varchar(32) DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_teamid_unique" UNIQUE("teamid");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "chk_teams_teamid" CHECK ("teams"."teamid" ~ '^[a-z0-9]{32}$');