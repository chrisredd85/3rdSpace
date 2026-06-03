## Summary

Assessment-only PR for `refactor/recommend-route-extraction`.

The original branch cleanly cherry-picks onto current `main`, but it is not a clean mechanical refactor. Type-check exposed that the branch includes discovery-venue behavior (`catalog_source`, `discovery_venues`, discovery/onboarded splitting) that current `main` does not have in the recommend route.

## Recommendation

Do not port `693957a` directly.

Rewrite the recommend-route extraction from current `origin/main` so the PR contains only mechanical extraction and does not introduce discovery/supply-scout behavior out of sequence.

## Validation

- Original commit inspected: `693957a refactor: extract planner recommend route`
- Cherry-pick attempted on fresh `origin/main` worktree
- Focused extracted tests passed: `lib/planner/recommend/__tests__/recommendServices.test.ts`
- `npm run type-check` failed on `catalog_source` fields introduced by the branch
- Assessment written instead of pushing mixed behavior code

## Scope

Markdown-only. No application code changes.
