BEGIN;

-- 1) Ensure canonical target place exists.
INSERT INTO suitable_places (name)
VALUES ('Home / WFH')
ON CONFLICT (name) DO NOTHING;

-- 2) Move garment associations from legacy place labels to canonical target.
WITH target AS (
  SELECT id
  FROM suitable_places
  WHERE name = 'Home / WFH'
  LIMIT 1
),
legacy AS (
  SELECT id
  FROM suitable_places
  WHERE name IN ('Hospitality (Indoor)', 'Hospitality / Indoor')
)
INSERT INTO garment_suitable_place (garment_id, suitable_place_id)
SELECT DISTINCT gsp.garment_id, target.id
FROM garment_suitable_place gsp
JOIN legacy ON legacy.id = gsp.suitable_place_id
CROSS JOIN target
ON CONFLICT (garment_id, suitable_place_id) DO NOTHING;

-- 3) Remove legacy associations now that canonical mapping exists.
DELETE FROM garment_suitable_place
WHERE suitable_place_id IN (
  SELECT id
  FROM suitable_places
  WHERE name IN ('Hospitality (Indoor)', 'Hospitality / Indoor')
);

-- 4) Remove legacy vocabulary rows.
DELETE FROM suitable_places
WHERE name IN ('Hospitality (Indoor)', 'Hospitality / Indoor');

COMMIT;
