CREATE TABLE "brand_logos" (
	"variant" varchar(8) PRIMARY KEY NOT NULL,
	"data" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_brand_logos_variant" CHECK ("brand_logos"."variant" in ('light','dark'))
);
--> statement-breakpoint
ALTER TABLE "brand_logos" ADD CONSTRAINT "brand_logos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;