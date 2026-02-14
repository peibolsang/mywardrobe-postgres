# Spec: Profile-Managed Menswear Icons + Icon Tool

## Problem
Icon dictionary is hardcoded and not personalized.

## Goals
- Let user create icon references in profile from free-text name lookup.
- Use saved icon references in `Add Tool > Icon`.
- Apply icon constraints deterministically in AI Look scoring.

## Non-Goals
- Public/shared icon marketplace.
- Fully automatic save without user confirmation.

## UX
Profile flow:
1. Enter icon name.
2. Click `Load Opinions`.
3. Show structured icon preview.
4. Click `Add` to save in profile.

AI Look flow:
- `Add Tool > Icon` shows saved references.
- Selected icon is attached as tool chip.

## Data Model
1. `user_profile_icon`
- `id` (uuid/text)
- `owner_key`
- `display_name`
- `icon_payload_json` (structured schema, versioned)
- `created_at`, `updated_at`

## API
1. `POST /api/profile/icons/load`
- Input: `{ name: string }`
- Calls LLM and returns validated icon schema.
2. `POST /api/profile/icons`
- Save validated icon to profile.
3. `GET /api/profile/icons`
- List saved icons for tool picker.

## Guardrails
- Validate LLM output with strict zod schema.
- Reject if required style/material/formality fields are missing.
- Owner-only endpoints.

## AI Look Integration
- Selected icon tool contributes deterministic style/material/formality biases.
- Tool-derived icon directives outrank free-text icon matching.

## Implementation Plan
1. Define versioned icon schema + zod validator.
2. Add DB migration and profile icon CRUD APIs.
3. Build profile icon UI (`Load Opinions` + preview + save).
4. Add AI Look Icon tool picker and merge logic.

## Acceptance Criteria
- User can create and save icon profiles from name input.
- AI Look can select saved icon via tool chip.
- Logs show icon directive source as `tool` when selected.
