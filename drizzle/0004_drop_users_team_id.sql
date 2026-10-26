ALTER TABLE "users" DROP CONSTRAINT "users_team_id_teams_id_fk";
--> statement-breakpoint
DROP INDEX "idx_users_team";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "team_id";