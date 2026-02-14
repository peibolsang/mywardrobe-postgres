# Spec: Profile-Backed Styles + Style Tool

## Problem
Style dictionary is hardcoded; users cannot explicitly define preferred style sets.

## Goals
- Move style catalog and user style preferences into DB.
- Let users select preferred styles in profile.
- Expose style selections through `Add Tool > Style`.

## Non-Goals
- Removing all free-text style extraction.
- Per-request custom style creation.

## Data Model
1. `style_catalog`
- `id` (uuid/text)
- `name` (unique)
- `canonical_style` (must map to schema enum)
- `description` (optional)
- `is_active`

2. `user_profile_style`
- `owner_key`
- `style_catalog_id`
- composite unique (`owner_key`, `style_catalog_id`)

## API
1. `GET /api/profile/styles`
- Returns user-selected styles + available catalog.
2. `POST /api/profile/styles`
- Replace or patch selected style IDs.

## AI Look Integration
- `Add Tool > Style` lists styles from `user_profile_style`.
- Selected style tools become top-priority style directives.
- Free-text style aliases remain fallback only.

## Implementation Plan
1. Add migrations for `style_catalog` and `user_profile_style`.
2. Seed catalog from existing canonical styles.
3. Build profile style manager UI.
4. Add `Style` tool picker in AI Look.
5. Merge tool styles into directive pipeline.

## Acceptance Criteria
- User can persist style preferences in profile.
- AI Look style tool uses profile styles in request payload.
- Step-1 logs show non-empty directives from style tool even with neutral prompt text.
