# CHI Phase Alpha Foundation

## Inputs

- Audit PR: https://github.com/chrisredd85/3rdSpace/pull/61
- Audit status: merged at `3fc45332f9eaa4f9ac015ea7b3f34481144c73c4`
- Prod row count findings: https://github.com/chrisredd85/3rdSpace/pull/63
- In-flight migration policy: no event-linked in-flight rows. The one null-event orphan legacy agreement was resolved from `payment_pending` to `cancelled` in production before this work.
- Approved deviations: none.
- Out-of-scope additions: none.

## Scope

This PR adds the CHI foundation only. It does not wire CHI into planner, venue, payment, or outreach execution paths.

Added:
- `community_host_incentive_agreements`
- `community_host_incentive_settlements`
- Pure typed CHI calculation helpers
- Tied-house compliance guard script for scoped CHI/outreach targets
- Focused migration, calculation, and compliance tests
- Generated Supabase types for the new CHI tables

Preserved:
- Legacy `event_kickback_agreements` and `kickback_payments`
- Existing Stripe/payment routes
- Existing planner, signup, and partner dashboard routing
- Approval-gated execution contract

## Business Invariants

- CHI is not a revenue-share or kickback mechanism.
- Settlement calculations must not use percentage of POS, bar, alcohol, F&B, venue revenue, or total revenue.
- New CHI money fields are integer cents.
- Approved or active CHI agreements require venue approval metadata.
- Fixed-threshold agreements that miss the attendance threshold produce zero payout and do not apply a payout floor.
- Future legacy archival may mark preserved rows with `is_legacy_revenue_share = true`; this PR does not silently convert legacy rows into CHI agreements.

## Rollback Notes

This migration is additive. Rollback is mechanical:

```sql
DROP TABLE IF EXISTS public.community_host_incentive_settlements;
DROP TABLE IF EXISTS public.community_host_incentive_agreements;
```

Also remove the generated type sections and CHI helper/test files if rolling back the code commit.

## Verification

- `npm ci` passed
- `supabase db reset` passed
- `npm run db:types` passed
- `npm run type-check` passed
- `npm run lint` passed with existing hook dependency warnings
- `npm run security:tied-house` passed
- `npm run security:rls` passed
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed
- `npm test -- lib/finance/community-host-incentive --runInBand` passed
- `npm test -- __tests__/schema/community-host-incentive-migration.test.ts --runInBand` passed
- `npm test -- --runInBand` passed: 127 suites passed, 1 skipped; 689 tests passed, 9 skipped
- `npm run build` passed with env loaded from local `.env.local`; existing hook warnings remain
- `git diff --check` passed

## Remaining Risks

- The tied-house grep guard is scoped to new CHI/outreach work and intentionally excludes the compliance helper/test where forbidden terms are listed for rejection.
- This is behavior-dark foundation work. Planner/venue UI, admin review, settlement execution, and legacy archival remain for later CHI phases.
