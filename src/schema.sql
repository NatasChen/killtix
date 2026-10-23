-- ============================================================================
--  TicketDesk — PostgreSQL 16 Schema (v1.0.0)
--  File: src/schema.sql
--  Purpose: Full DDL + idempotent seed data for Docker (PostgreSQL 16) track.
--  Notes:
--    * Mounted into /docker-entrypoint-initdb.d for first-boot initialization.
--    * Seed data is IDEMPOTENT (INSERT ... ON CONFLICT DO NOTHING) so container
--      restarts / re-runs never overwrite a changed password or duplicate rows.
--    * Bootstrap admin password is stored ONLY as a bcrypt hash (cost >= 10).
--      Plaintext password NEVER appears in this file.
--  D1/SQLite dialect differences are handled in src/migrations/*.d1.sql.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id            SERIAL PRIMARY KEY,
    key           VARCHAR(64)  NOT NULL UNIQUE,
    name          VARCHAR(128) NOT NULL,
    description   TEXT,
    permissions   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_system     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL UNIQUE,
    description   TEXT,
    manager_id    INTEGER,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                    SERIAL PRIMARY KEY,
    email                 CITEXT       NOT NULL UNIQUE,
    display_name          VARCHAR(128) NOT NULL,
    password_hash         VARCHAR(255),                       -- bcrypt; NULL for SSO-only users
    role                  VARCHAR(64)  NOT NULL DEFAULT 'end_user',  -- denormalized role key
    role_id               INTEGER      REFERENCES roles(id) ON DELETE SET NULL,
    team_id               INTEGER      REFERENCES teams(id) ON DELETE SET NULL,
    identity_provider     VARCHAR(32)  NOT NULL DEFAULT 'local',    -- local|ad|ldap|saml|oidc|scim
    external_subject      VARCHAR(255),                       -- IdP subject / DN / objectGUID
    must_change_password  BOOLEAN      NOT NULL DEFAULT FALSE,
    two_factor_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
    two_factor_secret     VARCHAR(255),                       -- TOTP secret (encrypted at rest)
    recovery_codes_hash   JSONB,                              -- array of bcrypt hashes
    is_bootstrap_admin    BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    failed_login_count    INTEGER      NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    password_updated_at   TIMESTAMPTZ,
    password_history      JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- last 5 password hashes
    last_login_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role        ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_team        ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_users_active      ON users(is_active);

-- ---------------------------------------------------------------------------
-- business_hours
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_hours (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(128) NOT NULL,
    timezone         VARCHAR(64)  NOT NULL DEFAULT 'Asia/Taipei',
    weekly_schedule  JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- {mon:{start,end}, ...}
    holidays         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_24x7          BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sla_plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sla_plans (
    id                     SERIAL PRIMARY KEY,
    name                   VARCHAR(128) NOT NULL,
    first_response_minutes INTEGER      NOT NULL DEFAULT 240,
    resolution_minutes     INTEGER      NOT NULL DEFAULT 1440,
    business_hours_id      INTEGER      REFERENCES business_hours(id) ON DELETE SET NULL,
    escalation_role_id     INTEGER      REFERENCES roles(id) ON DELETE SET NULL,
    is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- help_topics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_topics (
    id            SERIAL PRIMARY KEY,
    slug          VARCHAR(128) NOT NULL UNIQUE,
    name          VARCHAR(128) NOT NULL,
    description   TEXT,
    parent_id     INTEGER      REFERENCES help_topics(id) ON DELETE SET NULL,
    form_id       INTEGER,                                    -- FK added after ticket_forms
    sla_plan_id   INTEGER      REFERENCES sla_plans(id) ON DELETE SET NULL,
    default_team_id INTEGER     REFERENCES teams(id) ON DELETE SET NULL,
    auto_tags     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_public     BOOLEAN      NOT NULL DEFAULT TRUE,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ticket_forms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_forms (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    description   TEXT,
    help_topic_id INTEGER      REFERENCES help_topics(id) ON DELETE SET NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE help_topics
    DROP CONSTRAINT IF EXISTS fk_help_topics_form;
ALTER TABLE help_topics
    ADD CONSTRAINT fk_help_topics_form
    FOREIGN KEY (form_id) REFERENCES ticket_forms(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- custom_fields
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_fields (
    id             SERIAL PRIMARY KEY,
    form_id        INTEGER      NOT NULL REFERENCES ticket_forms(id) ON DELETE CASCADE,
    key            VARCHAR(128) NOT NULL,
    label          VARCHAR(255) NOT NULL,
    type           VARCHAR(32)  NOT NULL,   -- text|textarea|select|multiselect|radio|checkbox|date|datetime|number|email|url|file
    is_required    BOOLEAN      NOT NULL DEFAULT FALSE,
    default_value  TEXT,
    sort_order     INTEGER      NOT NULL DEFAULT 0,
    visibility     VARCHAR(16)  NOT NULL DEFAULT 'public',  -- public|internal|agent_only
    is_filterable  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_exportable  BOOLEAN      NOT NULL DEFAULT TRUE,
    validation     JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- {regex,min,max,minLength,maxLength,options}
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,          -- soft delete
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_custom_fields_form_key UNIQUE (form_id, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_form ON custom_fields(form_id);

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id                    SERIAL PRIMARY KEY,
    number                VARCHAR(32)  NOT NULL UNIQUE,        -- e.g. TCK-2026-000123
    subject               VARCHAR(512) NOT NULL,
    description           TEXT,
    status                VARCHAR(32)  NOT NULL DEFAULT 'new', -- new|open|pending_user|resolved|closed
    priority              SMALLINT     NOT NULL DEFAULT 3,     -- 1..5
    help_topic_id         INTEGER      REFERENCES help_topics(id) ON DELETE SET NULL,
    form_id               INTEGER      REFERENCES ticket_forms(id) ON DELETE SET NULL,
    sla_plan_id           INTEGER      REFERENCES sla_plans(id) ON DELETE SET NULL,
    requester_id          INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    assignee_id           INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    team_id               INTEGER      REFERENCES teams(id) ON DELETE SET NULL,
    external_id           VARCHAR(255),                        -- idempotency key from external systems (SOC)
    first_response_due_at TIMESTAMPTZ,
    resolution_due_at     TIMESTAMPTZ,
    first_responded_at    TIMESTAMPTZ,
    resolved_at           TIMESTAMPTZ,
    closed_at             TIMESTAMPTZ,
    sla_status            VARCHAR(16)  NOT NULL DEFAULT 'on_track', -- on_track|at_risk|overdue|met|breached
    reopen_count          INTEGER      NOT NULL DEFAULT 0,
    custom_fields_snapshot JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_tickets_priority CHECK (priority BETWEEN 1 AND 5),
    CONSTRAINT chk_tickets_status CHECK (status IN ('new','open','pending_user','resolved','closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_external_id ON tickets(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_status ON tickets(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_team_status     ON tickets(team_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_requester       ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at      ON tickets(created_at);

-- ---------------------------------------------------------------------------
-- ticket_field_values
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_field_values (
    id           BIGSERIAL PRIMARY KEY,
    ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    field_id     INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value_text   TEXT,
    value_json   JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_ticket_field UNIQUE (ticket_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_tfv_field_value ON ticket_field_values(field_id, value_text);
CREATE INDEX IF NOT EXISTS idx_tfv_ticket      ON ticket_field_values(ticket_id);

-- ---------------------------------------------------------------------------
-- ticket_threads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_threads (
    id             BIGSERIAL PRIMARY KEY,
    ticket_id      INTEGER      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    type           VARCHAR(32)  NOT NULL,   -- customer_message|agent_reply|internal_note|system_event
    visibility     VARCHAR(16)  NOT NULL DEFAULT 'public',  -- public|internal
    body           TEXT         NOT NULL,
    source_channel VARCHAR(32)  NOT NULL DEFAULT 'web',     -- web|email|api
    is_read        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_thread_type CHECK (type IN ('customer_message','agent_reply','internal_note','system_event')),
    CONSTRAINT chk_thread_visibility CHECK (visibility IN ('public','internal'))
);

CREATE INDEX IF NOT EXISTS idx_threads_ticket ON ticket_threads(ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- ticket_attachments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_attachments (
    id           BIGSERIAL PRIMARY KEY,
    thread_id    BIGINT       NOT NULL REFERENCES ticket_threads(id) ON DELETE CASCADE,
    filename     VARCHAR(255) NOT NULL,
    mime_type    VARCHAR(128) NOT NULL,
    size_bytes   BIGINT       NOT NULL DEFAULT 0,
    storage_key  VARCHAR(512) NOT NULL,
    scan_status  VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending|clean|infected|failed
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_thread ON ticket_attachments(thread_id);

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(64)  NOT NULL UNIQUE,
    color       VARCHAR(16)  NOT NULL DEFAULT '#6B7280',
    category    VARCHAR(64),
    api_creatable BOOLEAN    NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ticket_tags  (many-to-many)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (ticket_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_tags_tag ON ticket_tags(tag_id);

-- ---------------------------------------------------------------------------
-- canned_responses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canned_responses (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    team_id       INTEGER      REFERENCES teams(id) ON DELETE SET NULL,
    body          TEXT         NOT NULL,
    variables     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    help_topic_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    version       INTEGER      NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- glossary_terms  (i18n dictionary)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS glossary_terms (
    id          BIGSERIAL PRIMARY KEY,
    locale      VARCHAR(16)  NOT NULL,          -- zh-TW|en-US|ja-JP ...
    namespace   VARCHAR(64)  NOT NULL DEFAULT 'common',
    key         VARCHAR(255) NOT NULL,
    value       TEXT         NOT NULL,
    version     INTEGER      NOT NULL DEFAULT 1,
    updated_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_glossary UNIQUE (locale, namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_glossary_lookup ON glossary_terms(locale, namespace);

-- ---------------------------------------------------------------------------
-- notification_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_logs (
    id           BIGSERIAL PRIMARY KEY,
    event_id     VARCHAR(128) NOT NULL,          -- idempotency: event_id+channel+recipient
    channel      VARCHAR(32)  NOT NULL,          -- email|telegram|teams
    recipient    VARCHAR(255) NOT NULL,
    subject      VARCHAR(512),
    status       VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending|sent|failed|dead
    attempts     INTEGER      NOT NULL DEFAULT 0,
    last_error   TEXT,
    payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
    sent_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_dedup UNIQUE (event_id, channel, recipient)
);

CREATE INDEX IF NOT EXISTS idx_notif_status_created ON notification_logs(status, created_at);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    action       VARCHAR(128) NOT NULL,
    target_type  VARCHAR(64),
    target_id    VARCHAR(128),
    diff         JSONB,
    ip           VARCHAR(64),
    user_agent   TEXT,
    trace_id     VARCHAR(64),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_logs(actor_id);

-- ---------------------------------------------------------------------------
-- api_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    scopes       JSONB        NOT NULL DEFAULT '[]'::jsonb,
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ===========================================================================
-- SEED DATA (IDEMPOTENT)
-- ===========================================================================

-- Roles ---------------------------------------------------------------------
INSERT INTO roles (key, name, description, permissions, is_system) VALUES
  ('super_admin', '系統管理員', '全功能系統管理', '["*"]'::jsonb, TRUE),
  ('it_manager',  'IT 服務主管', '報表全覽、SLA 監控、指派與升級', '["ticket:read","ticket:assign","ticket:update","report:read","report:export","sla:manage"]'::jsonb, TRUE),
  ('agent',       '內部工程師', '回覆、內部備忘、狀態流轉', '["ticket:read","ticket:reply","ticket:update","canned:use"]'::jsonb, TRUE),
  ('vendor',      '外部廠商', '僅被指派或關聯之工單', '["ticket:read:own","ticket:reply:own"]'::jsonb, TRUE),
  ('end_user',    '一般使用者', '開單、回覆、檢視自身工單', '["ticket:create","ticket:read:own","ticket:reply:own"]'::jsonb, TRUE),
  ('api_client',  '外部系統', '依 API Token Scope 建立/查詢工單', '["ticket:create","ticket:read:own"]'::jsonb, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Business hours ------------------------------------------------------------
INSERT INTO business_hours (name, timezone, weekly_schedule, is_24x7)
SELECT '預設 24x7', 'Asia/Taipei', '{}'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM business_hours WHERE name = '預設 24x7');

-- SLA plans -----------------------------------------------------------------
INSERT INTO sla_plans (name, first_response_minutes, resolution_minutes, business_hours_id)
SELECT '預設 SLA (24x7)', 60, 1440, (SELECT id FROM business_hours WHERE name = '預設 24x7' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM sla_plans WHERE name = '預設 SLA (24x7)');

-- Help topics ---------------------------------------------------------------
INSERT INTO help_topics (slug, name, description, sla_plan_id, is_public, is_active)
SELECT 'security-incident', '資安事件通報', 'SOC / 資安事件開單入口',
       (SELECT id FROM sla_plans WHERE name = '預設 SLA (24x7)' LIMIT 1), TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM help_topics WHERE slug = 'security-incident');

INSERT INTO help_topics (slug, name, description, sla_plan_id, is_public, is_active)
SELECT 'account-access', '帳號權限申請', '帳號、權限、存取申請',
       (SELECT id FROM sla_plans WHERE name = '預設 SLA (24x7)' LIMIT 1), TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM help_topics WHERE slug = 'account-access');

-- Glossary terms (zh-TW / en-US) -------------------------------------------
INSERT INTO glossary_terms (locale, namespace, key, value) VALUES
  ('zh-TW', 'ticket', 'ticket.status.new',          '新建立'),
  ('zh-TW', 'ticket', 'ticket.status.open',         '待處理'),
  ('zh-TW', 'ticket', 'ticket.status.pending_user', '等待使用者回覆'),
  ('zh-TW', 'ticket', 'ticket.status.resolved',     '已解決'),
  ('zh-TW', 'ticket', 'ticket.status.closed',       '已結案'),
  ('zh-TW', 'ticket', 'ticket.priority.1',          '極低'),
  ('zh-TW', 'ticket', 'ticket.priority.2',          '低'),
  ('zh-TW', 'ticket', 'ticket.priority.3',          '中'),
  ('zh-TW', 'ticket', 'ticket.priority.4',          '高'),
  ('zh-TW', 'ticket', 'ticket.priority.5',          '緊急'),
  ('en-US', 'ticket', 'ticket.status.new',          'New'),
  ('en-US', 'ticket', 'ticket.status.open',         'Open'),
  ('en-US', 'ticket', 'ticket.status.pending_user', 'Pending User'),
  ('en-US', 'ticket', 'ticket.status.resolved',     'Resolved'),
  ('en-US', 'ticket', 'ticket.status.closed',       'Closed'),
  ('en-US', 'ticket', 'ticket.priority.1',          'Lowest'),
  ('en-US', 'ticket', 'ticket.priority.2',          'Low'),
  ('en-US', 'ticket', 'ticket.priority.3',          'Normal'),
  ('en-US', 'ticket', 'ticket.priority.4',          'High'),
  ('en-US', 'ticket', 'ticket.priority.5',          'Critical')
ON CONFLICT (locale, namespace, key) DO NOTHING;

-- ===========================================================================
-- BOOTSTRAP ADMIN SEED  (P0 — MUST NOT be overwritten on re-run)
--   Email:                 admin@ticket.local
--   Password (plaintext):  Admin@InitTemp2026!   <-- NEVER stored here
--   Password hash:         bcrypt cost 10 (see below)
--   role:                  super_admin
--   must_change_password:  TRUE
--   two_factor_enabled:    FALSE
--   is_bootstrap_admin:    TRUE
--   password_updated_at:   NULL
-- ===========================================================================
INSERT INTO users (
    email, display_name, password_hash, role, role_id,
    identity_provider, must_change_password, two_factor_enabled,
    is_bootstrap_admin, is_active, password_updated_at
)
SELECT
    'admin@ticket.local',
    'Bootstrap Administrator',
    '$2a$10$wT0E0Zz.6aV99l0Y19zC1O/R4L2o99bU3Jg749Yk9JqHn89oM3WkK',
    'super_admin',
    (SELECT id FROM roles WHERE key = 'super_admin' LIMIT 1),
    'local',
    TRUE,
    FALSE,
    TRUE,
    TRUE,
    NULL
WHERE NOT EXISTS (
    SELECT 1 FROM users WHERE email = 'admin@ticket.local'
);

COMMIT;

-- ===========================================================================
-- Verification query (run manually after init):
--   SELECT email, role, must_change_password, is_bootstrap_admin,
--          two_factor_enabled, password_updated_at,
--          substr(password_hash,1,7) AS hash_prefix
--   FROM users WHERE email = 'admin@ticket.local';
-- Expected: 1 row, role=super_admin, must_change_password=t,
--           is_bootstrap_admin=t, two_factor_enabled=f, hash_prefix=$2a$10$
-- ===========================================================================
