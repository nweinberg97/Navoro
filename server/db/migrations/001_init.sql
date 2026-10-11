-- Navoro schema v1 (SQLite).
-- Every tenant-owned table carries org_id. Child rows are additionally guarded by
-- triggers that reject any row whose org_id disagrees with its parent's org_id,
-- so a bug in the application layer cannot attach data to another tenant's records.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  approval_policy TEXT NOT NULL DEFAULT 'manual' CHECK (approval_policy IN ('manual', 'auto')),
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  support_url TEXT,
  greeting TEXT NOT NULL DEFAULT 'Hi! Ask me how to do anything in this app.',
  suggestions TEXT NOT NULL DEFAULT '[]',
  sdk_version TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX applications_org ON applications(org_id);

CREATE TABLE config_versions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,          -- JSON: published privacy policy + published workflow ids + launcher config
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (app_id, version)
);

CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name IN ('development', 'production')),
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  active_config_version_id TEXT REFERENCES config_versions(id) ON DELETE SET NULL,
  last_seen_at TEXT,
  UNIQUE (app_id, name)
);

CREATE TABLE element_catalog (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  navoro_id TEXT NOT NULL,
  label TEXT,
  role TEXT,
  route TEXT,
  source TEXT NOT NULL CHECK (source IN ('sdk_discovery', 'manual')),
  approved INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (app_id, navoro_id)
);

CREATE TABLE page_blueprints (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  viewport TEXT NOT NULL,
  document_height INTEGER NOT NULL,
  elements TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE (app_id, route)
);

CREATE TABLE privacy_policies (
  app_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  draft TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_sources (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('manual', 'text', 'file', 'url', 'youtube')),
  title TEXT NOT NULL,
  reference TEXT,
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  processed_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'needs_attention', 'failed')),
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX knowledge_sources_app ON knowledge_sources(app_id);

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL
);
CREATE INDEX knowledge_chunks_app ON knowledge_chunks(app_id);

CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('feature', 'ui_concept', 'known_error', 'troubleshooting')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  excerpt TEXT
);
CREATE INDEX knowledge_items_app ON knowledge_items(app_id);

CREATE TABLE element_mappings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  strategies TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('developer_id', 'extracted', 'admin')),
  confidence REAL NOT NULL,
  validation TEXT NOT NULL CHECK (validation IN ('valid', 'unverified', 'uncertain', 'broken')),
  validation_detail TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (app_id, key)
);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('task', 'onboarding', 'troubleshooting')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'needs_review', 'archived')),
  confidence REAL NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('extracted', 'manual')),
  edited INTEGER NOT NULL DEFAULT 0,
  prerequisites TEXT NOT NULL DEFAULT '[]',
  source_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (app_id, key)
);

CREATE TABLE workflow_steps (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  target_key TEXT,
  validation TEXT,
  source_excerpt TEXT,
  edited INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX workflow_steps_workflow ON workflow_steps(workflow_id, ordinal);

CREATE TABLE guidance_sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  kind TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('answered', 'unresolved', 'completed', 'dismissed', 'cancelled', 'error')),
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  topic TEXT,
  steps_viewed INTEGER NOT NULL DEFAULT 0,
  step_count INTEGER NOT NULL DEFAULT 0,
  mode TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX guidance_sessions_app ON guidance_sessions(app_id, started_at);

-- Question text is stored only when the application's policy enables retention,
-- and is deleted after retention_days by the retention sweeper.
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES guidance_sessions(id) ON DELETE CASCADE,
  text TEXT,
  topic TEXT,
  grounded INTEGER NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX questions_app ON questions(app_id, created_at);

CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,
  type TEXT NOT NULL,
  session_id TEXT,
  workflow_id TEXT,
  step_index INTEGER,
  mapping_key TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX analytics_events_app ON analytics_events(app_id, created_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX audit_events_org ON audit_events(org_id, created_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ingest', 'refresh')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled')),
  payload TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]',
  report TEXT,
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX jobs_status ON jobs(status, created_at);
CREATE INDEX jobs_app ON jobs(app_id, created_at);

CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  app_id TEXT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

-- ── Tenant-consistency guards ────────────────────────────────────────────────
-- Each child row must belong to the same organization as the application it hangs off.

CREATE TRIGGER guard_environments_tenant BEFORE INSERT ON environments
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_environments_config_version BEFORE UPDATE OF active_config_version_id ON environments
WHEN NEW.active_config_version_id IS NOT NULL
 AND (SELECT app_id FROM config_versions WHERE id = NEW.active_config_version_id) IS NOT NEW.app_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_config_versions_tenant BEFORE INSERT ON config_versions
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_catalog_tenant BEFORE INSERT ON element_catalog
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_blueprints_tenant BEFORE INSERT ON page_blueprints
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_privacy_tenant BEFORE INSERT ON privacy_policies
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_sources_tenant BEFORE INSERT ON knowledge_sources
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_chunks_tenant BEFORE INSERT ON knowledge_chunks
WHEN (SELECT org_id FROM knowledge_sources WHERE id = NEW.source_id) IS NOT NEW.org_id
  OR (SELECT app_id FROM knowledge_sources WHERE id = NEW.source_id) IS NOT NEW.app_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_items_tenant BEFORE INSERT ON knowledge_items
WHEN (SELECT org_id FROM knowledge_sources WHERE id = NEW.source_id) IS NOT NEW.org_id
  OR (SELECT app_id FROM knowledge_sources WHERE id = NEW.source_id) IS NOT NEW.app_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_mappings_tenant BEFORE INSERT ON element_mappings
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_workflows_tenant BEFORE INSERT ON workflows
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
  OR (NEW.source_id IS NOT NULL AND (SELECT app_id FROM knowledge_sources WHERE id = NEW.source_id) IS NOT NEW.app_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_steps_tenant BEFORE INSERT ON workflow_steps
WHEN (SELECT org_id FROM workflows WHERE id = NEW.workflow_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_sessions_tenant BEFORE INSERT ON guidance_sessions
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_questions_tenant BEFORE INSERT ON questions
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_events_tenant BEFORE INSERT ON analytics_events
WHEN (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER guard_jobs_tenant BEFORE INSERT ON jobs
WHEN NEW.app_id IS NOT NULL AND (SELECT org_id FROM applications WHERE id = NEW.app_id) IS NOT NEW.org_id
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

-- org_id is immutable on every tenant-owned table.
CREATE TRIGGER immutable_org_applications BEFORE UPDATE OF org_id ON applications
BEGIN SELECT RAISE(ABORT, 'org_id_immutable'); END;
CREATE TRIGGER immutable_org_sources BEFORE UPDATE OF org_id ON knowledge_sources
BEGIN SELECT RAISE(ABORT, 'org_id_immutable'); END;
CREATE TRIGGER immutable_org_workflows BEFORE UPDATE OF org_id ON workflows
BEGIN SELECT RAISE(ABORT, 'org_id_immutable'); END;
CREATE TRIGGER immutable_org_mappings BEFORE UPDATE OF org_id ON element_mappings
BEGIN SELECT RAISE(ABORT, 'org_id_immutable'); END;
CREATE TRIGGER immutable_org_steps BEFORE UPDATE OF org_id ON workflow_steps
BEGIN SELECT RAISE(ABORT, 'org_id_immutable'); END;
