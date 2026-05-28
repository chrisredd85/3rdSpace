# QA Report

## Phase 1 Rev Share Settlement Checkpoint

Date: May 28, 2026  
Branch: `codex/money-flow-phase0`  
Range reviewed: Phase 1 commits 4-17, through `6e72729 feat(refunds): venue-initiated refund request and approval flow`

### Automated Gate

| Check | Result | Evidence |
|---|---:|---|
| `npx tsc --noEmit` | PASS | Clean before commit 17 and in pre-commit hook |
| `npx next lint` | PASS | Existing hook dependency warnings only; no errors |
| `npm test -- --passWithNoTests` | PASS | 76 suites / 450 tests passed in commit 17 hook |
| Focused refund route + webhook tests | PASS | `kickback-refund-routes`, `stripe-kickback-invoice-webhook` |
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
| Real Stripe test-mode invoice payment | NOT RUN | Requires test-mode connected builder account, venue customer, and webhook tunnel. |
| Real Stripe ACH/card invoice payment failure | NOT RUN | Requires Stripe-hosted invoice interaction in test mode. |
| Real transfer reversal + refund settlement | NOT RUN | Requires paid invoice charge and connected account balance in Stripe test mode. |
| Real screenshot fixture evals | NOT RUN | Requires Eventbrite, Luma, Partiful, Square, Toast, and handwritten fixture collection. Synthetic route/agent tests are passing. |
| Browser pass over dashboard refund modal | NOT RUN | UI compiles and tests pass, but no Playwright visual verification was run in this checkpoint. |

### Phase 1 Merge Notes

- No new files were added under `app/(dashboard)/**`; the existing venue payouts page was modified only.
- New planner-facing payment surfaces live under `app/(planner)/planner/payments`.
- New kickback money fields use integer cents. Legacy `amount` remains in place for old checkout rows.
- Kickback webhook paths are metadata-gated and do not process builder subscription invoices.
- Live Stripe and fixture-based extraction QA should be completed before production rollout.
