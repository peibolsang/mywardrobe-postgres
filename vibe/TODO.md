# Vibe Feature Backlog

Use this file to track proposed features before implementation.

## Prioritization
- `Now`: high impact or blocking work.
- `Next`: valuable, but not urgent.
- `Later`: exploratory or lower-priority ideas.

## Item Template
- **Title**:
- **Why**:
- **Scope**:
- **Dependencies**:
- **Priority**: `Now | Next | Later`
- **Effort**: `S | M | L`
- **Status**: `Planned | In Progress | Done`
- **Notes**:

## Now

- **Title**: User Profile v1 with `default_location`
- **Why**: Remove repeated location typing in single-look prompts and improve weather grounding consistency.
- **Scope**:
  - Add profile persistence for owner user with a `default_location` field.
  - Add profile UI to view/edit default location.
  - Update single-look weather resolution so location priority is:
    1) explicit location in prompt,
    2) profile `default_location`,
    3) no weather lookup fallback path.
  - Add observability logs showing resolved location source (`prompt` vs `profile` vs `none`).
- **Dependencies**:
  - DB migration for profile table or profile extension.
  - Auth-linked owner key/user key mapping.
  - API/server action for profile read/write.
- **Priority**: `Now`
- **Effort**: `M`
- **Status**: `Planned`
- **Notes**: Keep server-side fallback deterministic; never trust client-only location state. Spec: `vibe/spec_user_profile_default_location.md`.

- **Title**: AI Look prompt bar `Add Tool` framework
- **Why**: Support structured style/reference intent from explicit tool selections instead of only free text parsing.
- **Scope**:
  - Add `Add Tool` UI in AI Look input area.
  - Tool chips should be attachable/removable before submit.
  - Request payload must carry `selectedTools` alongside user prompt.
  - `/api/ai-look` should merge tool-provided directives with free-text directives using deterministic precedence.
- **Dependencies**:
  - Shared tool payload schema (client + API).
  - Backward-compatible API contract update.
- **Priority**: `Now`
- **Effort**: `L`
- **Status**: `Done`
- **Notes**: This is the foundation for both Style and Reference tools below. Spec: `vibe/spec_ai_look_add_tool_framework.md`.

## Next

- **Title**: Move style dictionary to profile-backed data + `Style` tool
- **Why**: Replace hardcoded style aliases with user-configurable preferences and explicit tool-driven style intent.
- **Scope**:
  - Create DB tables for predefined styles and user-selected favorite styles.
  - Add profile UI for selecting favorite styles from predefined catalog.
  - Add `Style` option under `Add Tool` to select one or more styles from profile.
  - Update step-1 directive extraction to consume selected style tools as first-class directives.
  - Keep free-text style extraction as fallback only.
- **Dependencies**:
  - New style catalog + user junction tables.
  - API endpoints/server actions for style catalog and profile selections.
  - Deterministic merge policy between tool styles and prompt-derived styles.
- **Priority**: `Next`
- **Effort**: `L`
- **Status**: `Done`
- **Notes**: Preserve canonical style enums to keep rerank/style-fit behavior stable. Spec: `vibe/spec_profile_styles_tool.md`.

## Later

- **Title**: Profile-managed menswear reference library + `Reference` tool
- **Why**: Let users personalize menswear references and apply them explicitly in AI Look without hardcoded dictionaries.
- **Scope**:
  - Add profile section `Add Menswear Reference`.
  - Provide free-text name input + `Load Opinions` action that calls LLM and returns structured reference profile data.
  - Show preview of structured profile for confirmation, then save to user profile.
  - Add `Reference` option under `Add Tool` to pick saved references per request.
  - Update AI step-1/step-2 pipeline so reference tool directives are applied deterministically in scoring/rerank.
- **Dependencies**:
  - DB tables for user reference profiles and versioned reference schema payload.
  - New owner-only API route for `Load Opinions` and save flow.
  - Validation guardrails for LLM-generated reference schema.
- **Priority**: `Later`
- **Effort**: `L`
- **Status**: `Done`
- **Notes**: Start with owner-only profile scope; multi-user generalization can come later. Spec: `vibe/spec_profile_references_tool.md`.
