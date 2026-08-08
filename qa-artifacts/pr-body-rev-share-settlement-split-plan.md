## Summary

Markdown-only split plan for `codex/rev-share-settlement-schema`.

The source branch should not be cherry-picked. Current `main` already carries
the settlement schema foundation in
`supabase/migrations/20260527000002_kickback_settlement.sql`, while the branch's
remaining unique assets are extraction fixtures that are not wired into tests.

## Findings

- Source commits inspected:
  - `15c5f2a` schema migration
  - `744b4e4` QA report
  - `1be2ed8` extraction fixtures
- The source migration is superseded by current main and should not be reintroduced.
- Branch-local `QA_REPORT.md` and `RECONCILIATION.md` are historical, not
  merge-ready docs.
- The extraction fixture pack may be useful later, but the branch only documents
  those files in its fixture README; no tests consume them yet.
- Some fixture filenames overlap current main, so any future fixture PR should
  compare before overwriting.

## Recommendation

Do not port this branch directly. Use future focused PRs instead:

1. Fixture/eval PR for useful extraction assets, with tests that consume them.
2. Runtime settlement PRs from current main for document extraction, upload
   routes, invoice settlement, refunds, compliance gating, and payments ledger
   UI.
3. New forward migrations only if current main still lacks a required schema
   field.

## Validation

- Markdown-only PR.
- Commit went through the normal Husky pre-commit hook.
