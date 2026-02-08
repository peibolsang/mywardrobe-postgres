# Agent Self-Improvement Notes

## IMPORTANT
- Any architecture or data-model change implemented in code MUST be reflected in `AGENTS.md` in the same session.
- Any authentication/authorization change implemented in code MUST be reflected in `AGENTS.md` in the same session.

## 2026-02-08
- Context: User reported Vercel showing newer wardrobe data while local showed older data.
- What went right: Quickly verified read-path cache (`unstable_cache`) and write-path invalidation (`revalidateTag('garments')`) in code.
- What went wrong: Initial read attempt for route-group paths failed because shell globbed unquoted parentheses.
- Correction applied: Quoted paths like `app/(main)/viewer/page.tsx` when inspecting files.
- Working hypothesis that matched code: Local and Vercel have separate Next.js data caches; both can point to the same DB but still return different cached snapshots.
- Reminder for future sessions: When data differs by environment, inspect cache scope before assuming DB mismatch.
- Additional correction: Making route handler `GET` accept an optional request broke Next's generated route types; fixed by moving wardrobe reads into `lib/wardrobe.ts` and calling that from both pages and API routes.
- New defect pattern: Free-text lookup values (materials) were silently discarded when not present in the lookup table because actions only selected existing IDs. Fix was to upsert missing lookup rows first, then resolve IDs.
- UI implementation note: For custom dropdown/combobox controls in forms, add hidden inputs for non-native fields (for example `type`) so `FormData` includes the selected value on submit.
- Data model migration note: For gradual normalization (`garments.type` -> `garments.type_id`), execute SQL in two phases: create/backfill first, deploy app code second, then enforce `NOT NULL` and drop legacy column.
- Repeatable pattern: If a field is lookup-backed and UI allows creating new values (for example materials/colors), server actions must upsert missing lookup rows before inserting junction rows.
- Security lesson: Protect editor/admin behavior at three layers, not one:
  1) route-level guards,
  2) API endpoint guards,
  3) server-action/mutation guards.
- Consistency lesson: If write logic touches multiple tables (main row + junction tables), always use a DB transaction; delete+insert patterns without a transaction can silently corrupt state on partial failure.
- Form serialization lesson: Never serialize arbitrary user-entered array values with comma-join. Use JSON array serialization and parse on the server.
- UX reliability lesson: `useFormStatus()` alone is not reliable when using custom `onSubmit` with `preventDefault`; wire explicit pending state from transitions/uploads into submit controls.
- Validation lesson: Validation helpers are useless unless invoked in submit flow; ensure `validateForm` (or equivalent) runs before action dispatch.
- Field-removal lesson: Removing a domain field must be done end-to-end (types, queries, server actions, form schema, UI rendering, docs, and DB migration), not only hidden from UI.
- Vocabulary governance lesson: For each controlled-value field, explicitly document whether it is DB-driven or schema-driven, and keep UI/server behavior aligned with that source of truth.
- Product insight note: The current `/stats` view only charts garment type share, but existing garment fields already support richer analytics (coverage by weather/occasion/time/place, material-weighted composition, favorites bias, and combinational gaps). Suggest prioritizing "decision-support" stats over static distribution charts.
- Implementation note: Upgraded `/stats` v1 from a single pie chart to server-computed decision analytics (coverage/gap alerts, occasion x weather readiness matrix, and favorites-vs-total distribution deltas) using existing garment fields and schema enums.
- Tooling note: `npm run lint` currently triggers Next.js interactive ESLint setup prompt in this repo (non-CI safe); use `npx tsc --noEmit` as a temporary non-interactive safety check until ESLint config is committed.
- UX correction note: Preserve an at-a-glance garment type percentage view even when adding deeper analytics, and attach short explanatory tooltips to each stats section to reduce interpretation friction.
- Product prioritization note: If users find behavior-based comparisons confusing, replace with materially grounded metrics (for example material-weighted composition) that are simpler to interpret and directly tied to source data quality.
