-- Profile-backed menswear references for AI Look reference directives.
-- Run manually against the database (no runtime auto-create in app code).
--
-- IMPORTANT:
-- Replace owner key placeholder below before running seed/backfill:
--   owner:YOUR_OWNER_EMAIL_LOWERCASE
--
-- Example:
--   owner:pablo@example.com

BEGIN;

CREATE TABLE IF NOT EXISTS user_profile_reference (
  id BIGSERIAL PRIMARY KEY,
  owner_key TEXT NOT NULL,
  key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_name TEXT,
  reference_payload_json TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_key, key)
);

CREATE TABLE IF NOT EXISTS user_profile_reference_alias (
  id BIGSERIAL PRIMARY KEY,
  reference_id BIGINT NOT NULL REFERENCES user_profile_reference(id) ON DELETE CASCADE,
  alias_term TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reference_id, alias_term)
);

CREATE TABLE IF NOT EXISTS user_profile_reference_directive (
  reference_id BIGINT PRIMARY KEY REFERENCES user_profile_reference(id) ON DELETE CASCADE,
  style_bias_tags_json TEXT NOT NULL,
  silhouette_bias_tags_json TEXT NOT NULL,
  material_prefer_json TEXT NOT NULL,
  material_avoid_json TEXT NOT NULL,
  formality_bias TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profile_reference_owner_key
ON user_profile_reference (owner_key);

CREATE INDEX IF NOT EXISTS idx_user_profile_reference_owner_active
ON user_profile_reference (owner_key, is_active);

CREATE INDEX IF NOT EXISTS idx_user_profile_reference_alias_reference_id
ON user_profile_reference_alias (reference_id);

CREATE INDEX IF NOT EXISTS idx_user_profile_reference_alias_term_lower
ON user_profile_reference_alias (LOWER(alias_term));

WITH owner_seed AS (
  SELECT 'owner:peibolsang@gmail.com'::TEXT AS owner_key
)
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
  owner_seed.owner_key,
  refs.key,
  refs.display_name,
  refs.source_name,
  refs.reference_payload_json,
  refs.schema_version,
  TRUE
FROM owner_seed
CROSS JOIN (
  VALUES
    ('albert_muzquiz', 'Albert Muzquiz', 'Albert Muzquiz', NULL, 1),
    ('alessandro_squarzi', 'Alessandro Squarzi', 'Alessandro Squarzi', NULL, 1),
    ('derek_guy', 'Derek Guy', 'Derek Guy', NULL, 1),
    ('aaron_levine', 'Aaron Levine', 'Aaron Levine', NULL, 1),
    ('simon_crompton', 'Simon Crompton', 'Simon Crompton', NULL, 1)
) AS refs(key, display_name, source_name, reference_payload_json, schema_version)
ON CONFLICT (owner_key, key)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  source_name = EXCLUDED.source_name,
  reference_payload_json = EXCLUDED.reference_payload_json,
  schema_version = EXCLUDED.schema_version,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

WITH owner_seed AS (
  SELECT 'owner:peibolsang@gmail.com'::TEXT AS owner_key
)
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
  data.style_bias_tags_json,
  data.silhouette_bias_tags_json,
  data.material_prefer_json,
  data.material_avoid_json,
  data.formality_bias
FROM owner_seed
JOIN user_profile_reference upr
  ON upr.owner_key = owner_seed.owner_key
JOIN (
  VALUES
    (
      'albert_muzquiz',
      '["vintage","western","workwear","classic"]',
      '["high-waisted","boxy","straight-leg","cropped"]',
      '["heavy denim","vintage cotton","leather","gabardine"]',
      '["technical nylon","slim-fit stretch fabrics"]',
      'Elevated Casual'
    ),
    (
      'alessandro_squarzi',
      '["workwear","vintage","classic","western"]',
      '["relaxed","heritage","rugged-tailoring"]',
      '["selvedge denim","vintage military canvas","suede","corduroy"]',
      '["synthetic sportswear","stiff business formal"]',
      'Elevated Casual'
    ),
    (
      'derek_guy',
      '["classic","preppy","minimalist"]',
      '["full-cut","drape","high-rise","proportionate"]',
      '["tweed","flannel","oxford cloth","linen"]',
      '["skinny-fit","low-rise trousers","short jackets"]',
      'Business Casual'
    ),
    (
      'aaron_levine',
      '["minimalist","mod","vintage"]',
      '["oversized","fluid","relaxed","layered"]',
      '["brushed wool","heavy knits","washed silk","distressed leather"]',
      '["starched fabrics","rigid tailoring"]',
      'Elevated Casual'
    ),
    (
      'simon_crompton',
      '["classic","minimalist","preppy"]',
      '["tailored","clean","refined","natural-shoulder"]',
      '["cashmere","vicuña","high-twist wool","bespoke shirting"]',
      '["mass-market blends","heavy branding","distressed fabrics"]',
      'Business Formal'
    )
) AS data(
  key,
  style_bias_tags_json,
  silhouette_bias_tags_json,
  material_prefer_json,
  material_avoid_json,
  formality_bias
) ON data.key = upr.key
ON CONFLICT (reference_id)
DO UPDATE SET
  style_bias_tags_json = EXCLUDED.style_bias_tags_json,
  silhouette_bias_tags_json = EXCLUDED.silhouette_bias_tags_json,
  material_prefer_json = EXCLUDED.material_prefer_json,
  material_avoid_json = EXCLUDED.material_avoid_json,
  formality_bias = EXCLUDED.formality_bias,
  updated_at = NOW();

WITH owner_seed AS (
  SELECT 'owner:peibolsang@gmail.com'::TEXT AS owner_key
)
INSERT INTO user_profile_reference_alias (reference_id, alias_term)
SELECT
  upr.id,
  data.alias_term
FROM owner_seed
JOIN user_profile_reference upr
  ON upr.owner_key = owner_seed.owner_key
JOIN (
  VALUES
    ('albert_muzquiz', 'albert muzquiz'),
    ('albert_muzquiz', 'muzquiz'),
    ('albert_muzquiz', 'edgy albert'),
    ('alessandro_squarzi', 'alessandro squarzi'),
    ('alessandro_squarzi', 'squarzi'),
    ('alessandro_squarzi', 'as65'),
    ('derek_guy', 'derek guy'),
    ('derek_guy', 'dieworkwear'),
    ('derek_guy', 'menswear guy'),
    ('aaron_levine', 'aaron levine'),
    ('aaron_levine', 'levine'),
    ('simon_crompton', 'simon crompton'),
    ('simon_crompton', 'permanent style'),
    ('simon_crompton', 'crompton')
) AS data(key, alias_term) ON data.key = upr.key
ON CONFLICT (reference_id, alias_term)
DO NOTHING;

COMMIT;
