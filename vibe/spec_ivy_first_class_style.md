# Spec: Ivy As First-Class Style (Single + Travel + UI + DB)

## Goal
Add `ivy` as a first-class canonical style across the product, with the same treatment as existing canonical styles, while preserving compatibility with current data and logic.

## Decisions (Confirmed)
1. `ivy` is a new canonical style in `public/schema.json`.
2. Garments can be assigned `ivy` directly in editor (multi-style support already in progress).
3. `ivy` must be handled as first-class in AI Look (single + travel), not as a secondary alias-only concept.
4. No automatic data migration is required for existing garments; manual data updates will be handled by owner.
5. Travel mode should weight `ivy` stronger for `Office` and `Customer visit` than `Vacation`.
6. Rugged direction is opposite of ivy and should be penalized when ivy intent is active.
7. Ship as one step (no feature flag).

## Additional Defaults (Applied)
1. Style soft-compatibility for ivy:
   - Primary: `ivy` (full style credit)
   - Soft-related: `preppy`, `classic` (partial credit only)
   - Do not include `minimalist` as ivy soft-related by default.
2. Add `ivy` to style tool catalog defaults with aliases:
   - `ivy`, `ivy style`, `ivy trad`, `trad`, `ivy/trad`
3. Prompt text mentions like `Ivy/Trad` map deterministically to:
   - primary `ivy`, secondary `preppy` (when needed for fallback scoring)
4. Prompt/rule text should explicitly include ivy examples where style examples are listed.

## Scope
1. Schema and style vocabulary.
2. Editor + viewer + details UI behavior.
3. AI single-look style scoring and directive fit.
4. AI travel day weighting.
5. Style tool/reference directive interactions.

## Out Of Scope
1. Automatic backfill/migration of existing garment styles.
2. Re-scoring historical AI feedback records.
3. New UI components beyond extending existing style controls.

## Implementation Plan

### 1) Canonical Vocabulary Update
1. Add `ivy` to `public/schema.json` under `items.properties.style.enum`.
2. Ensure style canonicalization helpers accept `ivy` without alias fallback.
3. Keep existing style values unchanged.

### 2) Multi-Style Data Path (Read/Write)
1. Keep `garments.style_id` as legacy primary style pointer.
2. Use `garment_style` junction for complete style membership.
3. On create/update:
   - persist all selected styles to `garment_style`
   - set `garments.style_id` to first selected style for backward compatibility.
4. On read:
   - expose `styles[]` plus legacy `style` (first style) in API data shape.

### 3) UI/UX
1. Editor:
   - style control remains multi-select.
   - `ivy` appears as selectable option once schema is updated.
2. Viewer filters:
   - style filtering matches against `garment.styles[]`.
3. Garment details:
   - display comma-separated styles.
   - “Find matching pieces” passes all style filters when available.
4. Stats:
   - style counts should include all styles in `styles[]` (not only legacy primary style).

### 4) AI Look: Single Mode
1. Treat `garment.styles[]` as source of truth for style matching.
2. Style scoring:
   - full credit for exact `ivy` hit when `ivy` requested.
   - partial credit for `preppy`/`classic` when `ivy` requested and exact ivy is missing.
3. Opposing-style penalty:
   - when ivy is requested, penalize rugged-direction tags (`workwear`, `outdoorsy`, `western`) in soft scoring.
   - keep hard safety/context constraints above this penalty.
4. Directive fit/logging:
   - include ivy in `requestedStyleTags`, `matchedStyleTags`, coverage metrics.
   - preserve rerank breakdown observability.

### 5) AI Look: Travel Mode
1. Day-level derived style/scoring should support `ivy` exactly as other canonical styles.
2. Reason-specific weighting:
   - Office and Customer visit: stronger positive bias for ivy-aligned garments.
   - Vacation: neutral/softer ivy bias.
3. Keep travel hard constraints unchanged (weather/place/occasion/safety still win).

### 6) Style Catalog / Tooling
1. Add `ivy` style catalog entry (active).
2. Add aliases listed above.
3. Directive payload for ivy style tool:
   - canonical style tags include `ivy` first; optional secondary tags `preppy`, `classic`.
   - silhouette/material/formality guidance aligned to ivy/trad intent.

## Risk Assessment
1. Over-bias risk:
   - ivy preference could overpower context if weights are too high.
   - mitigation: keep ivy influence soft; hard constraints remain dominant.
2. Legacy compatibility risk:
   - modules still reading singular `style` could undercount multi-style.
   - mitigation: preserve `style` as first style, migrate read logic to `styles[]` incrementally.
3. Travel regressions:
   - stronger ivy office weighting could reduce variety.
   - mitigation: apply reason-specific boost, not hard gating.

## Acceptance Criteria
1. `ivy` is selectable in editor and persists correctly.
2. Viewer style filter returns garments tagged `ivy` (including multi-style garments).
3. Garment details show multiple styles cleanly.
4. Single-look with `ivy` request/tool reflects ivy in interpreted intent and style fit diagnostics.
5. Travel mode prioritizes ivy more in Office/Customer visit than Vacation, without violating hard constraints.
6. Rationale and logs treat ivy as canonical first-class style.
7. No TypeScript errors and no regression in existing style flows.

## Verification Checklist
1. Manual create/update garment with styles: `["ivy", "preppy"]`.
2. Viewer filter by `ivy` only.
3. Single-look prompt: “I need an ivy look for today” (with and without style tool).
4. Travel mode:
   - reason `Office` and `Customer visit`: ivy appears more often.
   - reason `Vacation`: ivy bias reduced.
5. Confirm debug logs include ivy in style-fit and rerank diagnostics.
