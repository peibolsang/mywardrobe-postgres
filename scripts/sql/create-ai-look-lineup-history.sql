BEGIN;

-- Single-look lineup history for recency/diversification reranking.
CREATE TABLE IF NOT EXISTS ai_look_lineup_history (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  panelist_key TEXT NOT NULL,
  lineup_signature TEXT NOT NULL,
  garment_ids_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_look_lineup_history_owner_mode_created_at_idx
ON ai_look_lineup_history (owner_key, mode, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_look_lineup_history_owner_mode_signature_idx
ON ai_look_lineup_history (owner_key, mode, lineup_signature);

COMMIT;
