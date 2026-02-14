# Specs: Single-Mode Date-Aware Weather Resolution (Forecast + Monthly Climate Fallback)

## 1) Problem Summary

Single-look mode currently resolves weather as **current conditions** for detected location.  
Travel mode already supports a stronger stack:
- direct forecast when available,
- monthly climate fallback via model when forecast is unavailable,
- deterministic seasonal fallback if model climate fails.

This creates a gap for single prompts with future time references (for example: `tomorrow`, `this Friday`, `next week`):
- user intent is temporal,
- single mode may still behave like “now/current weather” or fail weather resolution,
- logs and rationale can be less aligned with user ask.

## 2) Goals

1. Bring travel-grade temporal weather fallback behavior into single mode.
2. Preserve current single-mode architecture (2-step recommendation flow + deterministic normalization/rerank).
3. Keep weather handling deterministic and auditable with structured logs.
4. Support date expressions in user prompts without changing API request schema.

## 3) Non-Goals

- Replacing Step 1 context interpretation model.
- Changing travel-mode API contracts.
- Introducing runtime DB table creation.
- Building a full natural-language calendar parser for every possible phrasing.

## 4) Current-State Analysis (Codebase)

Single mode (`app/api/ai-look/route.ts`) currently:
- extracts `locationHint` (`extractLocationHintFromPrompt`),
- tries tool weather call,
- retries forced tool call,
- falls back to direct current-weather fetch (`fetchWeatherContext`),
- if still unavailable, uses interpreted context/fallback profile.

Travel mode already has:
- `fetchTravelWeatherByDateRange(destination, dateRange)`,
- `fetchLlmClimateFallback(destination, dateIso)`,
- deterministic seasonal fallback per date when needed.

Conclusion: single mode lacks a **date-targeted weather resolver** and therefore does not consistently handle future-date asks like travel mode does.

## 5) Proposed Architecture

## 5.1 New Single Temporal Resolver Layer

Add a deterministic helper (single-mode only), e.g.:
- `resolveSingleModeTemporalWeather({ userPrompt, locationHint, nowUtc, userTz })`

Output:
- `targetType`: `"current" | "single_date" | "date_range" | "unknown"`
- `targetDate?: "YYYY-MM-DD"`
- `targetRange?: { startDate: string; endDate: string }`
- `weatherContext?: string`
- `weatherTags?: string[]`
- `weatherProfile?: WeatherProfile`
- `weatherStatus`: `"forecast" | "seasonal" | "failed" | "current"`
- `weatherSource`: `"direct_fetch" | "forecast_api" | "llm_climate_fallback" | "seasonal_fallback" | "none"`

## 5.2 Temporal Parsing Rules (Deterministic)

Implement a deterministic phrase parser for high-value patterns:
- `today`, `now` -> `current`
- `tomorrow` -> `single_date = now + 1`
- `this friday`, `next friday` (weekday references) -> resolved absolute date
- explicit date forms already parseable (`2026-03-05`, `March 5th 2026`)
- `next week` -> 7-day range (`date_range`)

If ambiguous, keep `targetType = "unknown"` and use current-weather behavior.

## 5.3 Weather Resolution Ladder (Single Mode)

When `locationHint` exists:

1. **Current target** (`today/now/unknown`):
   - keep existing single-mode flow (`fetchWeatherContext` + tool route).

2. **Future single date**:
   - call forecast path for that date (reuse travel utility behavior).
   - if forecast unavailable: call `fetchLlmClimateFallback(location, targetDate)`.
   - if climate fallback fails: use deterministic seasonal fallback.

3. **Date range (for single mode)**:
   - resolve each day with travel-style logic.
   - aggregate into one single weather profile using conservative policy:
     - temp band: coolest plausible band in range,
     - precipitation: highest observed level/type in range,
     - wet risk: max risk across days.
   - weather context summary explicitly states range and aggregation basis.

## 5.4 Canonical Intent Integration

For single mode, set canonical weather with precedence:
1. temporal resolver weather tags (date-aware),
2. tool/direct current weather tags,
3. interpreted context weather tags.

Keep existing deterministic derivation pipeline:
- context -> derived formality/style/material profile -> Step 2 prompt + rerank.

## 5.5 Rationale Alignment

When `targetType !== "current"`, rationale weather sentence should include resolved date/range context:
- example: “Weather for Friday, March 6, 2026 in Avilés, ES …”
- avoid “current weather” phrasing in future-date requests.

## 6) Observability / Debugging

Add/extend structured logs in single mode:
- `[ai-look][single][step-1][temporal-resolution]`
  - parsed temporal tokens,
  - target type/date/range,
  - absolute dates resolved.
- `[ai-look][single][step-1][weather-resolution]`
  - include `weatherStatus` + `weatherSource` + `targetDate/range`.
- include final weather metadata in `[ai-look][single][final-output]`.

## 7) API/Data Contract Impact

- No request-schema change required (`prompt` remains source of temporal intent).
- Response remains backward compatible; optional additive fields:
  - `weatherTargetType`,
  - `weatherTargetDate`,
  - `weatherTargetRange`,
  - `weatherContextStatus` refined for forecast/seasonal.

No DB migration required.

## 8) Implementation Plan

1. Add deterministic temporal intent parser utility for single prompts.
2. Add single-mode date-aware weather resolver reusing travel helpers.
3. Add range aggregation policy for `next week` style prompts.
4. Wire resolved weather into canonical single context before derived profile.
5. Update rationale weather phrasing for future target dates/ranges.
6. Add structured logs for temporal parsing + weather source/status.
7. Validate with TypeScript + manual debug scenarios.

## 9) Acceptance Criteria

For single mode prompts:

1. `"Weather tomorrow in Aviles and recommend a look"`  
   - weather target resolves to absolute date (for example, from February 14, 2026 -> February 15, 2026),
   - uses forecast if available, else climate fallback.

2. `"This Friday in Dublin, recommend an office look"`  
   - date is resolved explicitly,
   - rationale references Friday weather (not current weather).

3. `"Next week in Dublin, suggest a look"`  
   - range resolver activates,
   - aggregated weather profile is deterministic and logged.

4. If all weather sources fail:
   - deterministic seasonal fallback is used,
   - no contradictory “weather unavailable/current weather” messaging.

## 10) Risks & Mitigations

Risk: Ambiguous temporal phrases produce wrong dates.  
Mitigation: deterministic parser for supported patterns + fallback to current mode when uncertain + explicit logs with resolved absolute dates.

Risk: Over-conservative range aggregation over-weights rain/cold.  
Mitigation: define and document aggregation policy; tune with feedback logs.

Risk: Prompt/date drift between Step 1 notes and final rationale.  
Mitigation: keep weather context authoritative from resolver and strip contradictory notes as already done in canonical note cleanup.

## 11) Future Extensions (Not in this spec)

- User timezone preference persistence for temporal parsing.
- Optional prompt UI hint to encourage date specificity.
- Extending parser coverage to more natural-language date forms/locales.
