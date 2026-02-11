# AI Look Diversified Single-Output Spec

## 1. Goal
Improve single-look generation so it does not repeatedly return the same lineup for similar prompts, while still returning exactly one final look.

The system should:
- Generate multiple valid candidate looks in Step 2.
- Validate and normalize candidates server-side.
- Rerank with fit + diversification + recency penalties.
- Return only one final `primaryLook`.

## 2. Scope
In scope:
- Single-look mode only (`POST /api/ai-look` with `{ prompt }`).
- Step 2 changes from one look to multi-candidate generation.
- Server-side reranking and deterministic selection of one final look.
- Persistent recency memory to reduce repeated lineups across requests.

Out of scope:
- Travel mode behavior.
- Panelist-specific outputs and carousel requirements.

## 3. Functional Requirements
1. Step 1 intent interpretation remains unchanged (canonical intent + weather enrichment).
2. Step 2 candidate generation:
   - Attempt to generate `N=6` valid candidates for the same intent.
   - Degrade gracefully (continue with fewer) if validation removes candidates.
3. Candidate validity:
   - Garment IDs must exist in wardrobe.
   - Normalize to fixed 4-piece silhouette: `outerwear + top + bottom + footwear`.
   - Remove duplicate signatures.
4. Final selection:
   - Return exactly one final look (`primaryLook`).
   - Select via reranker using objective fit + model confidence + novelty/diversity penalties.
5. Graceful fallback:
   - If no model candidate survives, synthesize one deterministic valid look from wardrobe scoring.

## 4. Data & Persistence
Use single-look history table:
- Table: `ai_look_lineup_history`
- Purpose: penalize repeated signatures and high-overlap lineups across recent requests.

Schema (already defined via migration script):
- `id BIGSERIAL PRIMARY KEY`
- `owner_key TEXT NOT NULL`
- `mode TEXT NOT NULL` (single)
- `panelist_key TEXT NOT NULL` (set to a fixed value, e.g. `single`) 
- `lineup_signature TEXT NOT NULL`
- `garment_ids_json TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:
- `(owner_key, mode, created_at DESC)`
- `(owner_key, mode, lineup_signature)`

Migration source of truth:
- `scripts/sql/create-ai-look-lineup-history.sql`

## 5. API Contract (single-look)
Single-look response returns exactly one selected look.

Response shape:
- `mode: "single"`
- `primaryLook: { lookName, lineup, rationale, confidence, modelConfidence, matchScore }`
- `interpretedIntent`
- `weatherContext`
- `weatherContextStatus`

No alternatives are returned in the API payload.

## 6. Candidate Generation and Reranking
1. Generate up to 6 candidates in Step 2.
2. Validate and normalize each candidate to required silhouette.
3. Score each candidate with:
   - objective match score
   - model confidence
   - exact-signature recency penalty
   - overlap penalty against recent history
4. Choose best reranked candidate as `primaryLook`.
5. Persist selected signature/garment IDs to history.

## 7. UI Requirements
Single-look tab continues to display one look result card.
- No multi-look carousel.
- Existing confidence and intent details remain.
- Existing lineup and rationale sections remain.

## 8. Observability
Add logs for:
- candidate generation count
- candidate drop reasons
- reranked score breakdown for selected look
- fallback usage when all candidates fail

## 9. Error Handling
- Return success if at least one valid look can be produced (model candidate or deterministic fallback).
- Return 422 only if wardrobe cannot satisfy required core categories.
- History read/write failures are warnings, not hard failures.

## 10. Acceptance Criteria
1. API returns exactly one final look in single mode.
2. Similar prompts show lower repetition over time due to recency penalties.
3. Travel mode remains unchanged.
4. No runtime table-creation logic; migration script is required.
