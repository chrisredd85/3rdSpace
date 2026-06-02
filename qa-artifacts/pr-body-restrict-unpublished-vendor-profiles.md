## Summary

This PR ships the visibility-only half of the Branch B split.

Migration `20260602000009_restrict_unpublished_vendor_profiles.sql`:

- Drops the original `"Vendor profiles are publicly viewable"` SELECT policy.
- Adds `"Published vendor profiles are publicly viewable"` so public catalog reads only see `vendor_profiles.is_published = true`.
- Adds `"Vendors can view own profile"` so an authenticated vendor can still read their own unpublished profile via `auth.uid() = user_id`.

No application code changes are included. The source branch did not contain any `app/`, `components/`, or `lib/` changes tied to the new visibility semantics.

## Product Behavior Change

Unpublished vendor profiles disappear from the public catalog and anonymous reads. Owner-side access is preserved so vendors can still view and edit their own unpublished profile after login.

The product definition for "published" is: vendor offers a service that can be booked and paid for via Stripe and is operational enough for the economics agent to factor into observations.

## Audit Outcome

Audit outcome: Case B + Case C.

Case B: the publish-action readiness gate is missing or weak. This PR intentionally does not solve that gate; it ships visibility only. Publish-action gate tracked in follow-up issue #17.

Weak write sites found:

- `app/api/admin/catalog/vendors/route.ts:65` - admin-created vendor rows are inserted with `is_published: true`.
- `app/api/admin/catalog/vendors/route.ts:153` - admin PATCH can directly set `is_published`.
- `lib/server/account-setup.ts:414` - vendor onboarding creates or updates profiles with `is_published: true`.
- `lib/vendors/vendorClaims.ts:167` - vendor claim flow marks claimed profiles `is_published: true`.
- `app/(dashboard)/vendor/services/page.tsx:283` - legacy vendor self-service page lets vendors submit `is_published` directly.
- `lib/vendors/profile-adapter.ts:144` plus `lib/hooks/useVendors.ts:177` - generic helpers can map `is_active` into `is_published`.

Case C: seeded/demo vendors are intentionally published and need a separate product treatment before real external vendor onboarding opens.

Seeded vendor rows that remain visible:

- `scripts/seed-catalog.ts` publishes five admin-seeded demo vendors: Bay Shots Photography, DJ Mango, Nourish Catering Co., Pour Masters Bartending, and ClearSound AV.
- `supabase/seed.sql` publishes roughly 80% of generated vendor rows via `n % 5 <> 0` and creates active `vendor_offerings` for those generated rows.

Known gap: seeded/demo vendors do not have Stripe accounts. The follow-up readiness gate needs a demo/marketing carve-out, and the economics agent must treat demo vendors as non-payable and non-bookable.

## Follow-Up

Issue #17: `feat: enforce vendor publish readiness gate`.

That follow-up must land before external vendor onboarding opens to real users. Required behavior:

- Real vendors can publish only with `vendor_stripe_accounts.charges_enabled = true` and at least one active `vendor_offerings` row.
- Demo/marketing vendors can remain visible through `is_admin_seeded = true` or an equivalent documented flag.
- The economics agent treats demo vendors as non-payable and non-bookable.
- Server-side checks harden every publish write site listed above.
- Tests cover rejection paths and demo carve-out behavior.

## Rollback

Rollback path is policy-only:

- Drop `"Published vendor profiles are publicly viewable"`.
- Drop `"Vendors can view own profile"`.
- Recreate `"Vendor profiles are publicly viewable"` with `USING (true)`.

Profile data is preserved.

## Validation

- `npm run type-check` - passed.
- `supabase db reset` - passed and applied `20260602000009_restrict_unpublished_vendor_profiles.sql`.
- Local RLS spot check - passed:
  - anonymous sees `0` unpublished vendor profiles;
  - anonymous still sees published vendor profiles;
  - authenticated owner sees their unpublished profile;
  - another authenticated user does not see that unpublished profile.
- `npm run lint` - passed with existing React hook dependency warnings in unrelated UI files.
- `npm test` - passed in the commit hook, 84 suites and 530 tests.
- `npm run security:rls` and `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` were unavailable on this branch because those commands/files are introduced in PR #16 and are not on this `origin/main` base yet.

## Audience Impact

Zero real users are currently affected because the product is pre-launch for external vendors. The migration tightens public visibility without changing existing profile data.
