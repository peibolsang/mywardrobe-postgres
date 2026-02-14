# Specs: Deterministic Style + Icon Directives for AI Look Step 2

## 1) Problem Summary

Current architecture correctly prioritizes canonical context (`weather`, `occasion`, `place`, `timeOfDay`) and deterministic safety rules, but user-expressed style intent (for example `Amekaji`, `Americana`, `Ivy`) and menswear-icon references (for example `Derek Guy`, `Albert Muzquiz`) are often diluted by deterministic derivation and reranking.

Observed behavior from logs:
- Step 2 receives raw prompt, but deterministic `derivedProfile` and rerank filters dominate final selection.
- Candidates with low style alignment can still win when other constraints score higher.
- User-style terms are not represented as first-class structured directives in the deterministic pipeline.

## 2) Goals

1. Preserve current deterministic context/safety guarantees.
2. Make user style/icon intent first-class and auditable in Step 2.
3. Ensure style/icon intent influences:
   - candidate generation prompt,
   - deterministic scoring/reranking,
   - final selection fallback behavior.
4. Keep behavior deterministic and debuggable (JSON logs).

## 3) Non-Goals

- Replacing canonical context intent model.
- Making style purely LLM-driven.
- Introducing runtime auto-created DB tables.
- Changing travel/single mode schemas in breaking ways for clients.

## 4) Proposed Architecture

## 4.1 New Deterministic Directive Layer

Add a deterministic extraction step from raw `userPrompt` before Step 2:

- `style_alias_dictionary`: maps user terms -> canonical style directives.
- `icon_alias_dictionary`: maps icon names -> canonical influence directives.

Output object (new internal contract):

```ts
type UserStyleDirective = {
  canonicalStyleTags: string[];          // e.g. ["vintage", "workwear", "western"]
  silhouetteBiasTags: string[];          // e.g. ["relaxed", "heritage", "layered"]
  materialBias: {
    prefer: string[];                    // e.g. ["denim", "twill", "canvas", "leather"]
    avoid: string[];
  };
  formalityBias?: "Casual" | "Elevated Casual" | "Business Casual" | null;
  confidence: "high" | "medium" | "low";
  sourceTerms: string[];                 // matched prompt tokens
};

type UserIconDirective = {
  iconKey: string;                       // e.g. "derek_guy"
  styleBiasTags: string[];
  silhouetteBiasTags: string[];
  formalityBias?: string | null;
  materialBias: { prefer: string[]; avoid: string[] };
  confidence: "high" | "medium" | "low";
  sourceTerms: string[];
};

type UserIntentDirectives = {
  styleDirectives: UserStyleDirective[];
  iconDirectives: UserIconDirective[];
  merged: {
    styleTagsPrefer: string[];
    silhouetteTagsPrefer: string[];
    materialPrefer: string[];
    materialAvoid: string[];
    formalityBias?: string | null;
  };
};
```

## 4.2 Dictionary Strategy

Create deterministic dictionaries in code (or versioned JSON under repo):

- Style aliases:
  - `amekaji`, `americana`, `ivy`, `prep`, `urban`, `workwear`, `minimalist`, etc.
- Icon aliases:
  - `albert muzquiz`, `alessandro squarzi`, `derek guy`, `aaron levine`, `simon crompton`.

Matching rules:
- Case-insensitive.
- Accent-insensitive normalization.
- Phrase + token matching.
- Word-boundary enforcement to avoid false positives.

Precedence:
1. Explicit user style terms
2. Explicit icon terms
3. Existing derived profile fallback

## 4.3 Optional LLM Assist (Safe Fallback)

Step 1 may return optional `styleHints[]` (non-authoritative).  
Merge policy:
- Deterministic hits are authoritative.
- LLM hints only augment when deterministic confidence is low.
- Final result must map to known canonical tags.

## 5) Step 2 Integration

## 5.1 Prompt Injection (Structured JSON)

Add a dedicated Step 2 block:

```text
User style/icon directives (deterministic):
{ ...UserIntentDirectives JSON... }
```

Prompt rule updates:
- “Respect user style/icon directives unless they conflict with hard context safety constraints.”
- “Prioritize candidates matching merged style directives.”

## 5.2 Deterministic Scoring Integration

Add `computeStyleDirectiveScore(...)` and apply in:
- `scoreGarmentForIntent` (per-garment baseline scoring),
- `computeObjectiveMatchScore` (lineup objective score),
- `computeSingleLookRerankScore` (final candidate rerank).

Add penalties:
- Missing required style directive tags in lineup.
- Strong mismatch with requested icon influence profile.

## 5.3 Selection Guardrail

Add minimum style-fit threshold in final single candidate selection:
- If at least one candidate passes style-fit threshold, reject lower-fit candidates.
- If none pass threshold, degrade gracefully to best available and log fallback reason.

No hard 422 solely for style mismatch (unless explicitly requested in future strict mode).

## 6) Observability / Debugging

Add logs:
- `[ai-look][single][step-1][user-directives]` with extracted directives.
- `[ai-look][single][step-2][style-fit]` per candidate (score + reasons).
- Include `styleDirectiveFit` in `ruleTrace` and final-output payload.
- Log fallback decisions:
  - `style-threshold-relaxed`,
  - `no-style-compatible-candidate`.

All logs remain behind existing debug controls where appropriate.

## 7) Data Contracts & Compatibility

No client breaking changes required for initial rollout.

Optional response augmentation (non-breaking):
- Add `userDirectives` summary block to `/api/ai-look` response for debug UI display.

No database migration required for v1 of this feature.

## 8) Implementation Plan

1. Add dictionaries and normalization utilities.
2. Add deterministic directive extraction from raw user prompt.
3. Merge directives with existing derived profile into a `step2DirectiveProfile`.
4. Inject directive profile JSON into Step 2 prompt.
5. Add deterministic style-directive scoring and rerank penalties.
6. Add candidate style-threshold filtering with graceful fallback.
7. Extend logs and ruleTrace payloads.
8. Validate with TypeScript + manual debug scenarios.

## 9) Acceptance Criteria

For prompts like:
- “Amekaji look for a morning city walk”
- “Ivy style inspired by Derek Guy”
- “Urban casual inspired by Albert Muzquiz”

Expected:
1. Logs show non-empty extracted directives.
2. Step 2 candidate scoring includes visible style-fit scores.
3. Final selected look shows higher style alignment than current baseline.
4. No regression in hard context/safety constraints.
5. Weather/rain gates continue to work as implemented.

## 10) Risks & Mitigations

Risk: Over-constraining style reduces feasible candidates.  
Mitigation: soft threshold with graceful fallback + explicit fallback logs.

Risk: Alias dictionary drift / incomplete coverage.  
Mitigation: centralized dictionary file + periodic curation from feedback logs.

Risk: Conflicts between icon bias and context safety.  
Mitigation: hard constraints remain highest priority; directives are subordinate to safety/context.

## 11) Future Extensions (Not in this spec)

- User-level preference learning (weighting directives from thumbs-up history).
- Admin-editable style/icon dictionary via UI + DB.
- “Strict style mode” query option for advanced users.

