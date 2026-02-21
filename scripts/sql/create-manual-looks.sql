-- Persistent saved manual looks for /looks Selection mode.

BEGIN;

CREATE TABLE IF NOT EXISTS manual_look_saved (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  title TEXT NOT NULL,
  garment_ids_json JSONB NOT NULL,
  generated_image_url TEXT NOT NULL,
  location_label TEXT NOT NULL,
  weather_summary TEXT NOT NULL,
  weather_source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS manual_look_saved_owner_created_idx
ON manual_look_saved (owner_key, created_at DESC);

COMMIT;
