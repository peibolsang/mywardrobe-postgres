BEGIN;

-- Ensure the corrected canonical value exists.
INSERT INTO formalities (name)
VALUES ('Elevated Casual')
ON CONFLICT (name) DO NOTHING;

-- Remap garments from typo value -> corrected value.
WITH ids AS (
  SELECT
    MAX(CASE WHEN LOWER(TRIM(name)) = 'elevated causal' THEN id END) AS typo_id,
    MAX(CASE WHEN name = 'Elevated Casual' THEN id END) AS corrected_id
  FROM formalities
)
UPDATE garments g
SET formality_id = ids.corrected_id
FROM ids
WHERE ids.typo_id IS NOT NULL
  AND ids.corrected_id IS NOT NULL
  AND g.formality_id = ids.typo_id;

-- Remove typo row if no garments reference it anymore.
DELETE FROM formalities f
WHERE LOWER(TRIM(f.name)) = 'elevated causal'
  AND NOT EXISTS (
    SELECT 1
    FROM garments g
    WHERE g.formality_id = f.id
  );

-- Safety check.
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM garments g
  JOIN formalities f ON f.id = g.formality_id
  WHERE LOWER(TRIM(f.name)) = 'elevated causal';

  IF remaining_count > 0 THEN
    RAISE EXCEPTION
      'Typo fix incomplete: % garments still reference ''Elevated Causal''.',
      remaining_count;
  END IF;
END $$;

COMMIT;
