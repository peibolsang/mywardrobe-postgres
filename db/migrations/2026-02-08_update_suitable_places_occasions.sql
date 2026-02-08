-- Update taxonomy for suitable_places and suitable_occasions.
-- This migration:
-- 1) inserts new canonical values,
-- 2) remaps existing links by similarity (case-insensitive),
-- 3) removes non-canonical values after remap.

BEGIN;

-- -------------------------------------------------------------------
-- Canonical lookup values (new)
-- -------------------------------------------------------------------
WITH canonical_places(name) AS (
  VALUES
    ('Metropolitan / City'),
    ('Creative Studio / Atelier'),
    ('Hospitality (Indoor)'),
    ('Coastal / Beach'),
    ('Countryside / Estate'),
    ('Wilderness'),
    ('Workshop'),
    ('Transit Hub / Airport'),
    ('Office / Boardroom')
)
INSERT INTO suitable_places(name)
SELECT name FROM canonical_places
ON CONFLICT (name) DO NOTHING;

WITH canonical_occasions(name) AS (
  VALUES
    ('Black Tie / Evening Wear'),
    ('Business Formal'),
    ('Casual Social'),
    ('Date Night / Intimate Dinner'),
    ('Outdoor Social / Garden Party'),
    ('Active Rugged / Field Sports'),
    ('Spectator Sports'),
    ('Active Transit / Commuting'),
    ('Manual Labor / Craft'),
    ('Errands / Low-Key Social'),
    ('Ceremonial / Wedding')
)
INSERT INTO suitable_occasions(name)
SELECT name FROM canonical_occasions
ON CONFLICT (name) DO NOTHING;

-- -------------------------------------------------------------------
-- Places remap (similarity-based)
-- -------------------------------------------------------------------
WITH canonical_places(name) AS (
  VALUES
    ('Metropolitan / City'),
    ('Creative Studio / Atelier'),
    ('Hospitality (Indoor)'),
    ('Coastal / Beach'),
    ('Countryside / Estate'),
    ('Wilderness'),
    ('Workshop'),
    ('Transit Hub / Airport'),
    ('Office / Boardroom')
),
source AS (
  SELECT sp.id, sp.name, LOWER(BTRIM(sp.name)) AS n
  FROM suitable_places sp
),
mapped AS (
  SELECT
    s.id AS old_id,
    CASE
      WHEN s.name IN (SELECT name FROM canonical_places) THEN s.name
      WHEN s.n ~ '(studio|atelier|creative)' THEN 'Creative Studio / Atelier'
      WHEN s.n ~ '(bar|pub|restaurant|hospitality|indoor|dining|concert)' THEN 'Hospitality (Indoor)'
      WHEN s.n ~ '(coastal|beach)' THEN 'Coastal / Beach'
      WHEN s.n ~ '(country|countryside|estate|cabin|ranch|resort|golf)' THEN 'Countryside / Estate'
      WHEN s.n ~ '(wilderness|mountain|outdoor|forest|trail|hiking)' THEN 'Wilderness'
      WHEN s.n ~ '(workshop|shop floor)' THEN 'Workshop'
      WHEN s.n ~ '(transit|airport|station|terminal|commut|travel)' THEN 'Transit Hub / Airport'
      WHEN s.n ~ '(office|boardroom|work from home|home office|corporate)' THEN 'Office / Boardroom'
      WHEN s.n ~ '(city|metropolitan|urban|downtown|park|skate|gym|tennis)' THEN 'Metropolitan / City'
      ELSE 'Metropolitan / City'
    END AS target_name
  FROM source s
),
resolved AS (
  SELECT m.old_id, sp_new.id AS new_id
  FROM mapped m
  JOIN suitable_places sp_new ON sp_new.name = m.target_name
)
INSERT INTO garment_suitable_place (garment_id, suitable_place_id)
SELECT gsp.garment_id, r.new_id
FROM garment_suitable_place gsp
JOIN resolved r ON r.old_id = gsp.suitable_place_id
ON CONFLICT DO NOTHING;

WITH canonical_places(name) AS (
  VALUES
    ('Metropolitan / City'),
    ('Creative Studio / Atelier'),
    ('Hospitality (Indoor)'),
    ('Coastal / Beach'),
    ('Countryside / Estate'),
    ('Wilderness'),
    ('Workshop'),
    ('Transit Hub / Airport'),
    ('Office / Boardroom')
),
old_ids AS (
  SELECT sp.id
  FROM suitable_places sp
  WHERE sp.name NOT IN (SELECT name FROM canonical_places)
)
DELETE FROM garment_suitable_place gsp
USING old_ids
WHERE gsp.suitable_place_id = old_ids.id;

WITH canonical_places(name) AS (
  VALUES
    ('Metropolitan / City'),
    ('Creative Studio / Atelier'),
    ('Hospitality (Indoor)'),
    ('Coastal / Beach'),
    ('Countryside / Estate'),
    ('Wilderness'),
    ('Workshop'),
    ('Transit Hub / Airport'),
    ('Office / Boardroom')
)
DELETE FROM suitable_places
WHERE name NOT IN (SELECT name FROM canonical_places);

-- -------------------------------------------------------------------
-- Occasions remap (similarity-based)
-- -------------------------------------------------------------------
WITH canonical_occasions(name) AS (
  VALUES
    ('Black Tie / Evening Wear'),
    ('Business Formal'),
    ('Casual Social'),
    ('Date Night / Intimate Dinner'),
    ('Outdoor Social / Garden Party'),
    ('Active Rugged / Field Sports'),
    ('Spectator Sports'),
    ('Active Transit / Commuting'),
    ('Manual Labor / Craft'),
    ('Errands / Low-Key Social'),
    ('Ceremonial / Wedding')
),
source AS (
  SELECT so.id, so.name, LOWER(BTRIM(so.name)) AS n
  FROM suitable_occasions so
),
mapped AS (
  SELECT
    s.id AS old_id,
    CASE
      WHEN s.name IN (SELECT name FROM canonical_occasions) THEN s.name
      WHEN s.n ~ '(manual labor|labour|craft|workshop|blue collar|trade)' THEN 'Manual Labor / Craft'
      WHEN s.n ~ '(black tie|evening wear|gala|formal evening)' THEN 'Black Tie / Evening Wear'
      WHEN s.n ~ '(ceremon|wedding|reception|bridal)' THEN 'Ceremonial / Wedding'
      WHEN s.n ~ '(date|intimate|dinner|night out)' THEN 'Date Night / Intimate Dinner'
      WHEN s.n ~ '(spectator|stadium|fan|watching sports)' THEN 'Spectator Sports'
      WHEN s.n ~ '(transit|commut|travel|airport|station)' THEN 'Active Transit / Commuting'
      WHEN s.n ~ '(rugged|field sports|hiking|camping|golf|horseback|exercise|outdoor activity)' THEN 'Active Rugged / Field Sports'
      WHEN s.n ~ '(outdoor social|garden party|beach|vacation|country fair|picnic)' THEN 'Outdoor Social / Garden Party'
      WHEN s.n ~ '(business|office|corporate|professional|work)' THEN 'Business Formal'
      WHEN s.n ~ '(errand|daily life|low-key)' THEN 'Errands / Low-Key Social'
      WHEN s.n ~ '(casual|social|brunch|concert|city walk|gathering|weekend)' THEN 'Casual Social'
      ELSE 'Casual Social'
    END AS target_name
  FROM source s
),
resolved AS (
  SELECT m.old_id, so_new.id AS new_id
  FROM mapped m
  JOIN suitable_occasions so_new ON so_new.name = m.target_name
)
INSERT INTO garment_suitable_occasion (garment_id, suitable_occasion_id)
SELECT gso.garment_id, r.new_id
FROM garment_suitable_occasion gso
JOIN resolved r ON r.old_id = gso.suitable_occasion_id
ON CONFLICT DO NOTHING;

WITH canonical_occasions(name) AS (
  VALUES
    ('Black Tie / Evening Wear'),
    ('Business Formal'),
    ('Casual Social'),
    ('Date Night / Intimate Dinner'),
    ('Outdoor Social / Garden Party'),
    ('Active Rugged / Field Sports'),
    ('Spectator Sports'),
    ('Active Transit / Commuting'),
    ('Manual Labor / Craft'),
    ('Errands / Low-Key Social'),
    ('Ceremonial / Wedding')
),
old_ids AS (
  SELECT so.id
  FROM suitable_occasions so
  WHERE so.name NOT IN (SELECT name FROM canonical_occasions)
)
DELETE FROM garment_suitable_occasion gso
USING old_ids
WHERE gso.suitable_occasion_id = old_ids.id;

WITH canonical_occasions(name) AS (
  VALUES
    ('Black Tie / Evening Wear'),
    ('Business Formal'),
    ('Casual Social'),
    ('Date Night / Intimate Dinner'),
    ('Outdoor Social / Garden Party'),
    ('Active Rugged / Field Sports'),
    ('Spectator Sports'),
    ('Active Transit / Commuting'),
    ('Manual Labor / Craft'),
    ('Errands / Low-Key Social'),
    ('Ceremonial / Wedding')
)
DELETE FROM suitable_occasions
WHERE name NOT IN (SELECT name FROM canonical_occasions);

COMMIT;
