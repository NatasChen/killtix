ALTER TABLE "users" DROP CONSTRAINT "chk_users_theme";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "theme" SET DEFAULT 'light';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "chk_users_theme" CHECK ("users"."theme" in ('light','dark'));