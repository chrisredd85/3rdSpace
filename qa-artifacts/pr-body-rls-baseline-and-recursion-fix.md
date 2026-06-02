## Summary

This PR narrows the original RLS baseline branch to the security baseline and policy-recursion fix only.

It adds two migrations:

1. `20260602000000_enable_rls_security_baseline.sql`
   - Enables RLS on `public.events`.
   - Enables RLS on `public.vendor_bookings`.
   - Enables RLS on `public.webhook_rate_limits`.
   - Adds a builder-owned delete policy for `public.events`.
   - Adds a service-role-only management policy for `public.webhook_rate_limits`.
   - Restricts `public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER)` execution to `service_role`.

2. `20260602000001_fix_events_collaborators_rls_recursion.sql`
   - Adds `public.is_event_builder(uuid)` and `public.is_event_collaborator(uuid)` security-definer helpers.
   - Replaces the recursive `events` / `collaborators` policy predicates with helper-based predicates.
   - Grants helper execution only to `authenticated` and `service_role`.

The vendor profile privacy migration is intentionally not included here. Public visibility for unpublished vendor profiles remains existing `main` behavior and is covered only as a documented current-state test. The privacy change should land in its own product-reviewed PR.

## Regression Coverage

- Adds DB-backed RLS tests for `events`, `collaborators`, `vendor_bookings`, `webhook_rate_limits`, `plans`, `venues`, and current `vendor_profiles` visibility.
- Adds `scripts/security/check-rls.ts`, which fails if any non-extension public table has RLS disabled.
- Adds `.github/workflows/rls-checks.yml` so migration/security changes run the local Supabase RLS regression gate in PR CI.
- Adds `npm run security:rls` and includes it in `npm run check`.

## Vercel Build Path Check

Verified Vercel project `website-for-services-projects/3rd-space` uses the default Next.js build command: `npm run build` or `next build`.

Local `vercel.json` only defines the venue overdue cron and does not call `npm run check`, so the new `security:rls` script is not in the Vercel production build path.

## Validation

- `npm run type-check` - passed.
- `supabase db reset` - passed with the two narrowed migrations applied.
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` - passed, 9 tests.
- `npm run security:rls` - passed.
- `npm run lint` - passed with existing React hook dependency warnings in unrelated UI files.

## Product / Rollout Notes

- `vendor_bookings` RLS is enabled in this baseline because existing organizer/vendor policies already define row visibility. Smoke the builder/vendor booking read paths on staging before production migration rollout.
- This PR does not change public vendor catalog visibility. The unpublished vendor profile restriction should be reviewed separately because it is a user-visible product behavior change.
