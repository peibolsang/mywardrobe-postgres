-- Import script generated from vibe/bias.json
-- Purpose: upsert owner-scoped menswear reference data (core + directives + aliases)
-- Safe to re-run (idempotent for the same key set).

BEGIN;

CREATE TEMP TABLE tmp_bias_reference_import (
  owner_key TEXT NOT NULL,
  key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_name TEXT,
  schema_version INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL,
  alias_terms_json TEXT NOT NULL,
  style_bias_tags_json TEXT NOT NULL,
  silhouette_bias_tags_json TEXT NOT NULL,
  material_prefer_json TEXT NOT NULL,
  material_avoid_json TEXT NOT NULL,
  formality_bias TEXT
) ON COMMIT DROP;

INSERT INTO tmp_bias_reference_import (
  owner_key,
  key,
  display_name,
  source_name,
  schema_version,
  is_active,
  alias_terms_json,
  style_bias_tags_json,
  silhouette_bias_tags_json,
  material_prefer_json,
  material_avoid_json,
  formality_bias
)
VALUES
  (
    'owner:peibolsang@gmail.com',
    'aaron_levine',
    'Aaron Levine',
    'Aaron Levine',
    1,
    TRUE,
    '["Aaron", "Aaron Levine", "Levine", "aaron_levine"]',
    '["classic","preppy","vintage","workwear"]',
    '["relaxed","slouchy","draped"]',
    '["cotton","wool","denim","cashmere"]',
    '["polyester","nylon"]',
    'Elevated Casual'
  ),
  (
    'owner:peibolsang@gmail.com',
    'albert_muzquiz',
    'Albert Muzquiz',
    'Albert Muzquiz',
    1,
    TRUE,
    '["Albert M.", "Albert Muzquiz", "Muzquiz", "albert_muzquiz"]',
    '["vintage","workwear","western"]',
    '["straight","classic fit"]',
    '["denim","cotton","leather","canvas"]',
    '["polyester","nylon","lyocell"]',
    'Casual'
  ),
  (
    'owner:peibolsang@gmail.com',
    'alessandro_squarzi',
    'Alessandro Squarzi',
    'Alessandro Squarzi',
    1,
    TRUE,
    '["Alessandro S.", "Alessandro Squarzi", "Squarzi", "alessandro_squarzi"]',
    '["classic","vintage","workwear"]',
    '["tailored","relaxed"]',
    '["cotton","wool","linen","denim","leather"]',
    '["polyester","nylon"]',
    'Elevated Casual'
  ),
  (
    'owner:peibolsang@gmail.com',
    'derek_guy',
    'Derek Guy',
    'Derek Guy',
    1,
    TRUE,
    '["Derek", "Derek Guy", "derek guy menswear", "derek_guy", "styleforum derek"]',
    '["classic"]',
    '["tailored","draped","full cut"]',
    '["wool","linen","cotton","silk"]',
    '["polyester","nylon","acrylic"]',
    'Business Casual'
  ),
  (
    'owner:peibolsang@gmail.com',
    'simon_crompton',
    'Simon Crompton',
    'Simon Crompton',
    1,
    TRUE,
    '["Crompton", "Permanent Style", "Simon Crompton", "simon_crompton"]',
    '["classic","minimalist"]',
    '["tailored","bespoke"]',
    '["wool","cashmere","linen","cotton","silk"]',
    '["polyester","nylon","acrylic"]',
    'Business Casual'
  );

-- Upsert core references.
INSERT INTO user_profile_reference (
  owner_key,
  key,
  display_name,
  source_name,
  reference_payload_json,
  schema_version,
  is_active
)
SELECT
  t.owner_key,
  t.key,
  t.display_name,
  t.source_name,
  NULL,
  t.schema_version,
  t.is_active
FROM tmp_bias_reference_import t
ON CONFLICT (owner_key, key)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  source_name = EXCLUDED.source_name,
  schema_version = EXCLUDED.schema_version,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Upsert directive payload.
INSERT INTO user_profile_reference_directive (
  reference_id,
  style_bias_tags_json,
  silhouette_bias_tags_json,
  material_prefer_json,
  material_avoid_json,
  formality_bias
)
SELECT
  upr.id,
  t.style_bias_tags_json,
  t.silhouette_bias_tags_json,
  t.material_prefer_json,
  t.material_avoid_json,
  t.formality_bias
FROM tmp_bias_reference_import t
JOIN user_profile_reference upr
  ON upr.owner_key = t.owner_key
 AND upr.key = t.key
ON CONFLICT (reference_id)
DO UPDATE SET
  style_bias_tags_json = EXCLUDED.style_bias_tags_json,
  silhouette_bias_tags_json = EXCLUDED.silhouette_bias_tags_json,
  material_prefer_json = EXCLUDED.material_prefer_json,
  material_avoid_json = EXCLUDED.material_avoid_json,
  formality_bias = EXCLUDED.formality_bias,
  updated_at = NOW();

-- Refresh aliases exactly from import payload.
DELETE FROM user_profile_reference_alias upra
USING user_profile_reference upr, tmp_bias_reference_import t
WHERE upra.reference_id = upr.id
  AND upr.owner_key = t.owner_key
  AND upr.key = t.key;

INSERT INTO user_profile_reference_alias (reference_id, alias_term)
SELECT
  upr.id,
  alias_item.alias_term
FROM tmp_bias_reference_import t
JOIN user_profile_reference upr
  ON upr.owner_key = t.owner_key
 AND upr.key = t.key
CROSS JOIN LATERAL jsonb_array_elements_text(t.alias_terms_json::jsonb) AS alias_item(alias_term)
ON CONFLICT (reference_id, alias_term)
DO NOTHING;

COMMIT;
