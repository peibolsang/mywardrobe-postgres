# Spec: AI Look - Add Tool Framework

## Problem
Style/reference intent is currently inferred from free text only; users need explicit structured controls.

## Goals
- Add ChatGPT-like `Add Tool` interaction in AI Look input.
- Send explicit tool selections in request payload.
- Merge tool directives with free-text directives deterministically.

## Non-Goals
- Full multi-modal tool marketplace.
- Replacing free-text intent parsing.

## UX
- AI Look input includes `Add Tool` trigger.
- User can add removable tool chips before submit.
- Initial tool types:
  - `Style`
  - `Icon`

## Request Contract
Extend single-look request with:
- `selectedTools?: Array<{ type: "style" | "icon"; id: string }>`

Backward compatibility:
- If `selectedTools` omitted, existing flow unchanged.

## Server Merge Policy
Priority order:
1. Hard safety/context constraints (unchanged).
2. Tool-selected directives.
3. Free-text extracted directives.
4. Derived profile fallback.

## Implementation Plan
1. Define shared zod schema for tool payload.
2. Update AI Look client state + submit payload.
3. Parse + validate tools in `/api/ai-look`.
4. Merge directives with deterministic precedence.
5. Add logs for selected tools and merge output.

## Acceptance Criteria
- Tool chips are visible, removable, and submitted.
- API accepts requests with/without tools.
- Selected tools visibly influence `userDirectives` and style-fit logs.
