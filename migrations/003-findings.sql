-- 003: findings table for the scan engine results.

CREATE TABLE findings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  url TEXT NOT NULL,
  message TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}',
  fix_hint TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX findings_run_idx ON findings (run_id);
CREATE INDEX findings_fp_idx ON findings (run_id, fingerprint);
