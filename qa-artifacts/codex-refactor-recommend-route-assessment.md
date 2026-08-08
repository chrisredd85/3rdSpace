# refactor/recommend-route-extraction Applicability Assessment

## Original Intent

Branch `refactor/recommend-route-extraction` contains one commit:

- `693957a refactor: extract planner recommend route`

It attempts to turn the monolithic route at
`app/api/planner/plans/[planId]/recommend/route.ts` into a thin route wrapper
around modules under `lib/planner/recommend/`, including:

- `handler.ts`
- `loadContext.ts`
- `matchVenues.ts`
- `matchVendors.ts`
- `computeEconomics.ts`
- `persist.ts`
- `fallback.ts`
- `audit.ts`
- `utils.ts`
- `types.ts`
- `__tests__/recommendServices.test.ts`

That refactor is directionally useful: the current route is still large enough
that extracting cohesive planner-recommend services would improve reviewability.

## What Happened On Current Main

The commit cherry-picked cleanly onto `origin/main` after PR #29, but it was not
behaviorally clean.

Validation found:

```text
npm run type-check
lib/planner/recommend/matchVenues.ts(482,15): error TS2339: Property 'catalog_source' does not exist ...
lib/planner/recommend/matchVenues.ts(515,32): error TS2339: Property 'catalog_source' does not exist ...
lib/planner/recommend/matchVenues.ts(545,78): error TS2339: Property 'catalog_source' does not exist ...
lib/planner/recommend/matchVenues.ts(846,39): error TS2339: Property 'catalog_source' does not exist ...
lib/planner/recommend/matchVenues.ts(847,66): error TS2339: Property 'catalog_source' does not exist ...
lib/planner/recommend/persist.ts(580,55): error TS2339: Property 'catalog_source' does not exist ...
```

The immediate type error could be fixed by widening
`venueMatchingCandidateSchema`, but that would hide the real issue: the branch
is carrying discovery-venue behavior that is not present in current `main`'s
recommend route.

Examples from the cherry-picked tree:

- `discovery_venues` queries
- `catalog_source: 'discovery'`
- discovery/onboarded venue ID splitting
- discovery venue contact handling in outreach approval metadata

Current `origin/main`'s recommend route does not reference `discovery_venues` or
`catalog_source`. The source branch handoff says discovery changes were dropped,
but the code still contains them.

## Why This No Longer Cleanly Applies

This is not just an import-path or type-only conflict. The branch mixes two
changes:

1. A mechanical route extraction
2. Discovery/supply-scout recommendation behavior

Those should not be reviewed together. Pulling the discovery behavior into a
"mechanical extraction" PR would expand the behavioral surface area and bypass
the phase-5 outreach/discovery sequencing.

## Recommendation

Defer this branch as-is.

The extraction is still valuable, but it should be rewritten from current
`origin/main` rather than cherry-picked from `refactor/recommend-route-extraction`.
The fresh refactor should:

- extract only code that exists in current `main`
- preserve the current recommend route behavior byte-for-byte where practical
- exclude discovery/supply-scout behavior until the relevant outreach/discovery
  PR is explicitly in scope
- keep approval-gated outreach logic unchanged
- include focused tests for extracted pure helpers

## Disposition

Recommendation: **rewrite, do not port this commit directly**.

No production code changes are included in this assessment PR.
