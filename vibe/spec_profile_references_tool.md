# Spec: Profile-Managed Menswear References + Reference Tool

## Problem
Reference dictionary is hardcoded and not personalized.

## Goals
- Let user create menswear references in profile from free-text name lookup.
- Use saved references in `Add Tool > Reference`.
- Apply reference constraints deterministically in AI Look scoring.

## Non-Goals
- Public/shared reference marketplace.
- Fully automatic save without user confirmation.

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
- `display_name`
- `reference_payload_json` (structured schema, versioned)
- `created_at`, `updated_at`

## API
1. `POST /api/profile/references/load`
- Input: `{ name: string }`
- Calls LLM and returns validated reference schema.
2. `POST /api/profile/references`
- Save validated reference to profile.
3. `GET /api/profile/references`
- List saved references for tool picker.

## Guardrails
- Validate LLM output with strict zod schema.
- Reject if required style/material/formality fields are missing.
- Owner-only endpoints.

## AI Look Integration
- Selected reference tool contributes deterministic style/material/formality biases.
- Tool-derived reference directives outrank free-text reference matching.

## Implementation Plan
1. Define versioned reference schema + zod validator.
2. Add DB migration and profile reference CRUD APIs.
3. Build profile reference UI (`Load Opinions` + preview + save).
4. Add AI Look Reference tool picker and merge logic.

## Acceptance Criteria
- User can create and save reference profiles from name input.
- AI Look can select saved reference via tool chip.
- Logs show reference directive source as `tool` when selected.
