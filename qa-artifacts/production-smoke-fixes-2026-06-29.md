# Production Smoke Fixes — 2026-06-29

Branch: `codex/production-smoke-fixes`  
Base: clean `origin/main` at `e31c2dd`

## Issue 1 — Planner venue catalog 500

### Production evidence

Command:

```bash
curl -s -o /tmp/venues-smoke.json -w "%{http_code}\n" "https://www.3rdplace.io/api/venues?planner_catalog=1"
```

Observed before fix:

```json
500
{"error":"Failed to fetch venues","details":"column venues.per_head_chi_cents does not exist"}
```

### Root cause

`/api/venues` already had a schema-drift fallback for older hosted Supabase schemas, but the missing production column `per_head_chi_cents` was not included in the schema-drift detector. The legacy fallback select also still included `per_head_chi_cents`, so even a detected fallback would keep querying the missing column.

### Fix

- Added `per_head_chi_cents`, `bar_consumption_share_*`, and `sponsor_consumption_share_*` to the public catalog optional-column drift detector.
- Removed `per_head_chi_cents` from `VENUE_LEGACY_SELECT_COLUMNS`; the adapter already defaults the value to `0` when absent.
- Added a route regression test proving the public catalog falls back when `per_head_chi_cents` is missing.

### Files

- `app/api/venues/route.ts`
- `lib/venues/venue-adapter.ts`
- `__tests__/integration/venues-public-catalog-route.test.ts`

## Issue 2 — Planner messages route 500 and misleading empty state

### Root cause

`/planner/messages` is still a current planner sidebar surface. Its route reads legacy vendor messaging tables/relations. If hosted Supabase lacks those tables or relation metadata, the route returned `500`. The page then ignored the React Query error shape and could render an empty-state experience that looked like “No conversations” instead of “messages failed to load.”

### Fix

- Kept `/api/messages/threads` as a current route.
- Added a narrow schema-unavailable fallback for missing/stale legacy message store errors, returning `{ threads: [] }` with status `200`.
- Preserved `500` for unexpected database errors.
- Updated `/planner/messages` to show “Messages temporarily unavailable” when the hook has a real error.
- Added route regression coverage for schema-unavailable fallback and unexpected-error behavior.

### Files

- `app/api/messages/threads/route.ts`
- `app/(planner)/planner/messages/page.tsx`
- `__tests__/integration/messages-threads-route.test.ts`

## Issue 3 — Free-event billing display inconsistency

### Product decision

Billing enforcement should keep using the raw counters because they represent lifetime planner usage and access-control state. The UI should not display impossible free-trial progress like `20 of 2 used`.

### Fix

- Added a display-only free-event usage helper.
- Capped displayed free-trial usage to the granted trial amount.
- Derived displayed remaining count from the capped value, so inconsistent raw payloads cannot show both “2 free events remaining” and “20 of 2 used.”
- Applied the helper to the billing page and planner billing banner.
- Added regression tests for impossible counter payloads.

### Files

- `lib/billing/display.ts`
- `lib/billing/__tests__/billing-display.test.ts`
- `app/(planner)/planner/billing/page.tsx`
- `components/planner/PlannerBillingAccessBanner.tsx`
- `components/planner/__tests__/PlannerBillingAccessBanner.test.tsx`

## Verification

Focused tests:

```bash
PATH="/Users/chrisredd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
./node_modules/.bin/jest \
  __tests__/integration/venues-public-catalog-route.test.ts \
  __tests__/integration/messages-threads-route.test.ts \
  lib/billing/__tests__/billing-display.test.ts \
  components/planner/__tests__/PlannerBillingAccessBanner.test.tsx \
  --runInBand
```

Result:

```text
Test Suites: 4 passed, 4 total
Tests: 9 passed, 9 total
```

Type-check:

```bash
PATH="/Users/chrisredd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run type-check -- --pretty false
```

Result: passed.

Lint:

```bash
PATH="/Users/chrisredd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run lint
```

Result: passed with existing unrelated React hook dependency warnings.

Build:

```bash
PATH="/Users/chrisredd/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" npm run build
```

Result: compile succeeded, then local page-data collection failed because the clean worktree did not have Supabase environment variables:

```text
Error: Missing Supabase environment variables
Failed to collect page data for /api/admin/catalog/venues
```

No build failure was traced to the files changed in this branch.

## Notes

- No database schema changes.
- No approval-gated execution behavior changed.
- `npm ci --ignore-scripts` was used in the clean worktree to restore the repo's package-lock dependency topology after an initial pnpm install attempt hit pnpm's build-script approval guard.
