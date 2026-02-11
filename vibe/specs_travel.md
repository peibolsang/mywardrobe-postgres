# Travel Mode Persistent Diversity Spec

## 1. Goal
Prevent repeated travel-day outfits across separate executions of the same travel input (destination + dates + reason), while preserving current per-request travel constraints.

Target behavior:
- If the user runs the same travel request twice in a row, day results should differ when viable alternatives exist.
- If no valid alternative exists under strict constraints, repeating the previous look is allowed.

## 2. Scope
In scope:
- `POST /api/ai-look` travel mode (`mode: "travel"`).
- Persistence-backed anti-repeat memory across requests.
- Hard no-repeat for prior day signatures when alternatives exist.
- Soft novelty pressure to reduce garment reuse across runs.

Out of scope:
- Single-look mode changes (already handled separately).
- UI redesign beyond current travel cards.

## 3. Functional Requirements
1. Keep all existing travel rules unchanged:
   - strict place/occasion rules
   - one outerwear across trip
   - footwear constraints
   - transit reservation
   - duplicate/high-overlap checks within a request
2. Add cross-request travel memory:
   - Persist generated day signatures and garment IDs for completed travel days.
   - Load relevant history at start of each travel request.
3. Cross-request anti-repeat behavior:
   - For each current day, avoid historical signatures for the same travel fingerprint/day context when alternatives exist.
   - If no viable alternative survives constraints, allow repeated signature.
4. Cross-request novelty behavior:
   - Penalize recently used garment IDs (soft, not absolute).
   - Feed recent IDs/signatures into model prompt as diversity hints.
5. Graceful degradation:
   - Do not fail the whole plan due to diversity rules.
   - Keep current `skippedDays` behavior for unsatisfied strict constraints.

## 4. Travel Fingerprint
Define deterministic request fingerprint for memory lookup:
- normalized destination label (resolved destination)
- reason
- startDate
- endDate

Example canonical key:
`lower(trim(destination))|reason|startDate|endDate`

Use this to scope anti-repeat history for “same prompt/input” reruns.

## 5. Persistence Model
Add new table (explicit migration; no runtime DDL):

`ai_look_travel_day_history`
- `id BIGSERIAL PRIMARY KEY`
- `owner_key TEXT NOT NULL`
- `request_fingerprint TEXT NOT NULL`
- `destination_label TEXT NOT NULL`
- `reason TEXT NOT NULL`
- `day_date DATE NOT NULL`
- `day_index INTEGER NOT NULL`
- `lineup_signature TEXT NOT NULL`
- `garment_ids_json TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:
- `(owner_key, request_fingerprint, day_date, created_at DESC)`
- `(owner_key, request_fingerprint, lineup_signature)`
- `(owner_key, created_at DESC)`

## 6. Selection Logic Requirements
For each generated day:
1. Build `recentDaySignatures` from history for that same `request_fingerprint` + `day_date`.
2. Hard filter:
   - If non-repeated valid candidate exists, reject repeated signatures.
3. Soft filter:
   - Apply extra penalty for candidates with high overlap against historical day IDs.
4. Retry path:
   - On repeated-signature violation with fresh alternatives available, retry generation with stricter forbidden IDs/signatures.
5. Final fallback:
   - If only repeated candidate is feasible, allow it and annotate in logs.

## 7. Prompting Requirements (Travel)
When generating each day candidate, include:
- hard avoid list of historical signatures for matching day context
- soft avoid list of recently used garment IDs
- explicit instruction: repeat only if no valid alternative survives strict constraints

## 8. Observability
Add logs:
- travel history rows loaded per request/day
- repeated-signature detection per day
- retry invoked due to historical repeat
- selected day signature + `repeatedFromHistory` boolean

## 9. Error Handling
- History read/write failures are warnings; travel generation continues.
- Diversity constraints must not convert solvable requests into hard 500 errors.
- Existing 422/skip logic remains authoritative for strict constraint failures.

## 10. Acceptance Criteria
1. Running identical travel input twice in a row yields different day looks when alternatives exist.
2. Repeated day signatures occur only when constraints leave no viable alternative.
3. Existing travel hard constraints remain enforced.
4. Feature works without UI changes.
5. Migration script exists and is required before rollout.
