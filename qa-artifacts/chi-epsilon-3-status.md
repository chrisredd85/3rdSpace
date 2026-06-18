[2026-06-18T06:58:41Z] setup: complete - Fresh epsilon.3 worktree from origin/main at 4753110.
[2026-06-18T06:59:55Z] baseline: flaky - Full npm test on unmodified main reported timeouts/failures in SignupExperience and venue-payouts-rental-ui.
[2026-06-18T07:00:18Z] baseline-focused-rerun: passed - The two failing baseline files passed serially with --runInBand; treating as pre-existing parallel test flake.
[2026-06-18T07:16:59Z] type-check: passed - Initial epsilon.3 implementation type-check passed.
[2026-06-18T07:20:13Z] focused-tests: passed - New epsilon.3 checkout, race, admin, approval invariant, and legacy guard tests passed.
[2026-06-18T07:20:52Z] state-tests: passed - Settlement state-machine tests updated for awaiting_venue_payment lifecycle.
[2026-06-18T07:21:03Z] type-check: passed - Full type-check passed after tests.
[2026-06-18T07:21:37Z] lint: passed - Lint passed with existing hook dependency warnings only.
[2026-06-18T07:23:05Z] build: failed-env - npm run build failed because fresh worktree lacks Supabase env vars during page-data collection.
[2026-06-18T07:26:47Z] build: passed - npm run build passed after linking ignored local env files into the isolated worktree.
[2026-06-18T07:31:41Z] db-reset: passed - supabase db reset applied all migrations including 20260618030000_add_chi_settlement_checkout.sql.
[2026-06-18T07:32:05Z] rls-tests: passed - RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand passed.
[2026-06-18T07:32:10Z] security-rls: passed - npm run security:rls passed.
[2026-06-18T07:32:10Z] tied-house-loose: passed - npm run security:tied-house passed.
[2026-06-18T07:32:14Z] tied-house-strict: expected-legacy-findings - Strict grep still reports δ.1 legacy nomenclature backlog; epsilon.3 added no new forbidden names.
[2026-06-18T07:33:08Z] full-test: failed-branch-owned - Initial npm test exposed helper-file discovery and lifecycle mock issues in the epsilon.3 diff.
[2026-06-18T07:35:10Z] focused-rerun-after-fix: passed - Moved shared test helper to test-utils and extended lifecycle fake Supabase client; affected focused tests passed.
[2026-06-18T07:35:14Z] type-check-after-fix: passed - Type-check passed after test helper and lifecycle mock fixes.
[2026-06-18T07:36:05Z] full-test: passed - Full npm test passed: 161 suites passed, 1 skipped; 812 tests passed, 9 skipped.
[2026-06-18T07:36:24Z] lint-final: passed - Final npm run lint passed with existing hook dependency warnings only.
[2026-06-18T07:38:51Z] spec-tightening: complete - Added ACH Checkout support and explicit organizer_payout_cents ledger invariant.
[2026-06-18T07:39:04Z] focused-rerun-after-spec-tightening: passed - Settlement checkout focused tests and type-check passed after ACH and payout column change.
[2026-06-18T07:41:12Z] db-reset-final: passed - supabase db reset passed after organizer_payout_cents migration constraint update.
[2026-06-18T07:42:08Z] full-test-final: passed - Full npm test passed after ACH and organizer_payout_cents correction: 161 suites passed, 1 skipped; 812 tests passed, 9 skipped.
[2026-06-18T07:42:34Z] lint-final-2: passed - Final lint passed with existing hook dependency warnings only.
[2026-06-18T07:42:34Z] strict-delta: passed - Targeted grep over new epsilon.3 settlement files found zero forbidden legacy terms.
