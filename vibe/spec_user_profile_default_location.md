# Spec: User Profile v1 - Default Location

## Problem
Users must repeat location in every AI Look prompt to get weather-aware recommendations.

## Goals
- Persist a profile `default_location`.
- Use it automatically in single-look weather resolution when prompt has no explicit location.
- Keep server-side deterministic precedence.

## Non-Goals
- Multi-user profile settings beyond owner scope.
- Travel mode behavior changes.

## UX
- Add `Profile` page section: `Default Location` text input + save action.
- Show helper text: "Used for AI Look weather when your prompt has no place."

## Data Model
1. `user_profile`
- `id` (pk)
- `owner_key` (unique, text)
- `default_location` (text, nullable)
- `created_at`, `updated_at`

## API / Server Actions
1. `GET /api/profile`
- Returns `{ defaultLocation: string | null }`
2. `POST /api/profile`
- Body: `{ defaultLocation: string | null }`
- Owner-only auth required.

## AI Look Integration
Location resolution priority for single-look:
1. Explicit location parsed from prompt.
2. `user_profile.default_location`.
3. No location (skip weather fetch path as currently designed fallback).

Add observability field in logs:
- `resolvedLocationSource: "prompt" | "profile" | "none"`

## Implementation Plan
1. Add SQL migration for `user_profile`.
2. Add profile read/write server functions.
3. Add profile UI section.
4. Wire single-look location fallback to profile value.
5. Add logs + manual verification.

## Acceptance Criteria
- Prompt without place uses saved profile location.
- Prompt with explicit place overrides profile value.
- Empty profile location keeps current non-location fallback behavior.
