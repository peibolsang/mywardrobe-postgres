# Spec: Fix Ivy DB Parity and Ivy Scoring Calibration

## Scope
This spec addresses only:
1. `#2` Ivy UI/DB parity issue.
2. `#3` Ivy scoring calibration issue in AI Look (single + travel).

Out of scope:
1. Multi-style schema redesign (already implemented).
2. Global migration safety for `garment_style` table (`#1`).

---

## Problem 2: Ivy UI/DB Parity

### Current Problem
1. `public/schema.json` includes `ivy` in style enum.
2. Editor allows selecting `ivy`.
3. Server actions validate selected styles against DB table `styles`.
4. If `styles` table does not contain `ivy`, save fails with invalid style error.

### Goal
Make Ivy selection persist reliably wherever schema exposes Ivy.

### Proposed Solution
1. Add explicit SQL seed for canonical style row:
   - `INSERT INTO styles(name) VALUES ('ivy') ON CONFLICT (name) DO NOTHING;`
2. Add startup/preflight parity check behavior in save path:
   - If schema includes `ivy` but DB style lookup misses it, return explicit operational error:
     - `"Style taxonomy out of sync: missing canonical style 'ivy' in DB. Run style seed SQL."`
3. Add structured log event for mismatch:
   - `[style-taxonomy][parity][missing-style] { style: "ivy", source: "schema" }`
4. Document migration order:
   - Apply DB style seed before enabling schema enum in production.

### Implementation Touchpoints
1. SQL scripts:
   - add/update a migration script under `scripts/sql/` for style seed parity.
2. Server actions:
   - `actions/garment.ts` (create/update style validation path).
3. Optional:
   - `/api/editor-options` health signal for style parity diagnostics.

### Acceptance Criteria
1. Selecting `ivy` in editor can be saved successfully.
2. If DB is missing `ivy`, error message is explicit and actionable.
3. Logs include parity mismatch event.

---

## Problem 3: Ivy Scoring Calibration

### Current Problem
1. Ivy matching allows soft fallback (`preppy`, `classic`).
2. Some objective style checks can treat fallback as equivalent to exact ivy.
3. This can rank non-ivy lineups too high for ivy intent.

### Goal
Keep Ivy first-class:
1. Exact ivy should rank highest for ivy intent.
2. `preppy/classic` should remain fallback, but with lower weight.
3. Rugged-opposed styles remain penalized under ivy intent.

### Proposed Scoring Rules
1. Exact match tier:
   - Garment with `ivy` tag receives full ivy match credit.
2. Soft fallback tier:
   - `preppy/classic` receive partial ivy fallback credit only.
3. Objective style-dimension rule:
   - For `intent.style` containing `ivy`, style-dimension “full match” should require at least one exact `ivy` hit per garment-level match decision.
   - Fallback should contribute reduced score, not full-equivalent boolean match.
4. Opposition penalty:
   - `workwear/outdoorsy/western` incur soft negative bias when ivy is active and garment is not ivy-tagged.

### Single/Travel Behavior
1. Single mode:
   - Rerank should prefer lineups with exact ivy coverage when available.
2. Travel mode:
   - Keep reason-aware weighting:
     - stronger ivy bias for `Office` / `Customer visit`
     - softer on `Vacation`
   - But still apply exact-vs-fallback distinction.

### Implementation Touchpoints
1. `app/api/ai-look/route.ts`
   - style matching helper(s)
   - objective match score style dimension
   - directive fit scoring
   - single rerank tie-break behavior
   - travel day scoring paths

### Acceptance Criteria
1. If wardrobe has ivy-tagged candidates, ivy prompts select them over only preppy/classic alternatives.
2. If no ivy-tagged candidates exist, fallback still produces viable results (no hard failure).
3. Rugged-opposed styles are de-prioritized under ivy intent.
4. Non-ivy prompts show no material regression in selection quality.

---

## Rollout Plan
1. Phase A: DB/UI parity fix (`#2`)
   - Ship seed SQL + explicit validation error + telemetry.
2. Phase B: Scoring calibration fix (`#3`)
   - Adjust objective style scoring + fallback weighting.
3. Verification run:
   - Execute prompt set for ivy and non-ivy scenarios.
   - Compare selected signatures and rerank breakdown.

---

## Test Matrix
1. Editor save with styles `["ivy"]` (create and update).
2. Editor save with styles `["ivy","preppy"]`.
3. Ivy prompt with ivy-rich wardrobe.
4. Ivy prompt with zero ivy garments (fallback expected).
5. Travel prompts (`Office`, `Customer visit`, `Vacation`) with ivy tool and free-text ivy.
6. Control prompts without ivy (classic/minimalist/workwear) to confirm no regressions.

---

## Implementation Status
1. Implemented `#2` parity guard in `actions/garment.ts`:
   - schema-aware ivy mismatch detection
   - explicit actionable error message
   - structured parity log event
2. Implemented `#2` SQL seed script:
   - `scripts/sql/seed-style-ivy.sql`
3. Implemented `#3` scoring calibration in `app/api/ai-look/route.ts`:
   - objective style dimension uses exact ivy matching when ivy intent is active
   - directive scoring distinguishes full ivy match vs partial fallback match
   - per-garment intent scoring no longer grants full ivy credit to preppy/classic fallback
