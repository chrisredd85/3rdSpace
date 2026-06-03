## Summary

Ports the focused vendor catalog seed expansion from `origin/codex/expand-vendor-catalog-seed` onto current `main` without bringing along stale branch drift.

This PR:
- Aligns existing seeded vendor `service_type` values with the planner archetype vocabulary (`photographer`, `av_production`)
- Adds archetype coverage vendors for instructors, East Bay photo/DJ/catering/bar, AV, video, staffing, security, decor, florals, check-in, photo booth, transport, pastry, lighting, permits, and POS systems
- Adds migration `20260520000000_expand_vendor_service_catalog_constraints.sql` to widen `vendor_profiles.service_type` and `vendor_profiles.vendor_type` checks while preserving legacy signup/admin values

## Seeded Vendor Publish Semantics

The new vendor rows intentionally use:
- `is_published = true`
- `is_admin_seeded = true`
- `is_claimed = false`

These are demo/catalog seed entries, not real bookable vendors. This matches the current seeded-vendor exception discussed in issue #17. The publish-readiness gate remains tracked there and must distinguish admin-seeded demo inventory from real vendor profiles before external vendor onboarding goes live.

## Scope Handling

The source branch is behind current `main`, so this PR cherry-picks only the three seed-catalog commits:
- `8fcf217` - align existing vendor service types
- `372226c` - add archetype vendor catalog coverage
- `1a4718f` - widen vendor catalog seed constraints

No stale app-code, test, Sentry, RLS, economics, or phase-5 drift from the old branch is included.

## Migration

`20260520000000_expand_vendor_service_catalog_constraints.sql` drops/recreates two existing check constraints on `vendor_profiles`:
- `valid_service_type`
- `vendor_profiles_vendor_type_check`

No new table is created, so no new RLS policy is required. Existing vendor profile RLS remains unchanged.

## Validation

- `npm install` passed; existing npm audit warnings remain
- `npm run type-check` passed
- `supabase db reset` passed; new migration applied successfully
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed, 9 tests
- `npm run security:rls` passed
- `npm test` passed, 94 suites, 567 tests
- `npm run lint` passed with existing React hook warnings
- `npm run build` initially failed without Supabase env in the fresh worktree; reran with local Supabase env from `supabase status -o env` and passed
- Dev smoke on `127.0.0.1:3104`: `/api/health` 200, `/planner` 200

## Rollback

Revert this PR. That removes the added seed entries and restores the narrower vendor profile constraints.
