-- Persistent travel-day memory for AI Look travel mode.
-- Run once in Neon SQL Editor before testing travel anti-repeat across reruns.

CREATE TABLE IF NOT EXISTS ai_look_travel_day_history (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  reason TEXT NOT NULL,
  day_date DATE NOT NULL,
  day_index INTEGER NOT NULL,
  lineup_signature TEXT NOT NULL,
  garment_ids_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_look_travel_day_history_owner_req_date_created_idx
ON ai_look_travel_day_history (owner_key, request_fingerprint, day_date, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_look_travel_day_history_owner_req_signature_idx
ON ai_look_travel_day_history (owner_key, request_fingerprint, lineup_signature);

CREATE INDEX IF NOT EXISTS ai_look_travel_day_history_owner_created_idx
ON ai_look_travel_day_history (owner_key, created_at DESC);
