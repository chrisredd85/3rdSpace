[2026-06-18T03:38:00Z] setup: complete - Created clean worktree from origin/main at 42c3a0f.
[2026-06-18T03:38:00Z] dependency-check: complete - Required legacy checkout, venue payouts, and Stripe webhook files are present.
[2026-06-18T03:38:00Z] implementation: complete - Replaced legacy checkout implementation with 410, removed venue payout checkout action, and added legacy webhook Sentry warning.
[2026-06-18T03:44:00Z] focused-tests: passed - legacy checkout disabled, venue payouts UI, and Stripe legacy webhook focused suites passed.
[2026-06-18T03:45:00Z] type-check: passed - npm run type-check completed without errors.
[2026-06-18T03:45:00Z] lint: passed - npm run lint completed with existing warnings only.
[2026-06-18T06:30:00Z] build: passed - npm run build passed after copying ignored local env into the isolated worktree.
[2026-06-18T06:31:00Z] db-reset: passed - supabase db reset completed with all migrations through settlement runs.
[2026-06-18T06:32:00Z] local-preflight-counts: passed - Local seeded database has zero recent legacy kickback payment rows and zero recent legacy agreement attendance/approval rows.
[2026-06-18T06:33:00Z] rls: passed - RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand passed.
[2026-06-18T06:33:00Z] security: passed - npm run security:rls and npm run security:tied-house passed.
[2026-06-18T06:36:00Z] full-tests: passed - npm test passed: 156 suites passed, 1 skipped; 805 tests passed, 9 skipped.
[2026-06-18T06:36:00Z] direct-disabled-test: passed - npm test -- __tests__/integration/legacy-chi-checkout-disabled passed.
