# CHI Nomenclature δ.2 Status

Last updated: 2026-06-18T02:00:11Z

## Dependency Check

- δ.1 audit is present at `qa-artifacts/chi-nomenclature-audit.md`.
- Strict tied-house script is present and intentionally still fails until δ.3-δ.5 complete.
- ε.1 is already merged, but ε.2/ε.3 remain blocked until this δ.2 schema/read cutover is reviewed and merged.

## Scope Completed

- Added canonical CHI nomenclature support for `event_revenue_terms.term_type`:
  - `venue_chi`
  - `vendor_consumption_share`
- Preserved legacy term values for compatibility during the migration window:
  - `venue_kickback`
  - `vendor_rev_share`
- Added dual-write compatibility flags:
  - `is_legacy_consumption_share`
  - `is_legacy_revenue_share`
- Updated CHI agreement and settlement write paths to write both compatibility flags.
- Updated finance readers to canonicalize legacy term types before calculations.
- Preserved deprecated summary aliases while adding canonical summary fields.
- Added migration tests and focused finance/helper tests.

## Decision Made Under Ambiguity

The δ.1 audit suggests renaming historical `kickback_payments` terminology toward `community_host_incentive_payments`. On current `main`, `community_host_incentive_payments` already exists as a compatibility view, not a new physical mirror table. Replacing that view with a physical table in δ.2 would require dropping or renaming the existing view and would violate the additive-only rollback posture for this phase.

Conservative choice: keep the existing view, update it to expose the new `is_legacy_consumption_share` field while preserving old-column compatibility, and defer removal of legacy payment terminology to δ.3-δ.5.

## Validation

- Focused Jest: passed
  - `lib/finance/__tests__/chi-nomenclature-sync.test.ts`
  - `lib/finance/__tests__/revenueTerms.test.ts`
  - `__tests__/schema/chi-nomenclature-delta-2-migration.test.ts`
  - `__tests__/integration/venue-kickback-checkout-route.test.ts`
  - Result: 4 suites / 22 tests passed.
- Type-check: passed with `npm run type-check -- --pretty false`.
- Supabase reset: passed after preserving existing view column order in `community_host_incentive_payments`.
- Lint: passed with existing repo warnings.
- Build: passed with existing repo warnings.
- Strict tied-house: expected failure. Remaining findings are the intended work breakdown for δ.3 API contracts, δ.4 UI/types, and δ.5 compatibility cleanup.

## Rollback Notes

This PR does not drop legacy schema. Rollback is a normal revert of this PR plus, if needed, a follow-up migration that removes:

- `is_legacy_consumption_share` from `community_host_incentive_agreements`
- `is_legacy_consumption_share` from `community_host_incentive_settlements`
- partial indexes on those compatibility columns
- the expanded `event_revenue_terms_term_type_check`

The temporary sync trigger/function is created and dropped inside this migration pair and should not remain after a successful reset or deploy.
