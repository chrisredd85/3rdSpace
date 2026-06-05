## Summary

Wires the approved `/mobile-mockup` mobile planner shell to real planner data on a clean branch from `origin/main`. This PR does **not** promote `/mobile-mockup` to `/planner`; it keeps the mobile shell isolated while replacing fictional operational content with authenticated read models, real APIs, empty states, and tests.

## Step 2 audit

| Surface | Main support found | PR treatment |
| --- | --- | --- |
| Planner home | `plans`, `plan_messages`, `approvals`, `recommendations`, existing `/api/planner/plans*` routes | Wired to real active plan, messages, pending approvals, recommendations, and status/activity summaries |
| Approvals | Existing approval records and payment authorization posture | Read-only approval queue/detail views; mobile screen does not book, pay, or send |
| Budget | `plans.budget_cap_cents`, `event_cost_commitments`, existing economics tables | Added budget read model and cents-only budget line table for mobile projections |
| Messages | Existing planner message APIs | Add-instruction form posts to existing planner message API |
| Vendors / venues | Existing recommendations and catalog references | Shows real recommendations only; no fake vendor/venue fallback |
| Ticketing | Existing ticketing analytics and connection routes | Wired to existing read endpoints |
| Billing/settings | Existing builder billing status and ticketing connections | Wired to existing read endpoints |
| Analytics | Event economics tables from main | Added deterministic read-only planner analytics endpoint; no LLM dependency |
| Outreach drafts/replies | Runtime outreach code is absent on current main (`app/api/planner/outreach/*`, `lib/outreach/*`, reply classifier not present) | Skipped with honest in-development empty states |

## Imported files

Started from clean worktree `/Users/chrisredd/3rdSpace.webapp-mobile-wire` at `origin/main`. Imported only the approved mobile mockup manifest from the stale worktree:

- `components/planner/mobile-mockup/MobilePlannerMockup.tsx`
- `components/planner/mobile-mockup/mobileMockupSpacing.ts`
- `app/(mobile-mockup)/mobile-mockup/**/*.tsx`

Did not copy `public/logo.png` or any outreach-only/runtime files.

## New read models

Migration: `supabase/migrations/20260604000000_add_mobile_planner_read_models.sql`

- Adds `plan_budget`, `plan_budget_lines`, and `plan_activity`
- Adds helper `public.can_manage_plan_read_model(p_plan_id uuid)`
- Enables RLS on all three new tables
- Adds owner-scoped select/insert/update/delete policies for authenticated plan owners
- Allows service-role access through the same helper/grants
- Stores all money in integer cents

Generated DB types were regenerated after `supabase db reset`. The generated file has Supabase CLI churn beyond the additive tables/functions, but the new `plan_budget`, `plan_budget_lines`, `plan_activity`, and `can_manage_plan_read_model` types are present.

## New endpoints

- `GET /api/planner/plans/[planId]/mobile-home`
- `GET /api/planner/plans/[planId]/budget`
- `GET /api/planner/plans/[planId]/activity`
- `GET /api/planner/analytics`

All new endpoints use the existing community-builder auth pattern and are read-only. No endpoint in this PR books, pays, sends, or bypasses approval records.

## Skipped outreach surfaces

These views intentionally do not pretend the Gmail/outreach runtime exists on main:

- Draft: "Outreach drafts will appear here once the Gmail integration is enabled. Currently in development."
- Reply: "When venues reply, parsed decisions will appear here."
- Outreach: "Outreach drafts, replies, and automation policies will appear here once the Gmail integration is enabled. Currently in development."
- Sent: "Approved sent-message activity will appear here once the outreach pipeline is enabled."
- Policy: "Outreach automation rules are coming with the Gmail pipeline. Until then, every outbound send requires review."

## Screenshots

Saved at 390x844 under `qa-artifacts/mobile-wire-screenshots/`:

- `planner.png`
- `approvals.png`
- `messages.png`
- `vendors.png`
- `outreach.png`
- `settings.png`
- `new-plan.png`
- `ticketing.png`
- `analytics.png`
- `billing.png`
- `planner-view-approval.png`
- `planner-view-venue-detail.png`
- `planner-view-deposit.png`
- `planner-view-draft.png`
- `planner-view-reply.png`

Screenshot run used route-mocked API fixtures to exercise populated and skipped states. The component itself does not retain hardcoded sample venue/vendor/outreach data.

## Validation

- `supabase db reset` passed; migration `20260604000000_add_mobile_planner_read_models.sql` applied cleanly
- `npm run db:types` passed
- `npm run type-check` passed
- `npm run lint` passed with existing unrelated warnings
- `npm test -- __tests__/planner/mobileReadModels.test.ts --runInBand` passed, 3 tests
- `npm test -- __tests__/integration/mobile-planner-routes.test.ts --runInBand` passed, 5 tests
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed, 9 tests
- `npm run security:rls` passed
- `npm test` passed, 96 suites passed / 1 skipped, 575 tests passed / 9 skipped
- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key npm run build` passed
- Local dev server used port `3002` because `3001` was already in use
- Browser smoke on `http://localhost:3002/mobile-mockup/planner` passed: 200, nonblank 3rdPlace unauthenticated state, no Next overlay, no console errors
- Delayed-load Playwright check passed: `Loading planner` appeared before delayed `/api/planner/plans?limit=10` response

## Rollback

Revert this PR to remove the isolated `/mobile-mockup` route group, mobile read-model endpoints, tests, regenerated types, and the read-model migration. No production planner route is promoted or replaced by this PR.
