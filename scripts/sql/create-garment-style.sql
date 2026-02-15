-- Multi-style support for garments.
-- Adds a many-to-many style junction while keeping garments.style_id as legacy primary style.
-- Run manually against the database (no runtime auto-create in app code).

BEGIN;

CREATE TABLE IF NOT EXISTS garment_style (
  garment_id INTEGER NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
  style_id INTEGER NOT NULL REFERENCES styles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (garment_id, style_id)
);

CREATE INDEX IF NOT EXISTS idx_garment_style_style_id
ON garment_style (style_id);

CREATE INDEX IF NOT EXISTS idx_garment_style_garment_id
ON garment_style (garment_id);

COMMIT;
