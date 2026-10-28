import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').notNull().defaultNow();
const updatedAt = () => tstz('updated_at').notNull().defaultNow().$onUpdate(() => new Date());

export const TICKET_STATUSES = ['new', 'open', 'pending_user', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CLOSED_STATUSES: TicketStatus[] = ['resolved', 'closed'];

export const THREAD_TYPES = ['customer_message', 'agent_reply', 'internal_note', 'system_event'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox', 'email', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SESSION_STAGES = ['full', 'password_change', 'mfa_verify', 'mfa_enroll'] as const;
export type SessionStage = (typeof SESSION_STAGES)[number];

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------
export const roles = pgTable('roles', {
  key: varchar('key', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull().unique(),
  description: text('description'),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    // Always stored lower-cased by the application.
    email: varchar('email', { length: 255 }).notNull().unique(),
    displayName: varchar('display_name', { length: 128 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }), // NULL = cannot log in locally
    roleKey: varchar('role_key', { length: 32 })
      .notNull()
      .references(() => roles.key),
    identityProvider: varchar('identity_provider', { length: 16 }).notNull().default('local'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    isBootstrapAdmin: boolean('is_bootstrap_admin').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    passwordUpdatedAt: tstz('password_updated_at'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    totpSecret: varchar('totp_secret', { length: 255 }), // AES-GCM encrypted
    totpPendingSecret: varchar('totp_pending_secret', { length: 255 }),
    recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().notNull().default([]),
    locale: varchar('locale', { length: 16 }).notNull().default('zh-TW'),
    theme: varchar('theme', { length: 8 }).notNull().default('light'),
    telegramChatId: varchar('telegram_chat_id', { length: 64 }),
    lastLoginAt: tstz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('idx_users_role').on(t.roleKey),
    check('chk_users_email_lower', sql`${t.email} = lower(${t.email})`),
    check('chk_users_theme', sql`${t.theme} in ('light','dark')`),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index('idx_team_members_user').on(t.userId)],
);

export const passwordHistory = pgTable(
  'password_history',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idx_password_history_user').on(t.userId, t.createdAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(), // sha256 hex of the cookie value
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 16 }).$type<SessionStage>().notNull(),
    expiresAt: tstz('expires_at').notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    check('chk_sessions_stage', sql`${t.stage} in ('full','password_change','mfa_verify','mfa_enroll')`),
  ],
);

export const apiTokens = pgTable('api_tokens', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  prefix: varchar('prefix', { length: 16 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  // The api_client user the token acts as (requester of tickets it opens).
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  expiresAt: tstz('expires_at'),
  lastUsedAt: tstz('last_used_at'),
  revokedAt: tstz('revoked_at'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const LOGO_VARIANTS = ['light', 'dark'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

// Company logo (PNG), one per theme; base64 so both DB drivers return the same type.
export const brandLogos = pgTable(
  'brand_logos',
  {
    variant: varchar('variant', { length: 8 }).$type<LogoVariant>().primaryKey(),
    data: text('data').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [check('chk_brand_logos_variant', sql`${t.variant} in ('light','dark')`)],
);

// ---------------------------------------------------------------------------
// Catalog: SLA plans, forms, custom fields, help topics, tags, canned responses
// ---------------------------------------------------------------------------
export const slaPlans = pgTable('sla_plans', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull().unique(),
  firstResponseMinutes: integer('first_response_minutes').notNull(),
  resolutionMinutes: integer('resolution_minutes').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const ticketForms = pgTable('ticket_forms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull().unique(),
  description: text('description'),
  createdAt: createdAt(),
});

export const customFields = pgTable(
  'custom_fields',
  {
    id: serial('id').primaryKey(),
    formId: integer('form_id')
      .notNull()
      .references(() => ticketForms.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 64 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    type: varchar('type', { length: 16 }).$type<FieldType>().notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    options: jsonb('options').$type<string[]>().notNull().default([]),
    regex: varchar('regex', { length: 255 }),
    // public: visible to requester/vendor; internal: staff only
    visibility: varchar('visibility', { length: 16 }).$type<'public' | 'internal'>().notNull().default('public'),
    isFilterable: boolean('is_filterable').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_custom_fields_form_key').on(t.formId, t.key),
    check('chk_custom_fields_visibility', sql`${t.visibility} in ('public','internal')`),
  ],
);

export const helpTopics = pgTable('help_topics', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 64 }).notNull().unique(),
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  parentId: integer('parent_id').references((): AnyPgColumn => helpTopics.id, { onDelete: 'set null' }),
  formId: integer('form_id').references(() => ticketForms.id, { onDelete: 'set null' }),
  slaPlanId: integer('sla_plan_id').references(() => slaPlans.id, { onDelete: 'set null' }),
  defaultTeamId: integer('default_team_id').references(() => teams.id, { onDelete: 'set null' }),
  autoTags: jsonb('auto_tags').$type<string[]>().notNull().default([]),
  isPublic: boolean('is_public').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  color: varchar('color', { length: 16 }).notNull().default('#6B7280'),
  createdAt: createdAt(),
});

export const cannedResponses = pgTable('canned_responses', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  body: text('body').notNull(),
  teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
export const ticketNumberSeq = pgSequence('ticket_number_seq', { startWith: 1, increment: 1 });

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    number: varchar('number', { length: 32 }).notNull().unique(),
    subject: varchar('subject', { length: 512 }).notNull(),
    description: text('description').notNull().default(''),
    status: varchar('status', { length: 16 }).$type<TicketStatus>().notNull().default('new'),
    priority: smallint('priority').notNull().default(3),
    helpTopicId: integer('help_topic_id').references(() => helpTopics.id, { onDelete: 'set null' }),
    formId: integer('form_id').references(() => ticketForms.id, { onDelete: 'set null' }),
    slaPlanId: integer('sla_plan_id').references(() => slaPlans.id, { onDelete: 'set null' }),
    requesterId: integer('requester_id').references(() => users.id, { onDelete: 'set null' }),
    assigneeId: integer('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: integer('team_id').references(() => teams.id, { onDelete: 'set null' }),
    source: varchar('source', { length: 16 }).notNull().default('web'),
    // Idempotency for external systems: unique per API token.
    externalSource: varchar('external_source', { length: 64 }),
    externalId: varchar('external_id', { length: 255 }),
    firstResponseDueAt: tstz('first_response_due_at'),
    resolutionDueAt: tstz('resolution_due_at'),
    firstRespondedAt: tstz('first_responded_at'),
    slaPausedAt: tstz('sla_paused_at'),
    slaStatus: varchar('sla_status', { length: 16 }).notNull().default('on_track'),
    slaBreachNotifiedAt: tstz('sla_breach_notified_at'),
    resolvedAt: tstz('resolved_at'),
    closedAt: tstz('closed_at'),
    reopenCount: integer('reopen_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('uq_tickets_external').on(t.externalSource, t.externalId),
    index('idx_tickets_status_created').on(t.status, t.createdAt),
    index('idx_tickets_assignee').on(t.assigneeId, t.status),
    index('idx_tickets_team').on(t.teamId, t.status),
    index('idx_tickets_requester').on(t.requesterId),
    check('chk_tickets_priority', sql`${t.priority} between 1 and 5`),
    check('chk_tickets_status', sql`${t.status} in ('new','open','pending_user','resolved','closed')`),
    check('chk_tickets_sla_status', sql`${t.slaStatus} in ('on_track','at_risk','breached','met')`),
  ],
);

export const ticketFieldValues = pgTable(
  'ticket_field_values',
  {
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customFields.id, { onDelete: 'cascade' }),
    // Scalar values as text; multiselect stored as JSON array text.
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.fieldId] }), index('idx_tfv_field_value').on(t.fieldId, t.value)],
);

export const ticketThreads = pgTable(
  'ticket_threads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 24 }).$type<ThreadType>().notNull(),
    visibility: varchar('visibility', { length: 16 }).$type<'public' | 'internal'>().notNull(),
    body: text('body').notNull(),
    source: varchar('source', { length: 16 }).notNull().default('web'),
    createdAt: createdAt(),
  },
  (t) => [
    index('idx_threads_ticket').on(t.ticketId, t.createdAt),
    check('chk_thread_type', sql`${t.type} in ('customer_message','agent_reply','internal_note','system_event')`),
    check('chk_thread_visibility', sql`${t.visibility} in ('public','internal')`),
    // An internal note can never be public.
    check('chk_thread_internal_note', sql`${t.type} <> 'internal_note' or ${t.visibility} = 'internal'`),
  ],
);

// Users explicitly related to a ticket (CC / watcher). Grants read access for own-scope roles.
export const ticketWatchers = pgTable(
  'ticket_watchers',
  {
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] }), index('idx_watchers_user').on(t.userId)],
);

export const ticketTags = pgTable(
  'ticket_tags',
  {
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.tagId] }), index('idx_ticket_tags_tag').on(t.tagId)],
);

// ---------------------------------------------------------------------------
// i18n, notifications, audit
// ---------------------------------------------------------------------------
// Admin overrides of the built-in dictionaries (src/server/i18n/locales/*.ts).
export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: serial('id').primaryKey(),
    locale: varchar('locale', { length: 16 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: text('value').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_glossary_locale_key').on(t.locale, t.key)],
);

export const notificationLogs = pgTable(
  'notification_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: varchar('event_id', { length: 128 }).notNull(),
    channel: varchar('channel', { length: 16 }).notNull(), // email|telegram|teams
    recipient: varchar('recipient', { length: 512 }).notNull(),
    subject: varchar('subject', { length: 512 }).notNull(),
    body: text('body').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'), // pending|sent|dead|skipped
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tstz('next_attempt_at').notNull().defaultNow(),
    lastError: text('last_error'),
    sentAt: tstz('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_notification_dedup').on(t.eventId, t.channel, t.recipient),
    index('idx_notification_pending').on(t.status, t.nextAttemptAt),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 64 }),
    detail: jsonb('detail'),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('idx_audit_created').on(t.createdAt), index('idx_audit_actor').on(t.actorId)],
);

export type User = typeof users.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
