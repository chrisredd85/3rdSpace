# Revenue Share Settlement QA Report

Date: 2026-05-27
Branch: `codex/rev-share-settlement-schema`
Scope: repeat-organizer revenue share settlement QA for the 3rdPlace planner and venue payout system.

## Executive Summary

Status: ❌ fail / implementation incomplete.

The current branch builds and the existing test suite passes, but the requested real repeat-organizer settlement system cannot complete end-to-end. The branch currently contains the settlement schema migration, legacy checkout-compatible kickback paths, and a deterministic extraction fixture pack. The key runtime pieces required by the QA prompt are missing: document extraction agent, event-report upload route, venue spend-report route, invoice settlement branch, refund request/decision routes, venue overdue cron, compliance gate helper, Eventbrite/Luma post-event polling helpers, and the multi-event planner payments ledger UI.

This report is intentionally the first QA deliverable so the PR records the gap before fixtures or follow-up test work are added.

## Local Validation

| Check | Result | Notes |
|---|---:|---|
| `npx tsc --noEmit` | ✅ pass | No TypeScript errors. |
| `npx next lint` | ⚠ pass with warnings | Existing React hook dependency warnings in planner/auth/venue components. |
| `npx jest` | ✅ pass | 61 suites, 399 tests passed. No requested rev-share settlement tests exist yet. |
| `npm run build` | ✅ pass | Production build completed; same lint warnings. |

Local env availability after sourcing `.env.local`:

| Secret | State |
|---|---|
| Supabase URL / anon / service role | set |
| Stripe secret / primary webhook secret | set |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | missing |
| `RESEND_API_KEY` | missing |
| `WORKER_SECRET` | missing |

Staging/browser E2E was not executed because the feature endpoints needed for the scenarios are not present, and email/worker secrets required for Resend and secured cron validation are missing locally.

## Implementation Evidence

Existing settlement-related runtime files:

- `app/api/venue/kickbacks/[paymentId]/checkout/route.ts`
- `app/api/venue/kickbacks/summary/route.ts`
- `app/api/builder/payouts/summary/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `supabase/migrations/20260527000000_kickback_settlement_schema.sql`

Missing requested runtime files/routes:

- `app/api/planner/plans/[planId]/event-report/route.ts`
- `app/api/venue/kickbacks/[paymentId]/spend-report/route.ts`
- `app/api/venue/kickbacks/[paymentId]/refund-request/route.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.ts`
- `app/api/internal/cron/venue-overdue-check/route.ts`
- `lib/ai/agents/documentExtractionAgent.ts`
- `lib/planner/venueComplianceGate.ts`
- `lib/ticketing/eventbritePoll.ts`
- `lib/ticketing/lumaPoll.ts`
- `scripts/seed-test-fixtures.ts`
- `__tests__/fixtures/extraction/**`

Important current behavior:

- `app/(planner)/planner/payments/page.tsx` is still a static placeholder. It does not load builder payout summary, pending invoice rows, refund decisions, paid-month breakdowns, sortable rows, or detail drawers.
- `app/api/webhooks/stripe/route.ts` routes `invoice.payment_succeeded` and `invoice.payment_failed` only through builder subscription billing. There is no `metadata.kickback_payment_id` invoice branch.
- The legacy kickback checkout path updates statuses to `processing` and `completed`; it does not create Stripe Invoices, ACH fees, invoice emails, invoice failure recovery, or transfer retry state.
- Venue catalog/recommendation/outreach code does not filter non-compliant venues using overdue settlement count. `venue_blocked_compliance` exists in the new migration constraint, but no runtime gate enforces it.
- `calculateEventPlanningEconomics` has no `kickback_projection_cents` input/output. The separate event financial recalc path has venue kickback projection support, but the requested economics-agent regression is not implemented in the planning economics helper.

## Scenario Results

| Scenario | Result | Finding |
|---|---:|---|
| A. Repeat organizer first 6 events lifecycle | ❌ fail | Event report route, extraction, invoice creation, venue spend report upload, Resend verification, invoice payment transfer, and planner payments ledger are missing. |
| B. Venue compliance gate | ❌ fail | Schema fields exist, but no overdue cron, no compliance helper, no public catalog filter, no recommend filter, and no outreach skip implementation. |
| C. Refund flow | ❌ fail | Refund request and planner refund-decision routes are missing. Webhook refund handling only delegates planner deposit refund logic or marks legacy transfers refunded. |
| D. Webhook safety | ⚠ partial | Subscription invoice routing remains present. Kickback invoice metadata routing is absent, so the positive kickback invoice path cannot pass. |
| E. Stripe failure modes | ❌ fail | Legacy checkout failure has some PaymentIntent failure handling, but invoice failure, transfer retry, builder capability loss emails, and missing venue contact-email invoice guard are not implemented. |
| F. Multi-event organizer dashboard | ❌ fail | Planner payments page is a static control-center placeholder, not a rev-share ledger. |
| G. Economics agent regression | ❌ fail | Planning economics output does not include `kickback_projection_cents`; expected $288 projection is not represented. |
| H. Cron + job system | ❌ fail | No `/api/internal/cron/venue-overdue-check`; job runner does not distinguish compliance skip/sent/failed for venue invites. |

## Requested Jest/Test Fixture Coverage

Status: ⚠ partial. Fixture files are now present, but the requested unit and integration tests are not present yet.

Missing requested unit tests:

- `lib/ai/agents/documentExtractionAgent.test.ts`
- `lib/planner/venueComplianceGate.test.ts`
- `lib/ticketing/eventbritePoll.test.ts`
- `lib/ticketing/lumaPoll.test.ts`
- expanded `lib/finance/eventPlanningEconomics.test.ts` coverage for five commercial models and missing rates

Missing requested integration tests:

- `app/api/planner/plans/[planId]/event-report/route.test.ts`
- `app/api/venue/kickbacks/[paymentId]/spend-report/route.test.ts`
- `app/api/venue/kickbacks/[paymentId]/checkout/route.test.ts`
- `app/api/venue/kickbacks/[paymentId]/refund-request/route.test.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.test.ts`
- `app/api/webhooks/stripe/route.test.ts`

Committed requested fixtures:

- `eventbrite-checked-in-58.png`
- `eventbrite-only-rsvps.png`
- `luma-going-87.png`
- `partiful-going.png`
- `square-net-4280.png`
- `toast-net-3140.png`
- `clover-summary.png`
- `handwritten-tab.jpg`
- `eventbrite-attendees.csv`
- `toast-revenue.xlsx`
- `pos-report.pdf`
- `scanned-receipt.pdf`
- `encrypted.pdf`
- `empty.csv`
- `__tests__/fixtures/extraction/README.md`

Fixture verification performed:

- `eventbrite-attendees.csv` has 58 `checked_in = true` rows.
- `toast-revenue.xlsx` has `Daily Summary!B7 = 3140`.
- `encrypted.pdf` is encrypted.
- `pos-report.pdf` has one text-extractable page.
- `square-net-4280.png` renders at 1200x760 with the expected net sales value.

I am not adding failing route tests in this fixture commit because they would intentionally break the currently passing suite. They should be added with the implementation slices they guard, or as skipped/pending specs if the next PR is intended to be a red-test scaffold.

## Repeat Organizer UX Notes

| Behavior | Result | UX impact |
|---|---:|---|
| Templating / event 4 faster than event 1 | ⚠ unverified | Existing templates route exists, but the settlement flow does not use prior settlement settings or reporting preferences. |
| Trust calibration | ❌ missing | No extraction confidence UI exists for report uploads. |
| Payout latency clarity | ❌ missing | Planner payments page does not show "Transferred to your bank - arrives in 2-3 business days." |
| Failure recovery when venue ghosts | ❌ missing | No overdue compliance/remediation path exists for the organizer. |
| Organizer-side compliance opacity | ❌ missing | No runtime block/filter exists, so the desired "isn't accepting bookings right now" behavior cannot be verified. |
| Refund clarity | ❌ missing | Refund request UI and reason/amount context are absent. |
| History as proof | ❌ missing | Ledger cannot answer Q1 rev-share income or accountant-style proof questions. |

## Performance Notes

Extraction performance could not be measured because no document extraction agent, upload routes, fixtures, or extraction logs exist yet. Required future measurements:

- 5MB image extraction latency.
- 10-page text PDF latency.
- scanned PDF render-to-vision latency.
- CSV/XLSX text-mode parsing latency with confirmation that no vision run is logged.

## Recommended Follow-Up Implementation Order

1. Add the extraction fixtures and README, plus deterministic CSV/XLSX/PDF text-mode parsers.
2. Add `documentExtractionAgent` with fixture-backed tests before wiring uploads.
3. Build `event-report` and `spend-report` routes using private storage and service-role uploads.
4. Add invoice settlement branch for `kickback_payments.settlement_method = 'invoice'`, preserving existing checkout behavior.
5. Add Stripe invoice webhook routing keyed by `metadata.kickback_payment_id`, with tests proving builder subscription invoices do not touch `kickback_payments`.
6. Add refund request/decision routes and UI on planner payments.
7. Add `venueComplianceGate`, overdue cron, and outreach/recommendation/public catalog filters.
8. Replace the planner payments placeholder with the repeat-organizer ledger, sorting, details, refund decisions, and payout-latency copy.
9. Add Eventbrite/Luma post-event poll helpers and override audit fields.
10. Extend planning economics with explicit `kickback_projection_cents` and commercial-model tests.

## Acceptance Gate State

| Gate | Result |
|---|---:|
| 1. `npx tsc --noEmit` | ✅ pass |
| 2. `npx next lint` | ⚠ pass with warnings |
| 3. `npx jest` | ✅ pass |
| 4. Scenario A end-to-end on staging | ❌ not possible |
| 5. Scenario B compliance flow | ❌ not implemented |
| 6. Scenario C refunds | ❌ not implemented |
| 7. Scenario D webhook routing safety | ⚠ partial |
| 8. Scenario E Stripe failure modes | ❌ not implemented |
| 9. Scenario F dashboard | ❌ not implemented |
| 10. Scenario G economics kickback projection | ❌ not implemented |
| 11. Scenario H cron secured + functional | ❌ not implemented |
| 12. Fixture screenshots expected extractions | ⚠ fixture files present; extraction code missing |
| 13. Stripe test receipts/invoices/transfers/refunds | ❌ not generated |
| 14. Resend logs | ❌ blocked by missing `RESEND_API_KEY` and missing email paths |
| 15. No orphaned `kickback_payments` rows | ⚠ not checked against staging |
| 16. No billing regression | ⚠ local tests pass, but required webhook regression tests are missing |
