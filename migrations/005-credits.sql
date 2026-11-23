-- 005: credit ledger (append-only).

CREATE TABLE credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  run_id BIGINT REFERENCES runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('grant', 'purchase', 'run-charge', 'refund', 'expiry', 'adjustment')),
  amount NUMERIC(12,2) NOT NULL,           -- positive = credit added, negative = consumed
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, created_at);
