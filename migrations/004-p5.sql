-- 004: api_keys, schedules, notification_settings.

CREATE TABLE api_keys (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = account-wide
  key_hash TEXT NOT NULL UNIQUE,         -- SHA-256 of the raw key; raw never stored
  label TEXT NOT NULL DEFAULT 'api key',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE schedules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('hourly', 'daily', 'weekly')),
  user_timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,                      -- 'completed' | 'failed' | 'missed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_settings (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  slack_enabled BOOLEAN NOT NULL DEFAULT false,
  slack_webhook_url TEXT,
  on_new_findings BOOLEAN NOT NULL DEFAULT true,
  on_recovery BOOLEAN NOT NULL DEFAULT true
);
