# Money Flow Plan Sanity Check

Date: 2026-05-29

Branches inspected: `origin/main`, local `main`, local `codex/money-flow-phase0`, `origin/codex/rev-share-settlement-schema`, open PR #4, merged PRs #5/#6/#7/#8.

Latest main commit: `4b5c173 fix(planner): render billing gate on empty planner state (#8)`

## Audit Context

This is a fresh sanity check after PR #6, PR #7, PR #5, and PR #8 merged. It supersedes prior sanity check attempts. The Phase 0 + Phase 1 rev share work is now on `origin/main` as squash commit `dde7808`, not only in a draft PR. The older `codex/rev-share-settlement-schema` draft PR #4 is still open and appears stale/superseded by the merged Phase 0/1 work.

Current local repo note: the primary checkout is on `codex/fix-planner-empty-billing-modal` with its remote deleted, but its working tree content matches `origin/main`. The `main` branch is checked out in the nifty worktree at `/Users/chrisredd/3rdSpace.webapp/.claude/worktrees/nifty-mcclintock-968684`.

## Executive Summary

- 17 of 25 planned scopes have landed on main.
- Status breakdown: 14 done, 3 partial, 8 not started by design.
- Main contains Phase 0 + Phase 1 through PR #5 (`dde7808`), plus the billing/signup/timeline merges from PR #6/#7/#8.
- Highest-severity issue found: schema drift. The migrations add new cent/proof/invoice/refund columns, but `lib/types/database-generated.ts` does not expose many of them on the generated table types. Runtime tests pass because many routes cast Supabase clients/results to `any`, but the generated type contract is stale.
- Secondary issue: webhook isolation is mostly correct, but `transfer.created` / `transfer.updated` unconditionally calls the kickback transfer handler and can update by `stripe_transfer_id` without explicit namespace metadata.
- Recommendation: NEEDS REMEDIATION FIRST before Phase 2. Regenerate Supabase types from the migrated schema, tighten the transfer webhook namespace check, then start Phase 2.

## Per-Phase Status

### Phase 0 (3 commits)

Status: 1 done, 2 partial.

| ID | Description | Status | Location | Notes |
|---|---|:-:|---|---|
| P0.1 | Bump `freeEventsGranted` to 2 + add `checkPlanCreationAccess` to plan creation route | DONE | main via PR #7/#8 and PR #5 | `lib/billing/builder-billing.ts:10-14` sets `freeEventsGranted: 2`; `lib/billing/builder-billing.ts:209-263` exports `checkPlanCreationAccess`; `app/api/planner/plans/route.ts:171-184` returns 402 with `billingRequired`. Tests cover billing and planner persistence. |
| P0.2 | Cents normalization migration | PARTIAL | main via PR #5 (`dde7808`) | Migration exists at `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:7-47` and `:111-196`. However generated types are stale: `vendor_transactions` lacks the new cents columns at `lib/types/database-generated.ts:5926-5977`; `venues` lacks `hourly_rate_cents`, `daily_rate_cents`, `price_per_night_cents`, and `deposit_amount_cents` at `lib/types/database-generated.ts:6734-6908`. |
| P0.3 | Runtime cleanup: read/write cents and use `dollarsToCents()` at boundaries | PARTIAL | main via PR #5 (`dde7808`) | Core helper exists at `lib/money.ts:10-30`; vendor payments imports it at `lib/payments/vendor-payments.ts:3-10`. Still incomplete: `lib/server/account-setup.ts:426` uses inline `Math.round(input.basePrice * 100)`; `lib/planner/vendorEconomicsCosts.ts:259-262` has a second local `dollarsToCents`; `app/(planner)/planner/analytics/page.tsx:903-908` has local helpers. |

### Phase 1 (14 commits)

Status: 13 done, 1 partial.

| ID | Description | Status | Location | Notes |
|---|---|:-:|---|---|
| P1.4 | Kickback settlement schema migration with plan link and unique-index swap | PARTIAL | main via PR #5 (`dde7808`) | Migration exists: `supabase/migrations/20260527000002_kickback_settlement.sql:9-22`, `:94-112`, `:156-204`, `:350-398`. Generated types do not include the new agreement/payment/invite columns: see `lib/types/database-generated.ts:1629-1770`, `:2836-2905`, and `:6435-6522`. |
| P1.5 | Document extraction agent | DONE | main via PR #5 (`dde7808`) | `lib/ai/agents/documentExtractionAgent.ts:11-28` defines schemas; `:45-54` lists image/PDF/CSV/XLSX MIME types; `:213-253` parses PDFs; `:256-260` parses CSV/TSV. Tests and fixtures are present under `lib/ai/agents/__tests__/documentExtractionAgent.test.ts` and `__tests__/fixtures/extraction/`. |
| P1.6 | Planner event-report upload endpoint | DONE | main via PR #5 (`dde7808`) | `app/api/planner/plans/[planId]/event-report/route.ts:1-17` declares node runtime/bucket; `:237-248` loads plan-linked agreements; `:280-318` uploads proof and creates signed URL; `:321-335` calls extraction. Covered by `__tests__/integration/planner-event-report-route.test.ts`. |
| P1.7 | Venue spend-report upload endpoint with kickback calculation | DONE | main via PR #5 (`dde7808`) | `app/api/venue/kickbacks/[id]/spend-report/route.ts:72-100` handles POST/auth; `:268-299` calculates owed cents; `:319-358` uploads proof. Covered by `__tests__/integration/venue-spend-report-route.test.ts`. |
| P1.8 | Stripe Invoicing branch in venue kickback checkout | DONE | main via PR #5 (`dde7808`) | `app/api/venue/kickbacks/[id]/checkout/route.ts:87-94` branches invoice settlements; `:450-489` creates/reuses venue Stripe customers; metadata includes `payment_kind_namespace: 'venue_builder_kickback'` at `:475-481`. Covered by `__tests__/integration/venue-kickback-checkout-route.test.ts`. |
| P1.9 | `invoice.paid` -> builder transfer with kickback metadata gating | DONE | main via PR #5 (`dde7808`) | `app/api/webhooks/stripe/route.ts:172-237` gates invoice paid by `kickback_payment_id` and `settlement_method='invoice'`, then creates the builder transfer. Builder billing fallback is preserved at `:345-349`. Covered by `__tests__/integration/stripe-kickback-invoice-webhook.test.ts`. |
| P1.10 | Kickback notification wrappers around `lib/email` | DONE | main via PR #5 (`dde7808`) | Wrappers exist at `lib/email.ts:166`, `:187`, `:206`, and `:267`. Covered by `__tests__/email/kickback-notifications.test.ts`. |
| P1.11 | Include `kickback_projection_cents` in profit math | DONE | main via PR #5 (`dde7808`) | `lib/finance/eventPlanningEconomics.ts:40-49` includes `kickback_projection_cents`; `:123-140` adds it to revenue scenarios; `:147-170` calculates venue kickback projection. Economics agent includes it in narrative at `lib/ai/agents/economicsAgent.ts:192-196`. |
| P1.12 | `venueComplianceGate` helper + recommendation/listing/outreach filtering | DONE | main via PR #5 (`dde7808`) | `lib/planner/venueComplianceGate.ts:31-88` computes compliance; `:131-142` detects overdue report/invoice cases. Outreach imports it at `lib/planner/opportunityOutreach.ts:3-8`. Covered by `lib/planner/__tests__/venueComplianceGate.test.ts`. |
| P1.13 | Post-event report card and planner payments surface | DONE | main via PR #5 (`dde7808`) | `components/planner/PostEventReportCard.tsx:57-120` loads status; `:122-160` submits report; `:293-324` renders ticketing-poll notices. Planner payments ledger uses payout rows at `app/(planner)/planner/payments/page.tsx:1-29` and `:316-370`. Note: existing dashboard pages were modified, but no new `(dashboard)` routes were added. |
| P1.14 | Daily venue overdue check with shared secret | DONE | main via PR #5 (`dde7808`) | `app/api/internal/cron/venue-overdue-check/route.ts:27-33` enforces `CRON_SECRET`; `:69-123` scans venues and updates notification counts. `vercel.json:1-7` schedules it daily. Covered by `__tests__/integration/venue-overdue-cron-route.test.ts`. |
| P1.15 | Auto-pull attendance from Eventbrite and Luma | DONE | main via PR #5 (`dde7808`) | `lib/ticketing/attendancePoll.ts:94-114` dispatches Eventbrite/Luma polling. Covered by `lib/ticketing/__tests__/attendancePoll.test.ts`. |
| P1.16 | CSV, XLSX, and PDF support in document extraction agent | DONE | main via PR #5 (`dde7808`) | `lib/ai/agents/documentExtractionAgent.ts:198-207` routes PDF/CSV/spreadsheet inputs; dependencies are in PR #5 package changes; fixtures include CSV/PDF/XLSX. Covered by extraction tests and fixture eval report. |
| P1.17 | Venue-initiated refund request and approval flow | DONE | main via PR #5 (`dde7808`) | Venue route: `app/api/venue/kickbacks/[id]/refund-request/route.ts:26-84`. Builder decision route: `app/api/planner/plans/[planId]/refund-decision/route.ts:34-80`. Webhook finalization is at `app/api/webhooks/stripe/route.ts:261-291` and `:421-449`. Covered by `__tests__/integration/kickback-refund-routes.test.ts` and webhook tests. |

### Phase 2 (5 commits)

Status: 0 of 5 done - NOT STARTED.

| ID | Description | Status | Location | Notes |
|---|---|:-:|---|---|
| P2.18 | Venue rental payment schema | MISSING | Not found | NOT STARTED - scheduled after Phase 0/1. No `venue_payment_transactions` references found in app/lib/tests/migrations. |
| P2.19 | Builder-initiated venue rental checkout | MISSING | Not found | NOT STARTED - no `venue_rental` namespace or route found. |
| P2.20 | Venue rental checkout webhook transfer | MISSING | Not found | NOT STARTED - no `payment_kind_namespace = 'venue_rental'` handling found. |
| P2.21 | Venue rental refund flow | MISSING | Not found | NOT STARTED. Existing refund work is for kickback settlement, not rental payment. |
| P2.22 | Planner approval cards + venue rental ledger entry | MISSING | Not found | NOT STARTED. Current planner payment ledger is venue-to-builder revenue share only. |

### Phase 3 (3 commits)

Status: 0 of 3 done - NOT STARTED.

| ID | Description | Status | Location | Notes |
|---|---|:-:|---|---|
| P3.23 | Canonicalize vendor payment path | MISSING | Not found | NOT STARTED. Existing `/api/payments/vendor` direct-destination route still exists and is tested by `__tests__/payments/vendorStripeReconnectRoute.test.ts`. |
| P3.24 | Wire planner approval cards to vendor payment flow | MISSING | Not found | NOT STARTED. No new planner approval-to-vendor-payment wiring found. |
| P3.25 | Vendor payment ledger entries on planner payments page + builder ledger | MISSING | Not found | NOT STARTED. Planner payments page currently surfaces builder kickback payouts, not vendor payments. |

## Cross-Phase Findings

### CI-1 Webhook Isolation: RISK

Invoice and PaymentIntent kickback branches are mostly isolated:

- Checkout sessions require `payment_kind='venue_builder_kickback'` before kickback handling at `app/api/webhooks/stripe/route.ts:54-58`.
- PaymentIntents require `payment_kind='venue_builder_kickback'` at `app/api/webhooks/stripe/route.ts:98-102`.
- Invoice paid/payment failed require `kickback_payment_id` and `settlement_method='invoice'` at `app/api/webhooks/stripe/route.ts:172-175` and `:240-243`.
- Builder subscription invoice handlers remain fallback-only when kickback invoice handlers return false at `app/api/webhooks/stripe/route.ts:345-363`.

Risk: `transfer.created` and `transfer.updated` call `applyKickbackTransferEvent` unconditionally at `app/api/webhooks/stripe/route.ts:435-437`. The helper can update by `stripe_transfer_id` even when no `kickback_payment_id` is present (`app/api/webhooks/stripe/route.ts:150-169`). This is not currently broken by tests, but it violates the stricter namespace-isolation rule and should be tightened before adding venue rental/vendor payment webhook namespaces.

No Phase 2/3 namespaces exist yet, so there is no `venue_rental` or `vendor_payment` webhook branch to validate.

### CI-2 Money Units: RISK

Core new payment work mostly uses cents and the canonical helper:

- `lib/money.ts:10-30` exports `dollarsToCents`, `centsToDollars`, and read helpers.
- `lib/payments/vendor-payments.ts:3-10` imports these helpers and `:75-87` stores/returns cents values.
- Venue spend calculations use cents at `app/api/venue/kickbacks/[id]/spend-report/route.ts:268-299`.

Remaining violations/debt:

- KNOWN_DEBT: `lib/server/account-setup.ts:426` stores vendor signup `base_rate` through inline `Math.round(input.basePrice * 100)`.
- Duplicate helper: `lib/planner/vendorEconomicsCosts.ts:259-262` defines its own local `dollarsToCents`.
- Duplicate helper: `app/(planner)/planner/analytics/page.tsx:903-908` defines local money helpers.
- Planner parsing still contains inline dollar-to-cent heuristics in `app/api/planner/plans/route.ts:777` and `:935`, `app/api/planner/plans/[planId]/messages/route.ts:1073` and `:1497`, and `components/planner/PlannerLivePlanPanel.tsx:1660`, `:1675`, `:1704`.

The system is operational, but P0.3's "no implicit casts" intent is not fully complete.

### CI-3 AGENTS.md: COMPLIANT WITH NOTE

No new route files were added under `app/(dashboard)/**` since `21c50eb`. The diff since that point shows modifications to existing dashboard pages only:

- `app/(dashboard)/vendor/payouts/page.tsx`
- `app/(dashboard)/venue/page.tsx`
- `app/(dashboard)/venue/payouts/page.tsx`
- `app/(dashboard)/venue/pricing/page.tsx`

New planner surfaces landed under `app/(planner)/**`, including `app/(planner)/planner/payments/page.tsx` and planner page updates. This respects the "do not expand `(dashboard)`" route rule, with the caveat that existing legacy pages were edited for payout/refund visibility.

### CI-4 Schema Drift: BROKEN

Migrations and runtime code reference new columns, but generated types are stale.

Examples:

- `event_kickback_agreements` migration adds `plan_id`, proof/revenue fields, and share percent fields at `supabase/migrations/20260527000002_kickback_settlement.sql:9-22`; generated type block at `lib/types/database-generated.ts:1629-1770` has none of those fields.
- `kickback_payments` migration adds `amount_cents`, `settlement_method`, invoice, fee, payout, paid, and refund fields at `supabase/migrations/20260527000002_kickback_settlement.sql:94-112`; generated type block at `lib/types/database-generated.ts:2836-2905` only shows legacy fields plus `stripe_transfer_reversal_id`.
- `venues` migration adds `stripe_customer_id` and `last_overdue_count_notified` at `supabase/migrations/20260527000002_kickback_settlement.sql:350-352`; generated type block at `lib/types/database-generated.ts:6734-6908` does not show either field.
- Money normalization migration adds `vendor_transactions.amount_cents`, `platform_fee_cents`, `stripe_fee_cents`, and `vendor_payout_cents` at `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:7-11`; generated type block at `lib/types/database-generated.ts:5926-5977` does not show them.
- Money normalization migration adds venue cents fields at `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:111-115`; generated type block at `lib/types/database-generated.ts:6734-6908` does not show them.
- `venue_opportunity_invites.blocked_reason` is added at `supabase/migrations/20260527000002_kickback_settlement.sql:373-398`; generated type block at `lib/types/database-generated.ts:6435-6522` does not show it.

The helper files from PR #7 do not add new table-column drift: `lib/planner/venueHold.ts:27-34` reads existing `agent_actions`; `lib/planner/byoVendors.ts:17-44` stores BYO data in plan metadata; `lib/planner/userPreferenceSignals.ts:51-68` writes metadata signals only.

### CI-5 Regression: PASS

Command:

```bash
npx jest __tests__/integration/mvp-launch-contracts.test.ts lib/billing/__tests__/builder-billing.test.ts __tests__/integration/booking-flow.test.tsx lib/planner/__tests__/timelineDerivation.test.ts
```

Result: 4 suites passed, 33 tests passed.

### CI-6 Gates: PASS

- `npx tsc --noEmit`: PASS, no output.
- `npx next lint`: PASS with existing React hook dependency warnings, no errors.
- `npx jest`: PASS, 77 suites / 473 tests.

### CI-7 PR Coordination: RISK

Open PRs targeting main:

- PR #4 `feat(payments): rev share settlement schema and QA fixtures`, branch `codex/rev-share-settlement-schema`, draft.

Merged PRs relevant to this audit:

- PR #5 `feat(payments): rev share settlement with screenshot extraction and Stripe Invoicing` merged as `dde7808`.
- PR #6 `fix(signup): wire venue and vendor pricing fields through signup` merged as `c74c3e3`.
- PR #7 `feat(planner): timeline rebuild, tab routing, billing gate UX` merged as `ef3eed1`.
- PR #8 `fix(planner): render billing gate on empty planner state` merged as `4b5c173`.

PR #6 overlaps semantically with P0 cents normalization in `lib/server/account-setup.ts`; the current result works, but the `basePrice * 100` conversion remains known P0.3 debt.

PR #7's billing/timeline work is now canonical on main. The local historical `codex/money-flow-phase0` branch contains an extra follow-up commit `0979e86 fix(billing): use exported checkPlanCreationAccess in plans route`, but the merged squash result already resolved that integration.

PR #4 appears stale/superseded and should be closed or explicitly reconciled before Phase 2 begins so reviewers do not confuse old schema-only work with the merged Phase 0/1 implementation.

## Anomalies Discovered

- Schema/generated types drift is real and visible in multiple table blocks. This is the main remediation item.
- Runtime code often uses `as any` for Supabase writes/reads in the new kickback routes, which allowed tests and TypeScript to pass despite stale generated types.
- The primary local checkout is on a now-deleted branch (`codex/fix-planner-empty-billing-modal`) but has no working-tree diff against `origin/main`.
- Open draft PR #4 is likely superseded by merged PR #5 and should not be left open without a label/comment explaining its state.
- Existing dashboard pages were modified for payout/refund visibility. This does not violate the "no new `(dashboard)` routes" rule, but it is still legacy-surface churn.
- Phase 2 and Phase 3 are not implemented, which is expected by the plan.

## Phase Readiness

1. Is the codebase ready to begin Phase 2?

Not cleanly yet. The runtime/test state is green, but Phase 2 adds another money namespace and schema. Regenerate `lib/types/database-generated.ts` after applying/confirming the Phase 0/1 migrations, and tighten transfer webhook gating before adding venue rental payments.

2. Is the codebase ready to begin Phase 3?

Not yet. Phase 3 should wait until Phase 2's venue-rental payment namespace is defined and the existing `/api/payments/vendor` path is explicitly deprecated or wrapped. The current vendor payment route remains active and should be treated as legacy until P3.23.

3. Minimum work that must merge before Phase 2 starts:

- Regenerate and commit Supabase generated types for migrations `20260527000001` and `20260527000002`.
- Add a small webhook isolation patch for `transfer.created` / `transfer.updated` / `transfer.reversed` so non-kickback transfers are ignored unless metadata explicitly marks them as kickback.
- Close or reconcile stale PR #4.
- Decide whether P0.3 money helper consolidation is required before Phase 2 or can remain a tracked P2 debt.

## Recommended Next Steps

1. P0 - Regenerate Supabase generated types.
   - Files: `lib/types/database-generated.ts`.
   - Reason: Required schema columns are missing from generated types even though routes/migrations use them.
   - New spec needed: no, this is a mechanical follow-up.
   - Estimated effort: 30-60 minutes plus hosted schema verification.

2. P1 - Tighten Stripe transfer webhook namespace gating.
   - File: `app/api/webhooks/stripe/route.ts`.
   - Action: For `transfer.created` / `transfer.updated`, return ignored unless `transfer.metadata.kickback_payment_id` exists and the settlement namespace/method is expected. For `transfer.reversed`, keep the refund path but ignore non-kickback transfers.
   - New spec needed: no.
   - Estimated effort: 30-45 minutes plus webhook tests.

3. P1 - Reconcile stale PR #4.
   - Action: Close it as superseded by PR #5 or rebase only if it contains truly missing fixture/schema evidence.
   - New spec needed: no.
   - Estimated effort: 10 minutes.

4. P2 - Consolidate money helpers and remove inline conversions.
   - Files: `lib/server/account-setup.ts`, `lib/planner/vendorEconomicsCosts.ts`, `app/(planner)/planner/analytics/page.tsx`, planner parsing helpers.
   - Action: Use canonical `lib/money.ts` helpers or explicitly document parser heuristics where values may be dollars or cents.
   - New spec needed: light cleanup spec recommended.
   - Estimated effort: 2-3 hours.

5. P2 - Start Phase 2 with schema-first PR.
   - Files: new migration for `venue_payment_transactions`, generated types, and tests.
   - Action: Open a draft PR after the schema commit before adding checkout/webhook/UI.
   - New spec needed: yes, to define namespace metadata and refund lifecycle.
   - Estimated effort: 1-2 days for Phase 2.

## Open Questions

- Has the hosted Supabase production/staging database actually applied `20260527000001` and `20260527000002`? This audit did not run migrations or query live DB state by rule.
- Should PR #4 be closed as superseded now, or does it contain any fixtures the team still wants to preserve separately?
- Should P0.3 helper consolidation block Phase 2, or is the team comfortable carrying it as tracked debt while adding venue rental payments?
- For Phase 2, should venue rental payments share the existing `payment_intents` table or require a dedicated `venue_payment_transactions` ledger as the original plan says?
