-- Add owner-scoped full-body photo URL used by Looks "Try it" identity-conditioned generation.
-- Run manually against the database (no runtime auto-create in app code).

ALTER TABLE user_profile
ADD COLUMN IF NOT EXISTS body_photo_url TEXT;
