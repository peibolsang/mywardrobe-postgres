BEGIN;

-- 1) Ensure target canonical styles exist.
INSERT INTO styles (name)
VALUES
  ('preppy'),
  ('classic')
ON CONFLICT (name) DO NOTHING;

-- 2) Remap requested source styles:
--    Casual -> Preppy
--    Smart Casual -> Classic
WITH mapping AS (
  SELECT * FROM (VALUES
    ('casual', 'preppy'),
    ('smart casual', 'classic')
  ) AS m(old_name, new_name)
),
resolved AS (
  SELECT
    old_s.id AS old_id,
    new_s.id AS new_id
  FROM mapping m
  JOIN styles old_s
    ON LOWER(TRIM(old_s.name)) = m.old_name
  JOIN styles new_s
    ON LOWER(TRIM(new_s.name)) = m.new_name
)
UPDATE garments g
SET style_id = r.new_id
FROM resolved r
WHERE g.style_id = r.old_id
  AND r.old_id <> r.new_id;

-- 3) Consolidate case variants for canonical styles.
WITH canonical AS (
  SELECT id, name
  FROM styles
  WHERE LOWER(TRIM(name)) IN ('sporty', 'minimalist', 'preppy', 'mod', 'workwear', 'outdoorsy', 'vintage', 'western', 'classic')
),
variants AS (
  SELECT
    s.id AS variant_id,
    c.id AS canonical_id
  FROM styles s
  JOIN canonical c
    ON LOWER(TRIM(s.name)) = LOWER(TRIM(c.name))
  WHERE s.id <> c.id
)
UPDATE garments g
SET style_id = v.canonical_id
FROM variants v
WHERE g.style_id = v.variant_id;

-- 4) Delete unreferenced styles removed from the controlled vocabulary.
DELETE FROM styles s
WHERE LOWER(TRIM(s.name)) IN ('casual', 'smart casual', 'business casual')
  AND NOT EXISTS (
    SELECT 1
    FROM garments g
    WHERE g.style_id = s.id
  );

-- 5) Safety check: fail if any garment still references removed style values.
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM garments g
  JOIN styles s ON s.id = g.style_id
  WHERE LOWER(TRIM(s.name)) IN ('casual', 'smart casual', 'business casual');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Style migration incomplete: % garment rows still reference removed style values.',
      invalid_count;
  END IF;
END $$;

COMMIT;
