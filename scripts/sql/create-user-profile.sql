-- User profile table for owner-scoped preferences used by AI look and profile UI.
-- Run manually against the database (no runtime auto-create in app code).

CREATE TABLE IF NOT EXISTS user_profile (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL UNIQUE,
  default_location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profile_owner_key
ON user_profile (owner_key);
