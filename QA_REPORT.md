# QA Report

## Phase 1 Rev Share Settlement Checkpoint

Date: May 28, 2026  
Branch: `codex/money-flow-phase0`  
Range reviewed: Phase 1 commits 4-17, through `6e72729 feat(refunds): venue-initiated refund request and approval flow`

### Automated Gate

| Check | Result | Evidence |
|---|---:|---|
| `npm run type-check` | PASS | Clean on May 28 after manual QA fixes |
| `npx next lint` | PASS | Existing hook dependency warnings only; no errors |
| `npm test -- --passWithNoTests` | PASS | 76 suites / 450 tests passed in commit 17 hook |
| Focused refund route + webhook tests | PASS | `venue-kickback-checkout-route`, `kickback-refund-routes`, `stripe-kickback-invoice-webhook`, `documentExtractionAgent` = 17 tests passing |
| Builder subscription webhook regression | PASS | Non-kickback `invoice.paid` routes to `applyInvoicePayment` unchanged |

### Rev Share Scenarios A-H

| Scenario | Status | Notes |
|---|---:|---|
| A. Organizer submits post-event attendance proof | PASS | Planner event-report endpoint supports image/PDF/CSV/XLS/XLSX, signed storage URLs, extraction, override, and agreement update. Covered by `planner-event-report-route` and post-event card tests. |
| B. Auto-pull attendance before manual upload | PASS | Eventbrite check-ins, Luma RSVP-only warning, and unavailable platform fallbacks are implemented and covered by `attendancePoll` tests. |
| C. Venue submits spend/revenue report | PASS | Venue spend-report endpoint extracts revenue, accepts override/no-file path, computes owed cents, and creates invoice-settlement kickback payment. Covered by `venue-spend-report-route`. |
| D. Venue invoice checkout | PASS | Checkout route coexists with legacy checkout, creates Stripe Invoice line items for principal + ACH processing fee, and emails venue. Covered by `venue-kickback-checkout-route`. |
| E. Invoice payment transfers 100% principal to builder | PASS | `invoice.paid` handler gates on `kickback_payment_id` + `settlement_method='invoice'`, creates builder transfer for principal only, and leaves subscription invoices untouched. Covered by `stripe-kickback-invoice-webhook`. |
| F. Invoice failure and notification | PASS | `invoice.payment_failed` marks kickback `invoice_failed` and does not call builder billing failure handling. Covered by `stripe-kickback-invoice-webhook`. |
| G. Venue compliance gate | PASS | Compliance helper, recommendations/listings/outreach filtering, cron route, and overdue warning emails are implemented with tests. Covered by `venueComplianceGate` and `venue-overdue-cron-route`. |
| H. Refund request, approval, and webhook settlement | PASS | Venue request route, builder approve/reject route, transfer reversal + charge refund, dashboard controls, and `charge.refunded` / `transfer.reversed` finalization are implemented. Covered by `kickback-refund-routes` and `stripe-kickback-invoice-webhook`. |

### Manual / External QA Still Required

| Area | Status | Reason |
|---|---:|---|
| Real Stripe test-mode invoice payment | ✅ PASS - May 28, 2026 | Paid hosted Stripe invoice `in_1TcCCXPhXltuVRpm5bcWtLv0`; DB reached `paid`; transfer `tr_1TcCInPhXltuVRpmNaFlbaVV` moved `51360` cents to builder Connect. |
| Real Stripe ACH/card invoice payment failure | ✅ PASS - May 28, 2026 | Failure card produced `invoice.payment_failed`; payment `10000000-0000-4000-8000-000000000502` reached `invoice_failed`; builder subscription snapshot unchanged; Resend failure email sent. |
| Real transfer reversal + refund settlement | ✅ PASS - May 28, 2026 | Partial refund `re_3TcCCYPhXltuVRpm189QILhG` and reversal `trr_1TcCQuPhXltuVRpmcFhZ10Yz`; DB reached `refunded_partial`; builder balance reduced by `20000` cents. |
| Real screenshot fixture evals | ✅ PASS - May 28, 2026 | Synthetic fixture set committed under `__tests__/fixtures/extraction/`; live `document_extraction` eval passed 10/10 value and confidence checks. |
| Browser pass over dashboard refund modal | ✅ PASS - May 28, 2026 | Playwright browser pass opened modal, validated amount/reason errors, submitted request, refreshed to `REFUND REQUESTED`, and captured no console/page errors. |

### Manual QA Prerequisites

| Check | Status | Evidence |
|---|---:|---|
| Local env | ⚠ PARTIAL | Stripe, Eventbrite client, Resend, Cron, Supabase, OpenAI, and notification sender are present. `EVENTBRITE_WEBHOOK_SECRET` is missing; not required for these five settlement checks. |
| Stripe CLI | PASS | `/opt/homebrew/bin/stripe`, version `1.42.1`. |
| Dev server readiness | PASS | `package.json` has `dev: next dev`; `node_modules` present; local server ran on `localhost:3000` after dynamic-route slug fix. |
| Test users | PASS | Builder `test-builder-phase1-qa@example.com` has active Connect account `acct_1TcCAVBsSJZVr0zq`; venue owner `test-venue-phase1-qa@example.com` owns `Phase 1 QA Venue` with Stripe customer `cus_UbP01MHhKoVGOS`. |
| Fixtures | PASS | `__tests__/fixtures/extraction/` contains Eventbrite, Luma, Partiful, Square, Toast, handwritten, CSV, PDF, XLSX, expected data, and eval result files. |

### Manual QA Evidence

#### Stripe Invoice Happy Path

| Field | Evidence |
|---|---|
| Payment row | `10000000-0000-4000-8000-000000000501` |
| Invoice | `in_1TcCCXPhXltuVRpm5bcWtLv0` |
| PaymentIntent / Charge | `pi_3TcCCYPhXltuVRpm1gG2Niyt` / `ch_3TcCCYPhXltuVRpm15Nl0wrb` |
| Transfer | `tr_1TcCInPhXltuVRpmNaFlbaVV` to `acct_1TcCAVBsSJZVr0zq` |
| Amounts | Invoice paid `51771` cents; builder payout `51360` cents; processing fee `411` cents stayed out of transfer. |
| DB/Stripe state | `kickback_payments.status=paid`, `paid_at` set, `builder_payout_cents=51360`, connected balance reached `51360` cents before refund. |

#### Stripe Failure Path

| Field | Evidence |
|---|---|
| Payment row | `10000000-0000-4000-8000-000000000502` |
| Invoice | `in_1TcCKJPhXltuVRpmf7RmdXvJ` |
| PaymentIntent / Charge | `pi_3TcCKKPhXltuVRpm0sOU2NcG` / `ch_3TcCKKPhXltuVRpm0l7w7IgC` |
| Webhook | `invoice.payment_failed` event `evt_1TcCLXPhXltuVRpmpI6zqt3E` |
| DB state | `status=invoice_failed`, `failed_at` set, no transfer created. |
| Regression check | `builder_subscriptions` stayed `0 -> 0`; builder profile remained `billing_tier=free_trial`, `subscription_status=trial`, no Stripe customer/subscription IDs. |
| Email | Resend email `34d06f2d-8f4f-446e-9379-3fad35fcf59a` to `test-venue-phase1-qa@example.com`, subject `Payment did not go through - Phase 1 QA Revenue Share Mixer`. |

#### Refund Settlement

| Field | Evidence |
|---|---|
| Refund request | Venue requested `20000` cents against payment `10000000-0000-4000-8000-000000000501`. |
| Refund / reversal | Refund `re_3TcCCYPhXltuVRpm189QILhG`; transfer reversal `trr_1TcCQuPhXltuVRpmcFhZ10Yz`. |
| Webhooks observed | `transfer.reversed`, `refund.created`, `charge.refunded`, `refund.updated`, `charge.refund.updated`. |
| DB state | `status=refunded_partial`, `refund_amount_cents=20000`, refund and reversal IDs populated. |
| Fee check | Original processing fee remained `411` cents; only principal payout was reversed/refunded. |
| Connect balance | Builder available balance moved from `51360` cents to `31360` cents. |
| Emails | Refund request email `cbec4fe0-5cf3-4597-8d5b-0519b5843534`; refund completed emails sent to builder and venue. |

#### Screenshot Fixture Eval

Source report: `__tests__/fixtures/extraction/eval-results.md`

| Fixture | Mode | Expected | Extracted | Confidence | Result |
|---|---|---:|---:|---|---:|
| `eventbrite-checked-in.png` | headcount | 58 | 58 | high | PASS |
| `eventbrite-rsvp-only.png` | headcount | 74 | 74 | low | PASS |
| `eventbrite-attendees.csv` | headcount | 58 | 58 | high | PASS |
| `eventbrite-ticket-sales.pdf` | headcount | 87 | 87 | high | PASS |
| `luma-rsvp.png` | headcount | 41 | 41 | medium | PASS |
| `partiful-going.png` | headcount | 36 | 36 | medium | PASS |
| `square-summary-1.png` | venue_revenue | 428000 | 428000 | high | PASS |
| `square-summary.xlsx` | venue_revenue | 428000 | 428000 | high | PASS |
| `toast-revenue.pdf` | venue_revenue | 582450 | 582450 | high | PASS |
| `handwritten-tab.jpg` | venue_revenue | 94750 | 94750 | low | PASS |

Pass rate: 10/10 value accuracy within 5%; 10/10 confidence labels matched expected values after prompt calibration.

#### Refund Modal Browser Pass

| Field | Evidence |
|---|---|
| URL | `http://localhost:3000/venue/payouts` |
| Fixture payment | `10000000-0000-4000-8000-000000000503` |
| Initial modal state | `Amount` prefilled `250.00`; reason field present; `Cancel` and `Send request` controls present. |
| Validation | `$0` amount showed `Refund amount must be greater than $0.00.`; missing reason showed `Add a reason for the refund request.` |
| Submit | `$100.00` request submitted; modal closed; row refreshed to `REFUND REQUESTED`. |
| DB state | `status=refund_requested`, `refund_amount_cents=10000`, reason saved, requester venue owner set. |
| Screenshots | `__tests__/fixtures/manual-qa/refund-modal-open.png`, `__tests__/fixtures/manual-qa/refund-modal-after-submit.png` |
| Browser diagnostics | No console errors and no page errors on final Playwright run. |

#### Bugs Found And Fixed During QA

| Area | Fix |
|---|---|
| Dev server route conflict | Normalized conflicting kickback dynamic API routes from `[kickbackId]` / `[paymentId]` to `[id]`; `npm run dev` now starts. |
| Invoice checkout persistence | Checkout route now fails loudly on Supabase update errors and no longer writes missing `updated_at` column. |
| Stripe invoice amount | Invoice creation now includes pending invoice items so hosted invoices charge principal + processing fee instead of zero-dollar invoices. |
| Webhook retry safety | Stripe webhook returns `500` on processing exceptions so Stripe can retry failed settlement work. |
| Refund race | Builder approval endpoint preserves terminal `refunded_partial` / `refunded_full` state if Stripe webhook finalizes before the route completes. |
| Extraction calibration | Document extraction prompt now accepts ticket-sales fallback counts and downgrades registered-only/handwritten confidence correctly; `temperature=0` for stable evals. |
| Browser console noise | Venue dashboard background fetches now ignore navigation-aborted `Failed to fetch` errors. |
| Dashboard payout formatting | Shared payout overview now formats builder/venue cent totals as dollars with cents instead of treating cents as dollars. |

### Phase 1 Merge Notes

- No new files were added under `app/(dashboard)/**`; the existing venue payouts page was modified only.
- New planner-facing payment surfaces live under `app/(planner)/planner/payments`.
- New kickback money fields use integer cents. Legacy `amount` remains in place for old checkout rows.
- Kickback webhook paths are metadata-gated and do not process builder subscription invoices.
- Manual Stripe invoice, failure, refund, extraction fixture, and refund modal QA passed on May 28, 2026.
- Merge recommendation: proceed after review of the included QA fixes and confirmation that the missing `EVENTBRITE_WEBHOOK_SECRET` is either configured before Eventbrite webhook rollout or explicitly deferred.
