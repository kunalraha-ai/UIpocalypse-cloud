-- 001: users, oauth identities, sessions, projects, runs.
-- P1 keeps findings/credits to later migrations; the no-op gate only needs
-- users through runs.

CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- P2 fields land in later migrations (disabled, denylisted…)
  CONSTRAINT users_email_uniq UNIQUE (email)
);

-- one row per (provider, provider account). One grant per GitHub identity is
-- enforced at signup time by code checking this table (P6), but the unique
-- index is the hard floor.
CREATE TABLE oauth_identities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_account_id TEXT NOT NULL,
  -- GitHub: unix seconds of account creation (for the minimum-age check)
  provider_account_created_at BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- random 32-byte hex
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessions_expires_future CHECK (expires_at > created_at)
);

CREATE TABLE projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  -- ownership verification state (P2 populates: unverified | verified)
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  verification_method TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects (user_id);

-- one row per scan run. P3 extends with pages_scanned, duration, coverage.
CREATE TABLE runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule', 'api', 'ci')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary_json JSONB,             -- P4 fills: pages, duration, severity counts
  error TEXT
);
CREATE INDEX runs_project_idx ON runs (project_id, id DESC);
