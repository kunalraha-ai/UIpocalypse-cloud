-- 002: domain ownership (one verified owner per domain), denylist, kill switches.

CREATE TABLE domain_verifications (
  domain TEXT PRIMARY KEY,             -- exactly one verified owner per domain
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('well-known', 'meta-tag', 'dns-txt')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE denied_domains (
  domain TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- admin kill switch per user (section 7)
ALTER TABLE users ADD COLUMN disabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN disabled_reason TEXT;
