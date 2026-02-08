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
3. From garment detail (`/garments/[id]`), use the `Edit` action card to open owner-only edit mode for that specific garment (`/editor?garmentId=<id>`).
4. Add new garments via `/add-garment` (owner-only), including image upload.
5. View distribution analytics in `/stats`.
6. Generate a single AI outfit recommendation via `/ai-look` (owner-only) using free-text prompt input.
7. Navigation intentionally does not expose `/editor` as a primary tab; edit is context-driven from garment details.

## Rendering strategy
1. Server components (`app/(main)/*`) handle initial auth checks and data loading.
2. Client components (`components/client/*` and interactive feature components) manage filters, dialogs, local form state, toasts, and URL state.
3. Server actions (`actions/garment.ts`) own write operations, authorization checks, redirects, and cache invalidation.
4. Editor pages (`/editor`, `/add-garment`) preload wardrobe/schema/editor-options server-side and render `EditorForm` inside `Suspense` with a layout-matching skeleton fallback to avoid empty-state flash and layout shift.
5. AI look page (`/ai-look`) is route-guarded server-side and renders a client recommender UI that calls an owner-protected API route (`/api/ai-look`) using Vercel AI SDK + OpenAI.
6. `/api/ai-look` uses a two-step agent flow: (a) free-text intent normalization into canonical wardrobe vocab, then (b) look generation constrained to wardrobe IDs, plus deterministic match scoring blended with model confidence.
7. AI look generation optionally enriches free-text prompts with live weather context (location extracted from user text -> geocoded -> weather summary) before recommendation.

## AI Look Agent (2-Step Summary)
1. Step 1 (Interpretation): `/api/ai-look` maps free-text user input into canonical wardrobe intent (`weather`, `occasion`, `place`, `timeOfDay`, `formality`, `style`) using structured output.
2. Step 1 tool-calling: During interpretation, the model can invoke `getWeatherByLocation` (AI SDK tool) to fetch live weather from OpenWeather for location-aware prompts.
3. Step 2 (Recommendation): The model receives the interpreted canonical intent + wardrobe JSON and returns exactly one wardrobe-only look (`selectedGarmentIds` ordered top-to-bottom, rationale, model confidence).
4. Server-side validation and scoring: Returned IDs are validated against DB garments, rationale is sanitized (no IDs), and final confidence blends model confidence with deterministic match scoring.
5. UI exposure: `/ai-look` displays look title, lineup, rationale, and an optional details accordion (confidence breakdown, interpreted intent, and live weather status when available).

## Authorization strategy
- `EDITOR_OWNER_EMAIL` is the single source of truth for editor authorization.
- Route-level protection:
  - `/garments/[id]` (full detail and intercept modal) requires authenticated session; unauthenticated users are redirected to `/login`.
  - `/editor`, `/add-garment`, and `/ai-look` require authenticated owner session, otherwise redirect (`/login`) or `notFound()`.
  - `/editor` accepts optional query param `garmentId` to initialize the editor on a specific garment.
  - Garment details (`/garments/[id]`) only render the `Edit` action card in UI for owner sessions.
- Middleware-level protection:
  - `app/middleware.ts` applies auth gate on `/garments/*` (session required) and owner gate on `/editor/*` + `/ai-look/*` for defense-in-depth.
- API-level protection:
  - `/api/wardrobe`, `/api/editor-options`, `/api/upload`, and `/api/ai-look` require authenticated owner session (`403` on failure).
- Mutation-level protection:
  - `createGarment`, `updateGarment`, and `deleteGarment` enforce owner checks server-side regardless of UI access.
- Rule: UI guards are convenience; server-side guards are mandatory.

## Authentication hardening
- Magic-link delivery (`next-auth` email provider + Resend) includes async error handling and best-effort in-memory throttling:
  - short cooldown between repeated requests per identifier
  - max request count per rolling time window
- `AUTH_EMAIL_FROM` can be used to configure sender address; fallback is `onboarding@resend.dev`.

## Caching strategy: 
- Shared wardrobe reads are centralized in `lib/wardrobe.ts` via `getWardrobeData()`.
- In production, wardrobe reads use `unstable_cache` tagged as `garments`.
- In local development (`NODE_ENV=development`), wardrobe reads bypass cache and query the DB directly.
- Mutations in `actions/garment.ts` (`createGarment`, `updateGarment`, `deleteGarment`) call `revalidateTag('garments')` for event-driven invalidation.
- Editor flows always request fresh data (`/api/wardrobe?fresh=1` with `cache: 'no-store'`) to avoid stale edit state.
- Viewer (`/viewer`) and stats (`/stats`) load wardrobe data through `getWardrobeData()` server-side.

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


# 3. IMPORTANT: Self-Improvement

- Build a markdown file (@AGENT_NOTES.md) where you log what goes right, what goes wrong, what I corrected, what worked and what didn't. It's kind of scratchpad to take notes on yourself during every session.
- Check these evolving notes in @AGENT_NOTES.md as an input of your implementation.
