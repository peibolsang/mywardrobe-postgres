BEGIN;

-- 1) Ensure the new canonical formality values exist.
INSERT INTO formalities (name)
VALUES
  ('Formal'),
  ('Business Formal'),
  ('Business Casual'),
  ('Elevated Casual'),
  ('Casual'),
  ('Technical')
ON CONFLICT (name) DO NOTHING;

-- 2) Remap existing values to the requested canonical values:
--    Informal -> Casual
--    Business Casual -> Business Casual
--    Semi-formal -> Business Formal
--    Formal -> Formal
WITH mapping AS (
  SELECT * FROM (VALUES
    ('informal', 'Casual'),
    ('business casual', 'Business Casual'),
    ('semi-formal', 'Business Formal'),
    ('formal', 'Formal')
  ) AS m(old_name, new_name)
),
resolved AS (
  SELECT
    old_f.id AS old_id,
    new_f.id AS new_id
  FROM mapping m
  JOIN formalities old_f
    ON LOWER(TRIM(old_f.name)) = m.old_name
  JOIN formalities new_f
    ON new_f.name = m.new_name
)
UPDATE garments g
SET formality_id = r.new_id
FROM resolved r
WHERE g.formality_id = r.old_id
  AND r.old_id <> r.new_id;

-- 3) Consolidate case-variants/synonyms that equal a canonical label ignoring case.
WITH canonical AS (
  SELECT id, name
  FROM formalities
  WHERE name IN ('Formal', 'Business Formal', 'Business Casual', 'Elevated Casual', 'Casual', 'Technical')
),
variants AS (
  SELECT
    f.id AS variant_id,
    c.id AS canonical_id
  FROM formalities f
  JOIN canonical c
    ON LOWER(TRIM(f.name)) = LOWER(TRIM(c.name))
  WHERE f.id <> c.id
)
UPDATE garments g
SET formality_id = v.canonical_id
FROM variants v
WHERE g.formality_id = v.variant_id;

-- 4) Delete unreferenced non-canonical rows from formalities.
DELETE FROM formalities f
WHERE f.name NOT IN ('Formal', 'Business Formal', 'Business Casual', 'Elevated Casual', 'Casual', 'Technical')
  AND NOT EXISTS (
    SELECT 1
    FROM garments g
    WHERE g.formality_id = f.id
  );

-- 5) Safety check: fail if any garment still points to a non-canonical formality.
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM garments g
  JOIN formalities f ON f.id = g.formality_id
  WHERE f.name NOT IN ('Formal', 'Business Formal', 'Business Casual', 'Elevated Casual', 'Casual', 'Technical');

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Formality migration incomplete: % garment rows still reference non-canonical formality values.',
      invalid_count;
  END IF;
END $$;

COMMIT;
