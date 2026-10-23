CREATE SEQUENCE "public"."ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" integer NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"detail" jsonb,
	"ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"body" text NOT NULL,
	"team_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_id" integer NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" varchar(16) NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regex" varchar(255),
	"visibility" varchar(16) DEFAULT 'public' NOT NULL,
	"is_filterable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_custom_fields_visibility" CHECK ("custom_fields"."visibility" in ('public','internal'))
);
--> statement-breakpoint
CREATE TABLE "glossary_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"locale" varchar(16) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"parent_id" integer,
	"form_id" integer,
	"sla_plan_id" integer,
	"default_team_id" integer,
	"auto_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "help_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"recipient" varchar(512) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stage" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sessions_stage" CHECK ("sessions"."stage" in ('full','password_change','mfa_verify','mfa_enroll'))
);
--> statement-breakpoint
CREATE TABLE "sla_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"first_response_minutes" integer NOT NULL,
	"resolution_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16) DEFAULT '#6B7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ticket_field_values" (
	"ticket_id" integer NOT NULL,
	"field_id" integer NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "ticket_field_values_ticket_id_field_id_pk" PRIMARY KEY("ticket_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_forms_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ticket_tags" (
	"ticket_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "ticket_tags_ticket_id_tag_id_pk" PRIMARY KEY("ticket_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_threads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" integer,
	"type" varchar(24) NOT NULL,
	"visibility" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"source" varchar(16) DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_thread_type" CHECK ("ticket_threads"."type" in ('customer_message','agent_reply','internal_note','system_event')),
	CONSTRAINT "chk_thread_visibility" CHECK ("ticket_threads"."visibility" in ('public','internal')),
	CONSTRAINT "chk_thread_internal_note" CHECK ("ticket_threads"."type" <> 'internal_note' or "ticket_threads"."visibility" = 'internal')
);
--> statement-breakpoint
CREATE TABLE "ticket_watchers" (
	"ticket_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_watchers_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" varchar(32) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"help_topic_id" integer,
	"form_id" integer,
	"sla_plan_id" integer,
	"requester_id" integer,
	"assignee_id" integer,
	"team_id" integer,
	"source" varchar(16) DEFAULT 'web' NOT NULL,
	"external_source" varchar(64),
	"external_id" varchar(255),
	"first_response_due_at" timestamp with time zone,
	"resolution_due_at" timestamp with time zone,
	"first_responded_at" timestamp with time zone,
	"sla_paused_at" timestamp with time zone,
	"sla_status" varchar(16) DEFAULT 'on_track' NOT NULL,
	"sla_breach_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "chk_tickets_priority" CHECK ("tickets"."priority" between 1 and 5),
	CONSTRAINT "chk_tickets_status" CHECK ("tickets"."status" in ('new','open','pending_user','resolved','closed')),
	CONSTRAINT "chk_tickets_sla_status" CHECK ("tickets"."sla_status" in ('on_track','at_risk','breached','met'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(128) NOT NULL,
	"password_hash" varchar(255),
	"role_key" varchar(32) NOT NULL,
	"team_id" integer,
	"identity_provider" varchar(16) DEFAULT 'local' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_bootstrap_admin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_updated_at" timestamp with time zone,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"totp_secret" varchar(255),
	"totp_pending_secret" varchar(255),
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-TW' NOT NULL,
	"theme" varchar(8) DEFAULT 'system' NOT NULL,
	"telegram_chat_id" varchar(64),
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "chk_users_email_lower" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "chk_users_theme" CHECK ("users"."theme" in ('light','dark','system'))
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_form_id_ticket_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."ticket_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_topics" ADD CONSTRAINT "help_topics_parent_id_help_topics_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."help_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_topics" ADD CONSTRAINT "help_topics_form_id_ticket_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."ticket_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_topics" ADD CONSTRAINT "help_topics_sla_plan_id_sla_plans_id_fk" FOREIGN KEY ("sla_plan_id") REFERENCES "public"."sla_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_topics" ADD CONSTRAINT "help_topics_default_team_id_teams_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_threads" ADD CONSTRAINT "ticket_threads_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_help_topic_id_help_topics_id_fk" FOREIGN KEY ("help_topic_id") REFERENCES "public"."help_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_form_id_ticket_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."ticket_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sla_plan_id_sla_plans_id_fk" FOREIGN KEY ("sla_plan_id") REFERENCES "public"."sla_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_custom_fields_form_key" ON "custom_fields" USING btree ("form_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_glossary_locale_key" ON "glossary_terms" USING btree ("locale","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_dedup" ON "notification_logs" USING btree ("event_id","channel","recipient");--> statement-breakpoint
CREATE INDEX "idx_notification_pending" ON "notification_logs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_password_history_user" ON "password_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tfv_field_value" ON "ticket_field_values" USING btree ("field_id","value");--> statement-breakpoint
CREATE INDEX "idx_ticket_tags_tag" ON "ticket_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_threads_ticket" ON "ticket_threads" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_watchers_user" ON "ticket_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tickets_external" ON "tickets" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status_created" ON "tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_tickets_assignee" ON "tickets" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_team" ON "tickets" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_requester" ON "tickets" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role_key");--> statement-breakpoint
CREATE INDEX "idx_users_team" ON "users" USING btree ("team_id");