-- Persistent feedback memory for AI Look recommendations (single + travel).
-- Run once in Neon SQL Editor before using thumbs up/down feedback in the app.

CREATE TABLE IF NOT EXISTS ai_look_feedback (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  lineup_signature TEXT NOT NULL,
  garment_ids_json TEXT NOT NULL,
  vote TEXT NOT NULL,
  reason_text TEXT NULL,
  weather_profile_json TEXT NOT NULL,
  derived_profile_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_look_feedback_owner_created_idx
ON ai_look_feedback (owner_key, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_look_feedback_owner_mode_created_idx
ON ai_look_feedback (owner_key, mode, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_look_feedback_owner_signature_idx
ON ai_look_feedback (owner_key, lineup_signature);

CREATE INDEX IF NOT EXISTS ai_look_feedback_owner_request_idx
ON ai_look_feedback (owner_key, request_fingerprint);
