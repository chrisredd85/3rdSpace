# Mobile/Desktop Parity Fixes — 2026-06-30

Branch: `codex/mobile-desktop-parity-fixes`  
Base: `origin/main` at `52dc0a8`

## Issue 1: Payments approval queue parity (P1)

**Root cause:** Desktop `/planner/payments` rendered a local payments-ledger placeholder for pending approvals while mobile and plan-level approvals used planner approval rows. That let the desktop payments page falsely say there were no approvals even when the active plan had a pending venue-hold approval.

**Query unification location:** `lib/planner/pendingApprovals.ts:26`, `lib/planner/pendingApprovals.ts:46`, `lib/planner/pendingApprovals.ts:65`

**Surfaces updated:**
- `app/api/planner/approvals/pending/route.ts:38` loads pending approvals for the active owned plan.
- `app/(planner)/planner/payments/page.tsx:176` fetches the shared pending-approval endpoint.
- `app/(planner)/planner/payments/page.tsx:488` routes each pending approval back to `/planner?plan=...&tab=approvals`.
- `app/api/planner/plans/[planId]/approvals/route.ts:170` reuses the shared pending-approval query for plan-level approvals.
- `lib/planner/mobileReadModels.ts:138` keeps mobile on the same pending-approval definition.

**Tests:** `lib/planner/__tests__/pendingApprovals.test.ts:1`

**Status:** Fixed.

## Issue 2: Mobile brief "Need X" tappable (P1)

**Targets per row:**
- Venue Terms -> `/planner/outreach?plan={planId}`
- Revenue Model -> `/planner/experiences/{planId}#profit-window`
- Agent Action -> `/planner/settings#approval-rules`
- Tickets / RSVPs -> `/planner/tickets`

**Component changed:** `components/planner/mobile/MobilePlanner.tsx:1584`, `components/planner/mobile/MobilePlanner.tsx:1602`, `components/planner/mobile/MobilePlanner.tsx:1668`, `components/planner/mobile/MobilePlanner.tsx:3004`

**Anchor support:** `components/planner/PlannerLivePlanPanel.tsx:2357`, `components/planner/PlannerLivePlanPanel.tsx:2484`, `components/planner/PlannerLivePlanPanel.tsx:2738`

**Tests:** `components/planner/mobile/__tests__/MobilePlanner.test.tsx:328`

**Status:** Fixed.

## Issue 3: Mobile payments event header (P2)

**Component added:** `components/planner/mobile/MobilePlanner.tsx:2062`, `components/planner/mobile/MobilePlanner.tsx:2079`

**Behavior:** Mobile approval review now shows a compact active-event header with event title, neighborhood/date, and guest target above the approval queue so the organizer knows which event the approvals belong to before reviewing.

**Tests:** `components/planner/mobile/__tests__/MobilePlanner.test.tsx:378`

**Status:** Fixed.

## Issue 4: Desktop loading state (P2)

**Root cause:** The plan detail route loaded core plan detail and then loaded agent summary fields serially. During production smoke this showed a spinner-only "Loading event record..." state long enough to feel broken.

**Parallelization changes:** `app/api/planner/plans/[planId]/route.ts:83`, `app/api/planner/plans/[planId]/route.ts:87`

**Loading UI changed:** `components/planner/PlannerExperienceBriefDetail.tsx:102`

**Perf delta:** Before: production smoke observed a blocking spinner-only event record load. After: agent fields are included in the same `Promise.all` as messages, recommendations, and approvals, and the client renders a structured event-record skeleton while the request completes. Exact production timing was not measured in this PR.

**Status:** Fixed.

## Issue 5: Default plan parity (P2)

**Schema added:** None.

**Read path unified at:** Existing desktop and mobile no-explicit-plan paths both resolve through `/api/planner/plans?limit=10`, and `app/api/planner/plans/route.ts:138` orders by `updated_at desc`. Desktop calls this through `components/planner/planner-page/plannerState.ts:417`; mobile calls it through `components/planner/mobile/MobilePlanner.tsx:1045`.

**Fix shipped:** Mobile now honors explicit `?plan=<id>` links the same way desktop does instead of falling back to the first recent plan. That removes the observed drift for cross-surface event-record links without adding a migration.

**Explicit plan path:** `components/planner/mobile/MobilePlanner.tsx:418`, `components/planner/mobile/MobilePlanner.tsx:1031`, `components/planner/mobile/MobilePlanner.tsx:1037`

**Tests:** `components/planner/mobile/__tests__/MobilePlanner.test.tsx:384`

**Status:** Fixed for explicit planner/event links; no schema migration was needed because the default list fallback was already shared.

## Verification Checklist

- [x] Desktop `/planner/payments` uses the same pending approvals as mobile and plan-level approvals.
- [x] Every listed "Need X" row on mobile brief navigates to a concrete planner surface.
- [x] Mobile payments approval review shows event context above the queue.
- [x] Desktop Experiences detail no longer uses a spinner-only loading state, and the route no longer serializes agent-field loading after the main plan fetches.
- [x] Mobile explicit plan links load the requested plan directly; no-explicit desktop/mobile fallback already shares the same list endpoint.
- [x] Focused brief, payments, mobile, and read-model tests pass.
- [ ] Manual authenticated mobile + desktop smoke was not rerun in this PR.

## Validation

Commands run from `/private/tmp/3rdplace-mobile-desktop-parity-fixes`.

```bash
npm ci
npm run type-check -- --pretty false
npm test -- lib/planner/__tests__/pendingApprovals.test.ts components/planner/mobile/__tests__/MobilePlanner.test.tsx __tests__/planner/mobileReadModels.test.ts --runInBand
npm run lint
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon-key SUPABASE_SERVICE_ROLE_KEY=dummy-service-key npm run build
```

Results:

- `npm ci` completed. npm reported existing package deprecation notices and 8 audit findings.
- Type-check passed.
- Focused Jest passed: 3 suites / 14 tests.
- Lint passed with existing unrelated hook-dependency warnings.
- Build passed with dummy Supabase env values. A build without env values fails before this diff in the existing Supabase import guard for `/api/admin/concierge/invites/[id]/override`.
- Commit hooks ran on each implementation commit and passed lint, type-check, and full Jest: 231 suites passed, 1 skipped; 1176 tests passed, 9 skipped.

## What Was Not Changed

- No new routes were added under `app/(dashboard)`.
- No outbound send, booking, or payment execution path was added or weakened.
- No new active-plan schema field was added because current `origin/main` already shares the default list endpoint for desktop and mobile. A future `last_active_plan_id` migration may still be useful, but it was not required for this smoke-test drift.
- Desktop payments remains a ledger/review surface. Actual approval execution continues through planner approval cards.
