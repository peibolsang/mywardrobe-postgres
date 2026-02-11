# Anchored Garment CMDK Spec (Single-Look Mode)

## 1. Goal
Add a CMDK-driven workflow that generates a single AI look anchored on a specific garment.

Target behavior:
- From a garment context, user runs a command to generate a look around that garment.
- AI Look generation must include the anchor garment in the final lineup.
- Existing non-anchored AI Look behavior remains unchanged.

## 2. Problem Statement
Current single-look flow optimizes for intent and diversity but has no hard garment anchor input.  
Users cannot force a specific piece (for example, a jacket) to be part of the look from command interactions.

## 3. Scope
In scope:
- Single-look mode only (`POST /api/ai-look`).
- CMDK command from garment context.
- Optional API fields to support anchored generation.
- Deterministic server-side anchor enforcement and fallback.
- Minimal UI affordance in `/ai-look` showing active anchor context.

Out of scope:
- Travel mode (`mode: "travel"`).
- Multi-look outputs.
- New database tables/migrations.

## 4. UX Requirements
### 4.1 Entry Point
Add CMDK command in garment-detail context:
- Command label: `Generate look around this garment`
- Action: navigate to `/ai-look?anchorGarmentId=<id>&anchorMode=strict`

Notes:
- This command is context-bound: only available when a specific garment is known.
- Keep existing CMDK behavior in `/viewer` intact.

### 4.2 AI Look Page Behavior
On `/ai-look`:
- Read `anchorGarmentId` and `anchorMode` from URL search params.
- In single-look tab, show compact anchor badge:
  - `Anchored on: <model> — <brand> (<type>)` when resolvable.
- Include clear control:
  - `Clear anchor` removes anchor params from URL and local request payload.

### 4.3 Request Submission
Single-look submit payload becomes:
- required: `prompt`
- optional: `anchorGarmentId`
- optional: `anchorMode` (`strict` | `soft`)

Default for CMDK entry:
- `anchorMode = "strict"`

## 5. API Contract (Single-Look)
Extend request schema:
- `prompt: string`
- `anchorGarmentId?: number`
- `anchorMode?: "strict" | "soft"`

Response shape remains unchanged:
- `mode: "single"`
- `primaryLook`
- `interpretedIntent`
- weather metadata

No response contract changes required for initial rollout.

## 6. Anchor Semantics
### 6.1 Strict Mode
- Final selected lineup must include `anchorGarmentId`.
- If no valid complete lineup can include anchor under silhouette rules, return `422` with explicit reason.

### 6.2 Soft Mode
- System should prefer including anchor.
- If impossible under validity constraints, allow non-anchored final lineup.

### 6.3 Category Constraints
Single-look still requires fixed silhouette:
- exactly one `outerwear`, one `top`, one `bottom`, one `footwear`.

Anchor implications:
- If anchor maps to one of required categories, it occupies that category slot.
- If anchor maps to `other`, strict mode should fail fast (`422`) because fixed 4-piece schema cannot include non-core category in current model.

## 7. Selection Logic Requirements
### 7.1 Step 1
No changes to intent interpretation/weather grounding.

### 7.2 Step 2 Candidate Generation
When anchor provided:
- Add prompt rule:
  - strict: candidate `selectedGarmentIds` must include anchor ID.
  - soft: prefer including anchor ID.

### 7.3 Deterministic Post-Processing
For each candidate:
1. Validate IDs exist.
2. Normalize to fixed categories.
3. Enforce anchor according to mode:
   - strict: inject/retain anchor in its category slot; drop candidate if impossible.
   - soft: try to preserve anchor; continue if not feasible.

### 7.4 Fallback
If no model candidate survives:
- Build deterministic fallback lineup with anchor-aware filling.
- strict mode must still enforce anchor inclusion.

## 8. Non-Regression Requirements
1. If `anchorGarmentId` is absent, current single-look behavior is byte-for-byte equivalent in logic and response shape.
2. Travel mode behavior remains unchanged.
3. Existing recency/diversity logic remains active for anchored requests, except where strict anchor enforcement requires overlap/repeat fallback.

## 9. Error Handling
Return `422` for anchored request when:
- anchor ID does not exist in wardrobe.
- anchor category is incompatible with fixed silhouette (`other`) in strict mode.
- no complete valid 4-piece lineup can be produced with strict anchor.

Suggested message style:
- concise, actionable, and specific to anchor incompatibility.

## 10. Observability
Add logs in single-look path:
- `[ai-look][single][anchor][request]` with id/mode.
- `[ai-look][single][anchor][candidate-dropped]` reason.
- `[ai-look][single][anchor][fallback-used]` with final signature.
- `[ai-look][single][anchor][selected]` with `includedAnchor: boolean`.

## 11. Security and Authorization
- Reuse existing owner/session protections for `/ai-look`.
- Do not expose extra garment data beyond existing API response contracts.

## 12. Implementation Map
Expected files:
- `components/client/garment-details-client.tsx`
  - add garment-context CMDK command entry.
- `components/ai-look-client.tsx`
  - read/write anchor query params; include fields in single-look request body; show/clear anchor badge.
- `app/api/ai-look/route.ts`
  - extend request schema; enforce anchor in candidate validation/normalization/fallback; add logs.

## 13. Acceptance Criteria
1. From garment context, CMDK can launch anchored single-look generation.
2. Strict anchored request includes anchor garment in final lineup.
3. Non-anchored single-look flow remains unchanged.
4. Travel mode remains unchanged.
5. Clear, deterministic `422` errors are returned for impossible strict-anchor requests.
