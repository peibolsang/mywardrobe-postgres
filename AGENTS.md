# 1.Repository Guidelines

## Project Structure & Module Organization
Next.js 15 + TypeScript app using the App Router.

- `app/`: routes, layouts, API endpoints (`route.ts`), and route groups.
- `components/`: reusable UI and feature components.
- `components/ui/`: base UI primitives (Radix/shadcn-style building blocks).
- `components/client/`: client-only interactive components.
- `actions/`: server actions (garment create/update flows).
- `lib/`: shared utilities, auth setup, DB access, and shared types.
- `public/`: static assets and JSON schema files.

## Build, Test, and Development Commands
- `npm run dev`: run local server with Turbopack (`http://localhost:3000`).
- `npm run start`: start the production server.
- `npm run lint`: run Next.js ESLint checks.

Use `npm run lint` before opening a PR.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict` mode enabled in `tsconfig.json`).
- Indentation: 2 spaces; keep code formatted consistently with surrounding files.
- Components: `PascalCase` exports; filenames are typically kebab-case (for example, `garment-modal-client.tsx`).
- Next.js route files must keep framework names: `page.tsx`, `layout.tsx`, `route.ts`.
- Prefer `@/` imports for internal modules.

## Testing Guidelines
No automated test suite yet. For each change:

1. Run `npm run lint`.
3. Manually verify affected flows (viewer, editor permissions, login, garment detail page/modal).

If adding tests, use `*.test.ts` / `*.test.tsx` and keep them near the feature or in `__tests__/`.

## Commit & Pull Request Guidelines
Use imperative commit subjects.

- Keep commits scoped to one change.
- PRs should include summary, affected routes/components, env/schema changes, and manual verification steps.
- Add screenshots or GIFs for UI updates and link related issues.

## Security & Configuration Tips
- Keep secrets in `.env.development.local`; never commit credentials.
- Required env vars used in code include: `DATABASE_URL`, `EDITOR_OWNER_EMAIL`, `AUTH_SECRET`, and `AUTH_RESEND_KEY`.
- Owner-only capabilities are enforced server-side. Use `lib/owner.ts` (`isOwnerSession`) for any new editor/admin route, API endpoint, or mutation.

# 2.Application Architecture

## Technology stack
- Next.js 15 App Router, React 19, TypeScript (`strict`), Tailwind CSS v4, NextAuth v5 email login, and PostgreSQL access through Neon serverless driver.

## Common user workflows
1. Sign in with magic link (`/login`).
2. Browse and filter wardrobe (`/viewer`), open modal or full garment detail.
3. From garment detail (`/garments/[id]`), use the `Edit` action card to open owner-only edit mode for that specific garment (`/editor?garmentId=<id>`); after saving changes, the user is redirected back to the same garment detail read-only view and shown a success toast.
4. Add new garments via `/add-garment` (owner-only), including image upload.
5. View distribution analytics in `/stats`.
6. Configure profile settings in `/profile` (owner-only), including `Default Location`, favorite style selections, and saved menswear references used by AI Look tooling/directive flows.
7. Generate AI recommendations via `/ai-look` (owner-only): either a single free-text look or a multi-day "Pack for Travel" plan (destination + date range + reason).
   - From garment details (owner view), `Cmd/Ctrl+K` opens garment actions including `Generate look around this garment`, which routes to `/ai-look?anchorGarmentId=<id>&anchorMode=strict`.
8. Navigation intentionally does not expose `/editor` as a primary tab; edit is context-driven from garment details.

## Rendering strategy
1. Server components (`app/(main)/*`) handle initial auth checks and data loading.
2. Client components (`components/client/*` and interactive feature components) manage filters, dialogs, local form state, toasts, and URL state.
3. Server actions (`actions/garment.ts`) own write operations, authorization checks, redirects, and cache invalidation.
4. Editor pages (`/editor`, `/add-garment`) preload wardrobe/schema/editor-options server-side and render `EditorForm` inside `Suspense` with a layout-matching skeleton fallback to avoid empty-state flash and layout shift.
5. Profile page (`/profile`) is route-guarded server-side (owner-only), hydrates owner defaults + style preferences + saved references, and persists via `/api/profile`, `/api/profile/styles`, and `/api/profile/references`.
6. AI look page (`/ai-look`) is route-guarded server-side and renders a client UI with two tabs: (a) free-text single-look generation and (b) "Pack for Travel" planning.
   - Single-look prompt includes an `Add Tool` control that lets the user attach explicit `Style` and `Reference` selections as removable chips per request.
7. `/api/ai-look` supports two modes: default single-look mode and `mode: "travel"` for per-day trip planning.
8. Single-look mode uses a two-step agent flow: (a) free-text intent normalization into canonical wardrobe vocab, then (b) multi-candidate look generation constrained to wardrobe IDs, followed by server-side validation, normalization, reranking, and one final look selection.
   - Step 1 is context-first (`weather`, `occasion`, `place`, `timeOfDay`, `notes`); server deterministically derives `formality`, `style`, and material targets from context + structured weather profile before Step 2.
   - Step 2 receives deterministic `weatherProfile` + `derivedProfile` scaffolding; final selection enforces category-aware hard constraints with explicit priority (`weather > occasion/place > time > style`).
9. Travel mode geocodes destination and enriches each trip day with forecast weather when available; if exact day forecast is unavailable, it falls back to LLM-estimated monthly climate for the destination, then to deterministic seasonal inference only if the LLM fallback fails.
10. Travel generation follows a two-step pattern per day: (a) interpret structured day context into canonical intent, then (b) generate one wardrobe-only look using a scored candidate subset of eligible garments (category quotas + novelty weighting) plus strict day constraints.
11. AI Look UI captures recommendation feedback (thumbs up/down + optional reason) and persists it via owner-only API for rule tuning.

## AI Look Agent (Mode Summary)
1. Single-look interpretation: `/api/ai-look` maps free-text input into canonical wardrobe intent (`weather`, `occasion`, `place`, `timeOfDay`, `formality`, `style`) via structured output; the model can tool-call `getWeatherByLocation` for live weather context.
   - Single-look weather location resolution priority is `prompt location > profile default location > no-location fallback`; prompt date parsing is intentionally not used in single-look mode.
   - Single-look request payload now optionally accepts `selectedTools` (`[{ type: "style" | "reference", id: string }]`) from the AI Look `Add Tool` UI.
   - Directive merge precedence is deterministic: hard safety/context constraints first, then tool-selected directives, then free-text directives, then derived-profile fallback.
  - Style directives are sourced from DB-backed style catalog records (aliases + directive payload) rather than hardcoded runtime dictionaries.
  - Reference directives are sourced from DB-backed profile reference records (aliases + directive payload) rather than hardcoded runtime dictionaries.
2. Single-look recommendation: Step 2 attempts up to six candidates and degrades gracefully when fewer valid candidates are returned. Candidates are wardrobe-ID-only, validated against DB IDs, normalized to exactly four pieces (`outerwear + top + bottom + footwear`), deduplicated by signature, and reranked with objective fit + model confidence + recency/overlap controls.
   - Single mode computes a structured deterministic weather profile (`tempBand`, `precipitation`, `wind`, `humidity`, `wetSurfaceRisk`, `confidence`) and a deterministic derived profile (`formality`, `style`, material targets).
   - Category-aware deterministic hard rules enforce weather and occasion/place compatibility per garment; wet-surface/material conflicts (especially outerwear/footwear) are hard-blocked.
   - Single mode optionally accepts `anchorGarmentId` + `anchorMode` (`strict` or `soft`) to generate a look around a specific garment. Strict mode requires the anchor in the final lineup and returns 422 if impossible.
   - Final output returns exactly one look in single mode (`primaryLook`).
   - Single mode stores recent lineup signatures in DB table `ai_look_lineup_history`, applies hard no-repeat/no-high-overlap filtering when alternatives exist, and falls back to repeated signatures only when no viable alternative survives.
   - `ai_look_lineup_history` is provisioned via explicit SQL migration script `scripts/sql/create-ai-look-lineup-history.sql` (no runtime auto-create).
   - Final single-look rationale text is generated server-side from normalized lineup + canonical intent/weather context so rationale cannot drift from selected garments.
   - Single response includes additive diagnostics: `requestFingerprint`, `weatherProfile`, and `derivedProfile`.
   - Reranking now also applies lightweight feedback signals from recent downvotes in `ai_look_feedback` (signature/garment penalties + reason-keyword signals for rain/material/formality/style/time mismatches) to reduce repeated failure patterns.
3. Travel planning (`mode: "travel"`): Inputs are `destination`, `startDate`, `endDate`, and `reason` (`Vacation`, `Office`, `Customer visit`).
4. Travel weather enrichment: Each day in range attempts OpenWeather forecast; if unavailable, fallback uses LLM monthly climate estimation for the destination/month (average temperatures + likely conditions), with deterministic month/hemisphere fallback only if LLM climate estimation fails.
5. Travel recommendation: One look is generated per day with strict completeness (outerwear/jacket-or-coat + top + bottom + footwear), exactly one outerwear piece for the entire trip (departure, stay days, and return), max one footwear pair across stay days (commute days exempt), commute-day garment reservation (travel-day garments cannot be reused on in-between stay days, except the locked single outerwear which must be reused trip-wide), hard per-day place/occasion constraints (travel days require airport/commute tags; office stay days require office-compatible places plus `Casual Social`/`Date Night / Intimate Dinner`/`Outdoor Social / Garden Party` occasions; customer-visit days require office/business tags; vacation days require city/active tags with beach enabled only when destination signals beach and weather is warm), anti-repeat controls (recent-look history prompt + deterministic duplicate/overlap rejection + lineup diversification), and a server-side max travel span of 21 days to cap AI/tool amplification. Days that cannot be satisfied are returned in `skippedDays` instead of failing the full response.
   - Travel mode now also uses persistence-backed cross-request diversity scoped by travel fingerprint (`destination + reason + startDate + endDate`) via table `ai_look_travel_day_history`; repeated day signatures are hard-avoided when alternatives exist and allowed only as graceful fallback.
   - `ai_look_travel_day_history` is provisioned via explicit SQL migration script `scripts/sql/create-ai-look-travel-day-history.sql` (no runtime auto-create).
   - Travel day rationale text is also generated server-side as concise intent-focused text from each finalized day lineup + interpreted day intent/weather, preventing post-normalization rationale drift.
6. UI exposure: `/ai-look` shows both tabbed modes; single-look mode renders one selected look card, while travel output is rendered as per-day cards with skipped-day diagnostics.
   - Single and travel cards expose thumbs up/down feedback controls; downvotes allow reason text and submit to `/api/ai-look/feedback`.
   - AI look APIs include per-request `requestId` in JSON responses for log correlation.
   - Optional debug observability is controlled with `AI_LOOK_DEBUG=1`, which enables verbose structured AI-look logs.

## Authorization strategy
- `EDITOR_OWNER_EMAIL` is the single source of truth for editor authorization.
- Route-level protection:
  - `/garments/[id]` (full detail and intercept modal) requires authenticated session; unauthenticated users are redirected to `/login`.
  - `/editor`, `/add-garment`, `/ai-look`, and `/profile` require authenticated owner session, otherwise redirect (`/login`) or `notFound()`.
  - `/editor` accepts optional query param `garmentId` to initialize the editor on a specific garment.
  - Garment details (`/garments/[id]`) only render the `Edit` action card in UI for owner sessions.
- Middleware-level protection:
  - `app/middleware.ts` applies auth gate on `/garments/*` (session required) and owner gate on `/editor/*` + `/ai-look/*` + `/profile/*` for defense-in-depth.
- API-level protection:
  - `/api/wardrobe`, `/api/editor-options`, `/api/upload`, and `/api/ai-look` require authenticated owner session (`403` on failure).
  - `/api/profile`, `/api/profile/styles`, `/api/profile/references`, `/api/profile/references/load`, and `/api/profile/references/catalog` require authenticated owner session (`403` on failure).
  - `/api/ai-look/feedback` also requires authenticated owner session (`403` on failure).
- Mutation-level protection:
  - `createGarment`, `updateGarment`, and `deleteGarment` enforce owner checks server-side regardless of UI access.
- Rule: UI guards are convenience; server-side guards are mandatory.

## Authentication hardening
- Magic-link delivery (`next-auth` email provider + Resend) includes async error handling and best-effort in-memory throttling:
  - short cooldown between repeated requests per identifier
  - max request count per rolling time window
- `AUTH_EMAIL_FROM` can be used to configure sender address; fallback is `onboarding@resend.dev`.
- AI recommendation API hardening (`/api/ai-look`) includes same-origin POST validation and owner-scoped persistent DB-backed rate limiting (minute + hour windows) with in-memory fallback only if the DB limiter is unavailable, to reduce abuse risk and OpenAI cost exposure.

## Caching strategy: 
- Shared wardrobe reads are centralized in `lib/wardrobe.ts` via `getWardrobeData()`.
- In production, shared wardrobe reads use `unstable_cache` tagged as `garments` with a 5-minute TTL (`revalidate: 300`) to self-heal from out-of-band DB updates.
- In local development (`NODE_ENV=development`), wardrobe reads bypass cache and query the DB directly.
- Mutations in `actions/garment.ts` (`createGarment`, `updateGarment`, `deleteGarment`) call `revalidateTag('garments')` for event-driven invalidation.
- Editor flows always request fresh data (`/api/wardrobe?fresh=1` with `cache: 'no-store'`) to avoid stale edit state.
- Viewer (`/viewer`) loads wardrobe data through shared `getWardrobeData()` server-side cache.
- Stats (`/stats`) forces a fresh DB read (`getWardrobeData({ forceFresh: true })`) and is configured as dynamic for accuracy-sensitive analytics.

## Vercel Postgres + Neon integration: 
- code uses `DATABASE_URL` with `@neondatabase/serverless` (`lib/db.ts`, API routes, and actions). Auth persistence uses `Pool` + `@auth/neon-adapter` in `lib/auth.config.ts`

## Primary third-party libraries: 
- `next-auth`
- `@neondatabase/serverless`
- `@auth/neon-adapter`
- `@vercel/blob`
- `resend`
- Radix UI primitives
- `recharts`
- `ai` (Vercel AI SDK)
- `@ai-sdk/openai`
- `zod`
- `sonner`
- `lucide-react`
- `react-icons`

##  Forms and form actions
- `components/editor-form.tsx` uses controlled inputs and `useActionState` with `createGarment`/`updateGarment`.
- `EditorForm` accepts optional server-preloaded initial props (`initialWardrobeData`, `initialSchemaData`, `initialEditorOptions`) so it can hydrate without client-side fetch flicker.
- Non-native controls (comboboxes/multi-selects) are submitted via hidden fields in `FormData`.
- Array fields (`colors`, suitability arrays) are serialized as JSON strings (not comma-joined text) to preserve values safely.
- Server actions parse JSON array fields with backward-compatible fallback for legacy comma-joined payloads.
- `createGarment` and `updateGarment` persist core row + junction-table writes in a single DB transaction to avoid partial updates.
- Material composition accepts flexible values (no strict sum=100 enforcement), but at least one valid material entry (`material` + `percentage > 0`) is required.
- Source of truth for selectable vocabularies:
  - DB-driven: `type`, `material`, `color` (lookup tables + editor options API + user-creatable upsert flow).
  - Schema-driven (`public/schema.json` enums): `suitable_places`, `suitable_occasions`, `suitable_weather`, `suitable_time_of_day`, `style`, `formality`.
  - Current place label for home context is `Home / WFH` (replacing legacy `Hospitality (Indoor)`).

## Database Entity-Relationship Model

### Main Table: `garments`

| Column            | Type               | Constraints                    |
| ----------------- | ------------------ | ------------------------------ |
| `id`              | `INTEGER`          | `PRIMARY KEY`                  |
| `file_name`       | `TEXT` / `VARCHAR` | `NOT NULL`                     |
| `model`           | `TEXT`             | `NOT NULL`                     |
| `brand`           | `TEXT`             | `NOT NULL`                     |
| `type_id`         | `INTEGER`          | `REFERENCES types(id)`         |
| `features`        | `TEXT`             | `NOT NULL`                     |
| `favorite`        | `BOOLEAN`          | `NOT NULL`                     |
| `style_id`        | `INTEGER`          | `REFERENCES styles(id)`        |
| `formality_id`    | `INTEGER`          | `REFERENCES formalities(id)`   |


### Lookup Tables (Dimension Tables)

Each of the following tables contains an `id` and a `name` column, and is referenced by either `garments` or junction tables:

* `styles`
* `formalities`
* `types`
* `materials`
* `colors`
* `suitable_weathers`
* `suitable_times_of_day`
* `suitable_places`
* `suitable_occasions`

**Structure:**

| Column | Type      | Constraints          |
| ------ | --------- | -------------------- |
| `id`   | `INTEGER` | `PRIMARY KEY`        |
| `name` | `TEXT`    | `UNIQUE`, `NOT NULL` |


### Junction Tables (Many-to-Many)

These associate `garments` with multiple values from lookup tables.

#### Example: `garment_material_composition`

| Column        | Type      | Constraints                                       |
| ------------- | --------- | ------------------------------------------------- |
| `garment_id`  | `INTEGER` | `REFERENCES garments(id)`, part of `PRIMARY KEY`  |
| `material_id` | `INTEGER` | `REFERENCES materials(id)`, part of `PRIMARY KEY` |
| `percentage`  | `INTEGER` | `NOT NULL`                                        |

### Other Junction Tables:

These follow the same pattern (without `percentage`):

* `garment_color`
* `garment_suitable_weather`
* `garment_suitable_time_of_day`
* `garment_suitable_place`
* `garment_suitable_occasion`

Each includes:

| Column       | Type      | Constraints               |
| ------------ | --------- | ------------------------- |
| `garment_id` | `INTEGER` | `REFERENCES garments(id)` |
| `<*_id>`     | `INTEGER` | `REFERENCES <table>(id)`  |

Most likely with a **composite primary key** on `(garment_id, *_id)`.


### Summary of Relationships

* `garments` has foreign keys to:

  * `types`
  * `styles`
  * `formalities`

* `garments` is linked via **many-to-many** junction tables to:

  * `materials` (with `percentage`)
  * `colors`
  * `suitable_weathers`
  * `suitable_times_of_day`
  * `suitable_places`
  * `suitable_occasions`

### Profile Table

* `user_profile`
  * owner-scoped defaults (`owner_key`, `default_location`, `created_at`, `updated_at`)
  * provisioned via explicit SQL migration script `scripts/sql/create-user-profile.sql`

### AI Memory Tables

* `ai_look_lineup_history`
  * single-look recency memory (`owner_key`, `mode`, `lineup_signature`, `garment_ids_json`, `created_at`)
* `ai_look_travel_day_history`
  * travel day recency memory (`owner_key`, `request_fingerprint`, `day_date`, `day_index`, `lineup_signature`, `garment_ids_json`, `created_at`)
* `ai_look_feedback`
  * recommendation feedback memory (`owner_key`, `mode`, `request_fingerprint`, `lineup_signature`, `garment_ids_json`, `vote`, `reason_text`, `weather_profile_json`, `derived_profile_json`, `created_at`)

### Profile Style Tables

* `style_catalog`
  * style tool catalog with stable keys and canonical mapping (`key`, `name`, `canonical_style`, `description`, `is_active`, timestamps)
* `style_catalog_alias`
  * free-text alias terms used for deterministic style matching (`style_catalog_id`, `alias_term`)
* `style_catalog_directive`
  * rich style directive payload (`canonical_style_tags_json`, `silhouette_bias_tags_json`, `material_prefer_json`, `material_avoid_json`, `formality_bias`)
* `user_profile_style`
  * owner-selected favorite styles used by `Add Tool > Style` (`owner_key`, `style_catalog_id`, `created_at`)

### Profile Reference Tables

* `user_profile_reference`
  * owner-scoped saved references (`owner_key`, `key`, `display_name`, `source_name`, `reference_payload_json`, `schema_version`, `is_active`, timestamps)
  * provisioned via explicit SQL migration script `scripts/sql/create-profile-reference-catalog.sql`
* `user_profile_reference_alias`
  * free-text alias terms used for deterministic reference matching (`reference_id`, `alias_term`)
* `user_profile_reference_directive`
  * rich reference directive payload (`style_bias_tags_json`, `silhouette_bias_tags_json`, `material_prefer_json`, `material_avoid_json`, `formality_bias`)


# 3. IMPORTANT: Self-Improvement

- Build a markdown file (@AGENT_NOTES.md) where you log what goes right, what goes wrong, what I corrected, what worked and what didn't. It's kind of scratchpad to take notes on yourself during every session.
- Check these evolving notes in @AGENT_NOTES.md as an input of your implementation.
