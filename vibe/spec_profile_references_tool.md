# Spec: Profile-Managed Menswear References + Reference Tool

## Problem
Reference dictionary is hardcoded and not personalized, and reference directive logic is tied to in-code entries.

## Goals
- Let user create menswear references in profile from free-text name lookup.
- Use saved references in `Add Tool > Reference`.
- Apply reference constraints deterministically in AI Look scoring.
- Preserve current single-look reference-directive behavior in `app/api/ai-look/route.ts` with parity to existing rich reference entries, but sourced from DB instead of hardcoded in code.

## Non-Goals
- Public/shared reference marketplace.
- Fully automatic save without user confirmation.
- Changing current reference directive semantics/scoring rules during migration (this effort is source migration + parity, not retuning).

## UX
Profile flow:
1. Enter reference name.
2. Click `Load Opinions`.
3. Show structured reference preview.
4. Click `Add` to save in profile.

AI Look flow:
- `Add Tool > Reference` shows saved references.
- Selected reference is attached as tool chip.

## Data Model
1. `user_profile_reference`
- `id` (uuid/text)
- `owner_key`
- `key` (stable machine key per owner; ex: `alessandro_squarzi`)
- `display_name`
- `source_name` (raw user-provided name; optional)
- `reference_payload_json` (optional audit/debug payload)
- `schema_version`
- `is_active`
- `created_at`, `updated_at`

2. `user_profile_reference_alias`
- `id` (uuid/text)
- `reference_id` (fk -> `user_profile_reference.id`)
- `alias_term` (normalized match term used in free-text extraction)
- unique (`reference_id`, `alias_term`)

3. `user_profile_reference_directive`
- `reference_id` (pk/fk -> `user_profile_reference.id`)
- `style_bias_tags_json` (array<string>)
- `silhouette_bias_tags_json` (array<string>)
- `material_prefer_json` (array<string>)
- `material_avoid_json` (array<string>)
- `formality_bias` (nullable string; maps to canonical formality options)
- `created_at`, `updated_at`

## Rich Field Parity Requirement
The DB must carry all fields currently used by reference directive extraction/build logic in `app/api/ai-look/route.ts`:
- alias terms (today: `terms`)
- style bias tags (today: `styleTags`)
- silhouette bias tags (today: `silhouetteTags`)
- material prefer list (today: `materialPrefer`)
- material avoid list (today: `materialAvoid`)
- formality bias (today: `formalityBias`)

Steady state requirement:
- No hardcoded reference dictionary should be the runtime source of truth for single-look reference directives.
- Runtime reference directives must be loaded from DB-backed reference records.

## API
1. `POST /api/profile/references/load`
- Input: `{ name: string }`
- Calls LLM and returns validated reference schema with rich directive fields.
2. `POST /api/profile/references`
- Save validated reference to profile.
3. `GET /api/profile/references`
- List saved references for tool picker (with stable `key` + display label).
4. `GET /api/profile/references/catalog` (owner/internal service endpoint)
- Returns active references with aliases + directive fields for AI lookup/debugging.

## Migration and Seeding
1. Create migration scripts for `user_profile_reference`, `user_profile_reference_alias`, `user_profile_reference_directive`.
2. Backfill DB using current in-code reference dictionary entries from `app/api/ai-look/route.ts` as initial owner snapshot (or owner seed strategy).
3. Validate row-level parity:
- each legacy reference key exists in `user_profile_reference`
- each legacy alias exists in `user_profile_reference_alias`
- each legacy directive field maps 1:1 into `user_profile_reference_directive`
4. Switch runtime reads in AI Look to DB source.
5. Remove/retire hardcoded dictionary after parity verification.

## Guardrails
- Validate LLM output with strict zod schema.
- Reject if required style/material/formality fields are missing.
- Owner-only endpoints.

## AI Look Integration
- Selected reference tool contributes deterministic style/material/formality biases.
- Tool-derived reference directives outrank free-text reference matching.
- Free-text alias matching must query DB aliases (`user_profile_reference_alias`) instead of hardcoded `terms`.
- Reference directive assembly must use DB directive fields from `user_profile_reference_directive`.
- Deterministic merge precedence remains unchanged (`tool-selected > free-text > derived fallback`).

## Implementation Plan
1. Define versioned reference schema + zod validator with full rich directive fields.
2. Add DB migrations for reference core + alias + directive tables.
3. Implement idempotent seed/backfill from current in-code reference dictionary snapshot.
4. Add server read layer for active reference directive entries (typed + validated).
5. Refactor AI Look Step-1 reference directive extraction to use DB entries for tool-selected and free-text paths.
6. Keep scoring/rerank logic unchanged; only replace data source.
7. Build profile reference UI (`Load Opinions` + preview + save) + `Add Tool > Reference` from DB-backed entries.
8. Add observability logs for source and resolved reference keys (requested vs applied from DB).

## Acceptance Criteria
- User can create and save reference profiles from name input.
- AI Look can select saved reference via tool chip.
- Logs show reference directive source as `tool` when selected.
- For a regression test set of prompts, DB-backed reference extraction produces equivalent resolved reference directives to legacy hardcoded behavior.
- AI Look endpoint functions correctly when hardcoded reference dictionary is removed/disabled.
