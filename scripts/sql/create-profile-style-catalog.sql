-- Profile-backed style catalog for AI Look style directives.
-- Run manually against the database (no runtime auto-create in app code).

BEGIN;

CREATE TABLE IF NOT EXISTS style_catalog (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  canonical_style TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS style_catalog_alias (
  id BIGSERIAL PRIMARY KEY,
  style_catalog_id BIGINT NOT NULL REFERENCES style_catalog(id) ON DELETE CASCADE,
  alias_term TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (style_catalog_id, alias_term)
);

CREATE TABLE IF NOT EXISTS style_catalog_directive (
  style_catalog_id BIGINT PRIMARY KEY REFERENCES style_catalog(id) ON DELETE CASCADE,
  canonical_style_tags_json TEXT NOT NULL,
  silhouette_bias_tags_json TEXT NOT NULL,
  material_prefer_json TEXT NOT NULL,
  material_avoid_json TEXT NOT NULL,
  formality_bias TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profile_style (
  owner_key TEXT NOT NULL,
  style_catalog_id BIGINT NOT NULL REFERENCES style_catalog(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_key, style_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_style_catalog_is_active
ON style_catalog (is_active);

CREATE INDEX IF NOT EXISTS idx_style_catalog_alias_style_id
ON style_catalog_alias (style_catalog_id);

CREATE INDEX IF NOT EXISTS idx_style_catalog_alias_term_lower
ON style_catalog_alias (LOWER(alias_term));

CREATE INDEX IF NOT EXISTS idx_user_profile_style_owner_key
ON user_profile_style (owner_key);

INSERT INTO style_catalog (key, name, canonical_style, description, is_active)
VALUES
  ('vintage_americana', 'Vintage Americana', 'vintage', 'Heritage Americana inspired combinations with classic and workwear influence.', TRUE),
  ('amekaji', 'Amekaji', 'vintage', 'Japanese Americana with rugged casual textures and layering.', TRUE),
  ('workwear', 'Workwear', 'workwear', 'Utility-first workwear language with durable heritage materials.', TRUE),
  ('military_heritage', 'Military Heritage', 'workwear', 'Military-inspired heritage silhouettes and rugged classics.', TRUE),
  ('ivy', 'Ivy / Trad', 'classic', 'Collegiate and traditional menswear proportions with clean structure.', TRUE),
  ('soft_tailoring', 'Soft Tailoring', 'classic', 'Unstructured tailoring with artisanal and refined fabric direction.', TRUE),
  ('elevated_slouch', 'Elevated Slouch', 'minimalist', 'Relaxed, high-low styling with textural modern balance.', TRUE)
ON CONFLICT (key)
DO UPDATE SET
  name = EXCLUDED.name,
  canonical_style = EXCLUDED.canonical_style,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO style_catalog_directive (
  style_catalog_id,
  canonical_style_tags_json,
  silhouette_bias_tags_json,
  material_prefer_json,
  material_avoid_json,
  formality_bias
)
SELECT
  sc.id,
  v.canonical_style_tags_json,
  v.silhouette_bias_tags_json,
  v.material_prefer_json,
  v.material_avoid_json,
  v.formality_bias
FROM style_catalog sc
JOIN (
  VALUES
    (
      'vintage_americana',
      '["vintage","classic","western","workwear"]',
      '["high-rise","boxy","straight"]',
      '["selvedge denim","aged leather","loopwheel cotton","wool"]',
      '["polyester","modern technical fabrics"]',
      'Elevated Casual'
    ),
    (
      'amekaji',
      '["vintage","workwear","western","classic"]',
      '["heritage","rugged"]',
      '["denim","canvas","twill","leather","flannel"]',
      '[]',
      'Elevated Casual'
    ),
    (
      'workwear',
      '["workwear","vintage","outdoorsy","classic"]',
      '["boxy","straight leg","oversized"]',
      '["duck canvas","heavy denim","moleskin","corduroy"]',
      '["silk","fine gauge knits","delicate blends"]',
      'Casual'
    ),
    (
      'military_heritage',
      '["workwear","vintage","classic","outdoorsy"]',
      '["structured","relaxed","straight","heritage"]',
      '["canvas","cotton twill","herringbone twill","denim","suede"]',
      '["shiny synthetics","high-shine finishes"]',
      'Elevated Casual'
    ),
    (
      'ivy',
      '["academic","classic","preppy","conservative"]',
      '["natural shoulder","tapered","tailored"]',
      '["oxford cloth","shetland wool","cotton twill","seersucker"]',
      '["technical fabrics","synthetic blends"]',
      'Business Casual'
    ),
    (
      'soft_tailoring',
      '["elegant","romantic","artisan","mediterranean"]',
      '["unstructured","draped","high-waisted"]',
      '["high-twist wool","linen","cashmere","silk blends"]',
      '["heavy padding","stiff canvas"]',
      'Business Formal'
    ),
    (
      'elevated_slouch',
      '["eclectic","minimalist","textured","modern"]',
      '["relaxed","oversized","fluid"]',
      '["brushed cotton","heavy jersey","tweed","knits"]',
      '["rigid synthetics"]',
      'Elevated Casual'
    )
) AS v(
  key,
  canonical_style_tags_json,
  silhouette_bias_tags_json,
  material_prefer_json,
  material_avoid_json,
  formality_bias
) ON v.key = sc.key
ON CONFLICT (style_catalog_id)
DO UPDATE SET
  canonical_style_tags_json = EXCLUDED.canonical_style_tags_json,
  silhouette_bias_tags_json = EXCLUDED.silhouette_bias_tags_json,
  material_prefer_json = EXCLUDED.material_prefer_json,
  material_avoid_json = EXCLUDED.material_avoid_json,
  formality_bias = EXCLUDED.formality_bias,
  updated_at = NOW();

INSERT INTO style_catalog_alias (style_catalog_id, alias_term)
SELECT sc.id, v.alias_term
FROM style_catalog sc
JOIN (
  VALUES
    ('vintage_americana', 'vintage americana'),
    ('vintage_americana', 'heritage style'),
    ('vintage_americana', 'mid-century casual'),
    ('vintage_americana', 'heritage inspired'),
    ('vintage_americana', 'heritage-inspired'),
    ('vintage_americana', 'heritage touch'),
    ('vintage_americana', 'heritage touches'),

    ('amekaji', 'amekaji'),
    ('amekaji', 'american casual'),
    ('amekaji', 'japanese americana'),

    ('workwear', 'heritage workwear'),
    ('workwear', 'utilitarian'),
    ('workwear', 'rugged'),
    ('workwear', 'manual style'),
    ('workwear', 'workwear'),
    ('workwear', 'utility style'),
    ('workwear', 'military style'),
    ('workwear', 'military inspired'),
    ('workwear', 'military-inspired'),
    ('workwear', 'field style'),

    ('military_heritage', 'military'),
    ('military_heritage', 'army style'),
    ('military_heritage', 'army surplus'),
    ('military_heritage', 'surplus style'),
    ('military_heritage', 'fatigue pants'),
    ('military_heritage', 'fatigue style'),
    ('military_heritage', 'field jacket'),
    ('military_heritage', 'heritage'),
    ('military_heritage', 'heritage look'),
    ('military_heritage', 'heritage vibe'),

    ('ivy', 'ivy league'),
    ('ivy', 'trad'),
    ('ivy', 'soft prep'),
    ('ivy', 'collegiate'),

    ('soft_tailoring', 'neapolitan'),
    ('soft_tailoring', 'florentine'),
    ('soft_tailoring', 'sartorial casual'),
    ('soft_tailoring', 'soft tailoring'),

    ('elevated_slouch', 'high-low'),
    ('elevated_slouch', 'creative casual'),
    ('elevated_slouch', 'modern evergreen'),
    ('elevated_slouch', 'slouchy chic')
) AS v(key, alias_term) ON v.key = sc.key
ON CONFLICT (style_catalog_id, alias_term)
DO NOTHING;

COMMIT;
