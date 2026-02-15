-- Ensure style tool key `ivy` is truly ivy-first in directive tags.
-- Run manually against the database.

BEGIN;

WITH ivy_style AS (
  SELECT id
  FROM style_catalog
  WHERE LOWER(key) = 'ivy'
  LIMIT 1
)
UPDATE style_catalog_directive scd
SET
  canonical_style_tags_json = '["ivy","preppy","classic"]',
  updated_at = NOW()
FROM ivy_style
WHERE scd.style_catalog_id = ivy_style.id;

COMMIT;

