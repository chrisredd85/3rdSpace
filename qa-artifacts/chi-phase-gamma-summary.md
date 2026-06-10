# CHI Phase Gamma Summary

## Scope

- Migrated active venue-to-organizer settlement callers from `/api/venue/kickbacks/*` to `/api/venue/community-host-incentive/*`.
- Kept the old `/api/venue/kickbacks/*` API paths as 308 redirects for compatibility.
- Moved shared settlement route logic into `lib/server/community-host-incentive/*`.
- Added `community_host_incentive_payments` as a payment-facing read view over CHI settlements.
- Updated user-facing settlement copy to Community Host Incentive framing across planner, venue, vendor, signup, and Eventbrite-adjacent surfaces.
- Updated focused tests and venue Playwright smoke expectations for the CHI labels and new route namespace.

## Intentional Rollout Deviation

The original Phase gamma plan described physical archival of the old settlement tables. This PR does not rename or archive those tables yet because the rollout is intentionally per-caller gated and the legacy fallback still reads/writes those compatibility tables. Physical archival should move to the post-fallback phase after CHI is enabled for all callers.

## Verification

- `npm run type-check` passed.
- `npm run lint` passed with existing hook dependency warnings.
- `npm run security:tied-house` passed for scoped CHI/outreach targets.
- Focused Jest passed: 7 suites, 25 tests.
- `npm run build` passed after loading the existing local env file for build-time Supabase vars.
- Playwright Chromium venue smoke passed: `/venue/payouts` auth gate passed; credentialed `/venue/pricing` workflow skipped because E2E venue credentials are not configured.
- `npx supabase db reset` passed and applied `20260616000000_add_community_host_incentive_payments_view.sql`.
- Claude Code review reported no P0/P1 blocking findings.

## Rollback

- Revert this PR to restore direct callers to `/api/venue/kickbacks/*`.
- For database rollback, drop the additive read view:

```sql
DROP VIEW IF EXISTS public.community_host_incentive_payments;
```
