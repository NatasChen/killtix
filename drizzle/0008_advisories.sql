CREATE SEQUENCE "public"."advisory_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "advisories" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"source" varchar(255),
	"severity" varchar(16) DEFAULT 'medium' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_products" text DEFAULT '' NOT NULL,
	"iocs" text DEFAULT '' NOT NULL,
	"references" text DEFAULT '' NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"response_due_at" timestamp with time zone,
	"created_by" integer,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisories_number_unique" UNIQUE("number"),
	CONSTRAINT "chk_advisories_status" CHECK ("status" in ('draft','published','closed')),
	CONSTRAINT "chk_advisories_severity" CHECK ("severity" in ('low','medium','high','critical'))
);
--> statement-breakpoint
CREATE TABLE "advisory_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"advisory_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"exposure" varchar(16) DEFAULT 'pending' NOT NULL,
	"affected_scope" text DEFAULT '' NOT NULL,
	"action_plan" varchar(16),
	"action_detail" text DEFAULT '' NOT NULL,
	"action_status" varchar(16),
	"target_date" date,
	"responded_by" integer,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_advisory_targets_exposure" CHECK ("exposure" in ('pending','investigating','not_affected','affected')),
	CONSTRAINT "chk_advisory_targets_plan" CHECK ("advisory_targets"."action_plan" is null or "action_plan" in ('patch','mitigate','accept_risk','other')),
	CONSTRAINT "chk_advisory_targets_action" CHECK ("advisory_targets"."action_status" is null or "action_status" in ('not_started','in_progress','done'))
);
--> statement-breakpoint
CREATE TABLE "advisory_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target_id" integer NOT NULL,
	"author_id" integer,
	"exposure" varchar(16) NOT NULL,
	"affected_scope" text DEFAULT '' NOT NULL,
	"action_plan" varchar(16),
	"action_detail" text DEFAULT '' NOT NULL,
	"action_status" varchar(16),
	"target_date" date,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "advisories" ADD CONSTRAINT "advisories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_targets" ADD CONSTRAINT "advisory_targets_advisory_id_advisories_id_fk" FOREIGN KEY ("advisory_id") REFERENCES "public"."advisories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_targets" ADD CONSTRAINT "advisory_targets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_targets" ADD CONSTRAINT "advisory_targets_responded_by_users_id_fk" FOREIGN KEY ("responded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_updates" ADD CONSTRAINT "advisory_updates_target_id_advisory_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."advisory_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advisory_updates" ADD CONSTRAINT "advisory_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_advisories_status" ON "advisories" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_advisory_targets" ON "advisory_targets" USING btree ("advisory_id","team_id");--> statement-breakpoint
CREATE INDEX "idx_advisory_targets_team" ON "advisory_targets" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_advisory_updates_target" ON "advisory_updates" USING btree ("target_id","created_at");