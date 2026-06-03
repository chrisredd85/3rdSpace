# Phase gamma backlog audit - 2026-06-03

## Summary

- 11 branches evaluable now, audited below.
- 5 branches deferred because they require phase-5 outreach core (PR 3c/3d) on `main` before a fair comparison.
- Recommended PRs now: `codex/signup-step-validation`, `codex/expand-vendor-catalog-seed`, `chore/qa-stabilization` after PR #21, then one route extraction at a time.
- Recommended deletes: `codex/money-flow-phase0`, `codex/fix-planner-empty-billing-modal`, `fix/signup-pricing-wiring`, `chore/monitoring-sentry`.
- Recommended splits/holds: `codex/rev-share-settlement-schema`, `codex/stripe-connect-webhook`.

Notes on method: several branches are old and raw `git diff origin/main..<branch>` output is noisy because the branch tips predate phase alpha / phase-5 merges. Classifications below rely on the requested log/stat/diff sampling plus direct commit payload inspection, `git cherry -v`, tree comparison where useful, and direct `origin/main:<path>` checks.

## Counts By Class

| Class | Count | Branches |
| --- | ---: | --- |
| unique | 5 | `codex/expand-vendor-catalog-seed`, `codex/signup-step-validation`, `chore/qa-stabilization`, `refactor/planner-route-extraction`, `refactor/recommend-route-extraction` |
| superseded | 4 | `codex/money-flow-phase0`, `codex/fix-planner-empty-billing-modal`, `fix/signup-pricing-wiring`, `chore/monitoring-sentry` |
| partial | 2 | `codex/rev-share-settlement-schema`, `codex/stripe-connect-webhook` |
| duplicate | 0 | None found |

## Recommended Order

1. Delete clearly superseded branches after pending PRs #21/#23 are handled: `codex/money-flow-phase0`, `codex/fix-planner-empty-billing-modal`, `fix/signup-pricing-wiring`, `chore/monitoring-sentry`.
2. Open a focused PR for `codex/signup-step-validation`. It is small, user-facing, and `origin/main` does not currently have equivalent step validation or the test file.
3. Open `chore/qa-stabilization` after PR #21 if E2E remains noisy. This is Playwright-only; it does not fix the recurring Jest `venue-payouts-rental-ui` timeout.
4. Consider `codex/expand-vendor-catalog-seed` as a product/data PR. It is unique and the added vendors are `is_published: true` and `is_admin_seeded: true`, but it should be reviewed against issue #17 publish-readiness semantics.
5. Hold the large route extractions until smaller cleanup PRs are merged. They are useful, but both touch high-risk planner surfaces and their handoffs say verification was not run.

## Security / Correctness Flags

- `codex/stripe-connect-webhook` surfaced a webhook-routing design question. `origin/main` handles some connected-account events in `app/api/webhooks/stripe/route.ts` and verifies with `process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET`. The branch adds a separate `/api/webhooks/stripe/connect` endpoint and separate Connect-secret verification. Do not wholesale merge without deciding whether production uses one combined Stripe endpoint or separate platform/connect endpoints.
- `chore/monitoring-sentry` includes an older rich `/api/health` payload with timestamp/version/check details. PR #20 intentionally narrowed production health output to `{ "status": "ok" }`, so those tests/docs now expect old behavior and should not be copied.

## Per-branch Findings

### `codex/money-flow-phase0`

- Class: superseded
- Commits ahead of `origin/main`: 23
- Files touched: broad Phase 0 / Phase 1 money flow set; the branch tree matches PR #5 merge commit `dde7808`.
- Comparison: `git diff dde7808..codex/money-flow-phase0` is empty. The branch contains the unsquashed/source commits for PR #5 (`Phase 0 + Phase 1 - cents normalization, free tier gate, rev share settlement`), while `main` has the merged PR content.
- Recommendation: delete local branch/worktree if no longer needed for archaeology.
- Notes: `git cherry` marks the individual commits as different SHAs because PR #5 merged/squashed differently, but tree equality against `dde7808` is decisive.

### `codex/rev-share-settlement-schema`

- Class: partial
- Commits ahead of `origin/main`: 3
- Files touched: `supabase/migrations/20260527000000_kickback_settlement_schema.sql`, `QA_REPORT.md`, `RECONCILIATION.md`, `__tests__/fixtures/extraction/*`.
- Comparison: the settlement schema/docs are superseded by PR #5's `20260527000002_kickback_settlement.sql` and related QA artifacts. The branch also has a different extraction fixture set (`clover-summary.png`, `encrypted.pdf`, `pos-report.pdf`, `toast-revenue.xlsx`, etc.) that is not byte-equivalent to the fixture set on `main`.
- Recommendation: split only if the extra extraction fixtures are still useful; otherwise delete after confirming no eval/test references need them.
- Notes: do not PR the schema migration from this branch. It is an older alternate migration name and would conflict with the already-merged settlement schema.

### `codex/expand-vendor-catalog-seed`

- Class: unique
- Commits ahead of `origin/main`: 3
- Files touched: `scripts/seed-catalog.ts`, `supabase/migrations/20260520000000_expand_vendor_service_catalog_constraints.sql`.
- Comparison: unique seed/catalog work. Adds archetype vendor catalog coverage and widens `vendor_profiles` service/vendor type constraints. Added seed vendors are marked `is_published: true`, `is_admin_seeded: true`, and `is_claimed: false`.
- Recommendation: PR as a focused product/data PR, with review against issue #17 publish-readiness semantics.
- Notes: this fits the admin-seeded demo-vendor model, but because #17 is not merged yet, reviewers should explicitly accept that these published demo vendors remain visible while non-payable.

### `codex/signup-step-validation`

- Class: unique
- Commits ahead of `origin/main`: 1
- Files touched: `components/auth/SignupExperience.tsx`, `components/auth/__tests__/SignupExperience.test.tsx`.
- Comparison: `origin/main` does not contain `getStepErrors`, `stepErrors`, or the `SignupExperience` test file. The branch adds per-step required-field validation for creator, venue, and vendor signup flows without changing the documented step counts.
- Recommendation: PR soon as a focused bug fix.
- Notes: do not checkout the old branch wholesale. Rebase/apply the one commit carefully onto current `main` so it does not disturb recent homepage/signup copy decisions.

### `codex/stripe-connect-webhook`

- Class: partial
- Commits ahead of `origin/main`: 1
- Files touched: `app/api/webhooks/stripe/connect/route.ts`, `app/api/webhooks/stripe/route.ts`, `lib/stripe/connect-webhook.ts`, `__tests__/integration/stripe-connect-webhook.test.ts`.
- Comparison: `origin/main` already handles `account.updated`, `payout.paid`/`payout.failed` observation, and `account.application.deauthorized` in the primary Stripe webhook. The branch adds a separate Connect endpoint, separate Connect-secret verification, capability updates, payout metadata persistence, and a large test suite.
- Recommendation: split/review, not delete blindly. Decide webhook topology first: combined platform/connect webhook versus dedicated `/api/webhooks/stripe/connect`.
- Notes: likely valuable pieces are capability/payout persistence and tests. Risky piece is changing endpoint/secret routing without matching Stripe dashboard configuration.

### `codex/fix-planner-empty-billing-modal`

- Class: superseded
- Commits ahead of `origin/main`: 1
- Files touched: `app/(planner)/planner/page.tsx`.
- Comparison: `git cherry -v origin/main codex/fix-planner-empty-billing-modal` marks the commit as patch-equivalent (`-`). Main contains this via the planner billing gate work (`feat(planner): timeline rebuild, tab routing, billing gate UX`).
- Recommendation: delete.
- Notes: single-line fix; no unique payload remains.

### `fix/signup-pricing-wiring`

- Class: superseded
- Commits ahead of `origin/main`: 1
- Files touched: `lib/server/account-setup.ts`.
- Comparison: `git cherry -v origin/main fix/signup-pricing-wiring` marks the commit as patch-equivalent (`-`). Main contains it via PR #6 (`fix(signup): wire venue and vendor pricing fields through signup to profile records`).
- Recommendation: delete.
- Notes: no unique payload remains.

### `chore/qa-stabilization`

- Class: unique
- Commits ahead of `origin/main`: 1
- Files touched: `e2e/login.spec.ts`, `e2e/planner-chat.spec.ts`, `playwright.config.ts`, `qa-artifacts/qa-stabilization-handoff.md`.
- Comparison: unique Playwright stabilization. Raises timeouts, adds hydration waits, stabilizes mock planner setup, and changes Playwright web server to build/start with one worker by default.
- Recommendation: PR after PR #21 if E2E remains noisy.
- Notes: this does not address the recurring Husky/Jest `__tests__/integration/venue-payouts-rental-ui.test.tsx` timeout. That flake needs a separate Jest/test fix.

### `refactor/planner-route-extraction`

- Class: unique
- Commits ahead of `origin/main`: 1
- Files touched: `app/(planner)/planner/page.tsx`, `components/planner/planner-page/*`, `qa-artifacts/planner-route-extraction-handoff.md`.
- Comparison: unique mechanical extraction of the 5k-line planner page into `PlannerWorkspace`, `PlannerConversation`, `PlannerTemplatesModal`, `draftMode`, `plannerState`, and `types`.
- Recommendation: hold, then PR only after smaller fixes land and with full planner smoke/E2E coverage.
- Notes: no feature or API behavior is intended, but this is the primary product surface. Handoff says verification was not run.

### `refactor/recommend-route-extraction`

- Class: unique
- Commits ahead of `origin/main`: 1
- Files touched: `app/api/planner/plans/[planId]/recommend/route.ts`, `lib/planner/recommend/*`, `lib/planner/recommend/__tests__/recommendServices.test.ts`, `qa-artifacts/recommend-route-extraction-handoff.md`.
- Comparison: unique extraction of the large planner recommendation route into services for context loading, venue/vendor matching, economics computation, persistence, fallback, audit, and handler wiring.
- Recommendation: hold, then PR as a focused backend refactor before larger planner UI extraction.
- Notes: probably lower user-facing risk than the page extraction, but still touches the recommendation engine path. Handoff says verification was not run and one integration test was intentionally dropped because it mixed in supply-scout seed data.

### `chore/monitoring-sentry`

- Class: superseded
- Commits ahead of `origin/main`: 1
- Files touched: `.env.example`, `app/api/health/route.ts`, `app/global-error.tsx`, `instrumentation.ts`, `next.config.js`, `package.json`, `package-lock.json`, Sentry config files, `__tests__/integration/health-route.test.ts`, `__tests__/integration/mvp-launch-contracts.test.ts`, `qa-artifacts/monitoring-sentry-handoff.md`.
- Comparison: PR #20 already merged the Sentry runtime/init files, global error boundary, `next.config.js` Sentry wrapping, dependency changes, and narrowed `/api/health`. The branch's health route/test still expect timestamp/version/dependency checks, which contradicts the PR #20 decision to avoid version/commit/env recon surface.
- Recommendation: delete. If health tests are desired, write a fresh tiny test against `{"status":"ok"}` rather than copying this branch.
- Notes: direct `origin/main` check shows the intended small health endpoint is already present.

## Deferred Branches

These were intentionally not audited in this pass because phase-5 outreach core (PR 3c/3d) is not on `main` yet:

- `codex/outreach-phase-2`
- `codex/outreach-phase-4`
- `feat/discovery-supply-scout`
- `feat/outreach-autonomy`
- `chore/product-positioning-copy`

## Branches That Surprised Me

- `codex/stripe-connect-webhook`: not fully superseded. Main does handle connected account updates, but the branch has separate endpoint/secret handling plus capability/payout persistence.
- `codex/rev-share-settlement-schema`: schema is dead, but the extraction fixtures are unique.
- `chore/monitoring-sentry`: mostly superseded, but its leftover health tests now encode behavior we explicitly rejected in PR #20.
