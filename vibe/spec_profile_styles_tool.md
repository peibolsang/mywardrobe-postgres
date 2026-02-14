# Spec: Profile-Backed Styles + Style Tool

## Problem
Style dictionary is hardcoded; users cannot explicitly define preferred style sets, and style directive logic is tied to in-code entries.

## Goals
- Move style catalog and user style preferences into DB.
- Let users select preferred styles in profile.
- Expose style selections through `Add Tool > Style`.
- Preserve current single-look style-directive behavior in `app/api/ai-look/route.ts` with parity to existing rich style entries, but sourced from DB instead of hardcoded in code.

## Non-Goals
- Removing all free-text style extraction.
- Per-request custom style creation.
- Changing current style directive semantics/scoring rules during migration (this effort is source migration + parity, not retuning).

## Data Model
1. `style_catalog`
- `id` (uuid/text)
- `key` (unique, stable machine key; ex: `workwear`, `military_heritage`)
- `name` (display label)
- `canonical_style` (must map to schema enum; primary style anchor)
- `description` (optional, display/helper text)
- `is_active`
- `created_at`, `updated_at`

2. `style_catalog_alias`
- `id` (uuid/text)
- `style_catalog_id` (fk -> `style_catalog.id`)
- `alias_term` (normalized match term used in free-text extraction)
- unique (`style_catalog_id`, `alias_term`)

3. `style_catalog_directive`
- `style_catalog_id` (pk/fk -> `style_catalog.id`)
- `canonical_style_tags_json` (array<string>)
- `silhouette_bias_tags_json` (array<string>)
- `material_prefer_json` (array<string>)
- `material_avoid_json` (array<string>)
- `formality_bias` (nullable string; maps to canonical formality options)
- `created_at`, `updated_at`

4. `user_profile_style`
- `owner_key`
- `style_catalog_id`
- composite unique (`owner_key`, `style_catalog_id`)

## Rich Field Parity Requirement
The DB must carry all fields currently used by style directive extraction/build logic in `app/api/ai-look/route.ts`:
- alias terms (today: `terms`)
- canonical style tags (today: `styleTags`)
- silhouette bias tags (today: `silhouetteTags`)
- material prefer list (today: `materialPrefer`)
- material avoid list (today: `materialAvoid`)
- formality bias (today: `formalityBias`)

Steady state requirement:
- No hardcoded style dictionary should be the runtime source of truth for single-look style directives.
- Runtime style directives must be loaded from DB-backed style records.

## API
1. `GET /api/profile/styles`
- Returns user-selected styles + available catalog from DB.
2. `POST /api/profile/styles`
- Replace or patch selected style IDs.
3. `GET /api/style-catalog` (owner/internal service endpoint)
- Returns active catalog entries with full directive payload (aliases + directive fields) for tool UI and debugging.

## Migration and Seeding
1. Create migration scripts for `style_catalog`, `style_catalog_alias`, `style_catalog_directive`, and `user_profile_style`.
2. Backfill DB using current in-code style dictionary entries from `app/api/ai-look/route.ts` as the source snapshot.
3. Validate row-level parity:
- each legacy style key exists in `style_catalog`
- each legacy alias exists in `style_catalog_alias`
- each legacy directive field maps 1:1 into `style_catalog_directive`
4. Switch runtime reads in AI Look to DB source.
5. Remove/retire hardcoded dictionary after parity verification.

## AI Look Integration
- `Add Tool > Style` lists styles from `user_profile_style`.
- Selected style tools become top-priority style directives.
- Free-text style aliases remain fallback only.
- Free-text alias matching must query DB aliases (`style_catalog_alias`) instead of hardcoded `terms`.
- Style directive assembly must use DB directive payload fields from `style_catalog_directive`.
- Deterministic merge precedence remains unchanged (`tool-selected > free-text > derived fallback`).

## Implementation Plan
1. Add migrations for `style_catalog`, `style_catalog_alias`, `style_catalog_directive`, `user_profile_style`.
2. Implement idempotent seed/backfill from current in-code style dictionary snapshot.
3. Add server read layer for active style directive entries (typed + validated).
4. Refactor AI Look Step-1 style directive extraction to use DB entries for tool-selected and free-text paths.
5. Keep scoring/rerank logic unchanged; only replace data source.
6. Build/adjust profile style manager UI + `Add Tool > Style` to consume DB-backed styles.
7. Add observability logs for source and resolved style keys (requested vs applied from DB).

## Acceptance Criteria
- User can persist style preferences in profile.
- AI Look style tool uses profile styles in request payload.
- Step-1 logs show non-empty directives from style tool even with neutral prompt text.
- For a regression test set of prompts, DB-backed directive extraction produces equivalent resolved style directives to legacy hardcoded behavior.
- AI Look endpoint functions correctly when hardcoded style dictionary is removed/disabled.
