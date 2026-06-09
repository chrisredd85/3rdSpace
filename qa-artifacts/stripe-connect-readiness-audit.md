# Stripe / Connect readiness audit

Audit date: 2026-06-08

Working branch: `codex/stripe-readiness-audit`

Base proof: after `git fetch origin`, `HEAD`, `merge-base HEAD origin/main`, and
`origin/main` were all `fc61e49e5426caf1c9139349bfa7a6f3db503114`.

Scope: Phase 1 audit only. No production code changes are included in this PR.

Assumptions honored:

- The Stripe platform account itself is assumed live-ready.
- The builder connected account is assumed fully onboarded unless code evidence says otherwise.
- `codex/outreach-phase-5` was not used as an implementation base.
- Env validation findings below are scoped to server/payment entrypoints, not a global boot-time check.
- Duplicate webhook proof should use saved signed fixtures or Stripe Dashboard replay/resend. Stripe CLI `stripe trigger` is useful for event shape smoke tests, but not proof of duplicate same-event-id handling by itself.
- Multi-table DB writes for one money-state change should move into a Supabase RPC/Postgres transaction. Stripe external calls cannot be part of that DB transaction and need deterministic idempotency keys plus retry/recovery.
- Preview Connect onboarding may not always end with `charges_enabled = true`; tests should assert the configured expected state for the account/capability setup being used.

## Section 1 - Current state matrix

| Verification item | Status | Evidence | Main gap |
|---|---:|---|---|
| Builder Community Host Incentive / kickback payout readiness | 🟡 Partial | Builder Connect rows exist; `/api/builder/payouts/summary` reads kickback payment readiness; venue kickback checkout/invoice flows exist. Invoice-paid webhook transfers principal to builder at `app/api/webhooks/stripe/route.ts:230`. | Invoice-paid transfer lacks a Stripe idempotency key and DB write recovery; refund reversal paths also lack idempotency. |
| Builder connected account onboarding/status | 🟡 Partial | `/api/builder/stripe/*` routes exist, mirror the vendor/venue Connect pattern, and `builder_stripe_accounts` exists with RLS. | State model is only `pending/active/restricted`; no tracked `onboarding_started`, `capabilities_pending`, or disabled substate. |
| Venue payment / venue revenue-share settlement readiness | 🟡 Partial | Venue rental Checkout creates destination-payment Checkout sessions with cents and idempotency at `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:506`; venue kickback settlement has Checkout and invoice paths. | Host-facing venue rental Checkout does not accept or validate an `approval_id`; settlement/invoice writes are not transactional. |
| Vendor payout readiness | 🟡 Partial | Vendor Connect onboarding exists; `ensureVendorCanReceivePayments` validates Connect account mode/state; `createVendorTransfer` uses a transfer idempotency key. | Legacy direct vendor payment route can confirm a PaymentIntent without approval and without Stripe idempotency key. |
| Approval-gated planner deposit execution | ✅ Working | `/api/planner/plans/[planId]/payments/authorize` validates approval status, reapproval freshness, amount cents, and action transition; `/api/payments/capture` requires `explicitUserConfirmation: true`. Tests exist in `__tests__/integration/planner-deposit-execution-routes.test.ts`, `lib/planner/__tests__/depositPayments.test.ts`, and `lib/planner/execution/__tests__`. | `maybeCreateStripeManualPaymentIntent` silently returns `null` when `STRIPE_SECRET_KEY` or payment method is missing at `lib/planner/depositPayments.ts:233`; production payment entrypoints should fail explicitly. |
| Webhook-driven payment status sync | 🟡 Partial | Platform webhook routes Checkout, invoice, payment intent, and charge refund events at `app/api/webhooks/stripe/route.ts:522`. Venue rental, kickback, billing, and planner deposit webhook tests exist. | No persistent event ledger/dedup is used by either Stripe webhook route. |
| Webhook-driven transfer/payout/refund sync | 🟡 Partial | Transfer and refund handlers exist; payout events are accepted/observed. Namespace isolation tests exist in `__tests__/integration/stripe-kickback-invoice-webhook.test.ts`. | Payout events are not persisted; refund/reversal API calls lack idempotency keys; no duplicate-event ledger. |
| Connect account update sync | 🟡 Partial | `/api/webhooks/stripe/connect` exists, uses `STRIPE_CONNECT_WEBHOOK_SECRET`, and syncs `account.updated` through `lib/stripe/connect-webhook.ts`. | Signature verification happens after rate-limit DB mutation; capability/payout events are observed only; no in-flight payment blocking when account becomes restricted. |
| UI propagation after Stripe state changes | ❓ Unknown | UI surfaces exist for `/planner/payments`, `/planner/billing`, `/vendor/payouts`, `/venue/payouts`, and status endpoints. | No end-to-end test proves webhook -> DB -> next UI render without manual refresh. |

## Section 2 - Idempotency audit

### Existing ledger

`stripe_webhook_events` already exists in `supabase/migrations/20260420000000_remote_baseline.sql:1090` with a unique `stripe_event_id` at `:1712`. It is not used by `app/api/webhooks/stripe/route.ts` or `app/api/webhooks/stripe/connect/route.ts`.

Current table gaps for the proposed hardening:

- No `source` column to distinguish platform vs Connect endpoints.
- No `livemode`.
- No structured `processing_outcome`.
- `payload jsonb not null` encourages storing full payloads, which is not needed for production observability.
- RLS is enabled, but there is no explicit service-role-only policy in the baseline snippet. Service role bypasses RLS, but future admin views should be explicit and read-only.

### Webhook routes

| Route / event family | Persistent event-id dedup | Safe if same event runs twice | Stripe idempotency keys for created Stripe state | Notes |
|---|---:|---:|---:|---|
| `/api/webhooks/stripe/connect` all events | ❌ | 🟡 Some | N/A | Route creates a service-role client and consumes the DB-backed rate limit before signature verification at `app/api/webhooks/stripe/connect/route.ts:18-42`. |
| Connect `account.updated` | ❌ | 🟡 Mostly | N/A | Upserts account rows, but mirrored profile updates are separate writes in `lib/stripe/connect.ts:188` and `:223`; errors are not checked. |
| Connect `account.application.deauthorized` | ❌ | 🟡 Mostly | N/A | Repeated restriction updates are usually safe, but no event ledger and no downstream in-flight payment blocking. |
| Connect `capability.updated`, `payout.*` | ❌ | ✅ No mutation | N/A | Currently returns `{ observed }` only at `lib/stripe/connect-webhook.ts:111`. No persisted payout/capability state. |
| `/api/webhooks/stripe` all events | ❌ | 🟡 Some | 🟡 Some | Route also runs rate limiting before signature verification at `app/api/webhooks/stripe/route.ts:491-516`. |
| `checkout.session.completed` | ❌ | 🟡 Some | N/A | Venue rental and kickback handlers appear state-aware; builder billing behavior needs ledger-level proof. |
| `invoice.paid` kickback invoice | ❌ | ❌ | ❌ | Creates a Stripe transfer at `app/api/webhooks/stripe/route.ts:230` without an idempotency key, then updates DB. A DB failure after transfer can duplicate transfer on Stripe retry. |
| `payment_intent.succeeded/payment_failed` | ❌ | 🟡 Some | N/A | Handlers are status-aware but rely on local row status, not event-id dedup. |
| `charge.refunded` | ❌ | 🟡 Some | N/A | Existing tests cover status transitions, not duplicate event ledger behavior. |
| `transfer.created/updated/reversed` | ❌ | 🟡 Some | N/A | Namespace isolation exists, but no persistent event-id dedup. |
| `payout.paid/failed` platform | ❌ | ✅ No mutation | N/A | Observed only; no UI-visible payout history or ledger record. |
| `account.updated` platform route | ❌ | 🟡 Mostly | N/A | Duplicates the Connect sync path. This is useful if events arrive on platform endpoint, but ownership of account events should be explicit. |

### Stripe API calls that create state

| Code path | API call | Idempotency key | Finding |
|---|---|---:|---|
| Planner deposit authorization | `paymentIntents.create` | ✅ `planner_deposit_${approval.id}_${amountCents}` | Good, but missing env/payment method currently creates local-only requested state. |
| Venue rental Checkout | `checkout.sessions.create` | ✅ `venue_rental_checkout_${transaction.id}_${method}_${amount}_${fee}` | Good, though update after Stripe call needs recovery. |
| Vendor booking create-intent | `paymentIntents.create` | ✅ `vendor_booking_${booking.id}_${paymentType}_${amountCents}` | Good key; still no approval ID. |
| Direct vendor service payment | `paymentIntents.create` | ❌ | P0 before real money. `app/api/payments/vendor/route.ts:179`. |
| Platform fee payment | `paymentIntents.create` | ❌ | P0/P1 depending launch scope. `app/api/payments/platform-fee/route.ts:166`. |
| Vendor transfer helper | `transfers.create` | ✅ `vendor_transfer_${transaction.id}` | Good helper-level behavior. |
| Kickback invoice-paid transfer | `transfers.create` | ❌ | P0. `app/api/webhooks/stripe/route.ts:230`. |
| Vendor refund route | `refunds.create`, `transfers.createReversal` | ❌ | P0. `app/api/payments/refund/route.ts:74` and `:93`. |
| Cancellation refund process | `refunds.create`, reversal helper | ❌ | P0. `app/api/payments/refund/process/route.ts:106` and `:176`. |
| Kickback refund decision | `transfers.createReversal`, `refunds.create` | ❌ | P0. `app/api/planner/plans/[planId]/refund-decision/route.ts:200` and `:208`. |
| Venue rental refund decision | `transfers.createReversal`, `refunds.create` | ❌ | P0. `app/api/venue/rentals/[transactionId]/refund-decision/route.ts:238` and `:242`. |
| Venue kickback Checkout | `checkout.sessions.create` | ✅ | Uses `kickback_checkout_${payment.id}_${payment.amount}`. Should use canonical cents and settlement method in the key. |
| Venue kickback invoice | `invoiceItems.create`, `invoices.create/finalize/send` | ❌ | P0/P1 depending launch scope; external invoice can be sent before local DB state is updated. |
| Builder billing Checkout | `checkout.sessions.create` | ❌ | P1. Duplicate sessions are less dangerous than duplicate confirmed payments but should still be deterministic. |

P0 idempotency blockers:

- No persistent Stripe webhook event ledger is used by either Stripe endpoint.
- Signature verification is not the first side-effect boundary; rate-limit DB writes run before signature checks.
- Several real money/refund/transfer creation calls lack Stripe idempotency keys.

## Section 3 - Transactional integrity audit

| Money/state path | Tables updated | Current transaction boundary | Failure mode | Severity |
|---|---|---|---|---:|
| Save vendor Connect account | `vendor_stripe_accounts`, `vendor_profiles` | Separate writes | Profile mirror update error is ignored, leaving payout mirror stale. | P1 |
| Save venue Connect account | `venue_stripe_accounts`, `owner_profiles` | Separate writes | Owner profile mirror update error is ignored. | P1 |
| Save builder Connect account | `builder_stripe_accounts` | Single write | Lower risk; no mirror. | P2 |
| Venue rental Checkout | `venue_payment_transactions`, Stripe Checkout, later same table | DB writes are not wrapped; Stripe call sits between writes | Stripe session can exist while row stays `pending_builder_payment` if `updateTransactionWithCheckout` fails. | P0/P1 |
| Venue rental webhook completion | `venue_payment_transactions`, possibly `venue_bookings` | Separate writes in helper | Existing tests cover idempotent status changes, but no DB transaction/RPC evidence. | P1 |
| Vendor create-intent | `vendor_transactions`, `vendor_bookings`, Stripe PaymentIntent | Stripe PI first, then DB insert/update | Orphan PaymentIntent if non-conflict DB insert fails. | P1 |
| Direct vendor service payment | Stripe confirmed PaymentIntent, `vendor_transactions`, `vendor_bookings` | Stripe confirmed charge before DB insert | Route can return "Payment processed but transaction logging failed" after money moves. | P0 |
| Platform fee payment | Stripe customer update, confirmed PaymentIntent, `platform_fee_transactions`, `builder_event_usage` RPC | Separate side effects | Confirmed payment can exist without transaction/usage record. No idempotency key. | P0 |
| Venue kickback Checkout | Stripe Checkout, `kickback_payments`, `event_kickback_agreements` | Stripe session first, then two DB updates | Checkout may exist while payment/agreement stay payable/pending. | P1 |
| Venue kickback invoice send | Stripe invoice items/invoice/finalize/send, `kickback_payments`, `event_kickback_agreements` | Stripe invoice is sent before DB state commits | Venue may receive invoice while local row still not invoice-sent. | P0/P1 |
| Kickback invoice paid webhook | Stripe transfer, `kickback_payments`, `event_kickback_agreements`, email | Stripe transfer first, then DB updates | Duplicate transfer if DB update fails and Stripe retries `invoice.paid`. | P0 |
| Planner deposit authorization | `payment_intents`, Stripe manual PaymentIntent, action audit | Mixed; helper writes local record and route writes action transitions | Better than legacy paths; still needs explicit production env behavior. | P1 |
| Planner deposit capture | Stripe capture, `payment_intents`, `payouts`, action audit | Separate writes | Captured PI can exist while local payout/action transition fails. Needs retryable recovery/RPC. | P1 |
| Vendor refund routes | Stripe refund/reversal, `vendor_transactions`, `vendor_bookings` | Stripe first, multiple DB writes | Duplicate refund/reversal risk and partial local state. | P0 |
| Kickback refund decision | DB marks approved, Stripe reversal, Stripe refund, DB update | No DB transaction; no idempotency | Approved state can persist without Stripe execution, or Stripe can execute without final local processing state. | P0 |
| Venue rental refund decision | DB marks approved, Stripe reversal, Stripe refund | No DB transaction; no idempotency | Refund/reversal can execute while row remains `refund_approved`; webhook may repair status only if it arrives. | P0 |

Required pattern for Phase 2:

- For multi-table DB updates: create narrowly scoped Supabase RPC/Postgres functions that update all local tables atomically.
- For Stripe external calls: use deterministic idempotency keys and store enough operation state before/after the call to recover.
- If Stripe must happen first, write a retryable recovery record or enqueue an admin/manual review item when DB persistence fails. Do not silently log and continue.

## Section 4 - Approval-gating audit

| Route / path | Approval lookup | Revalidates approved amount/counterparty/freshness | Audit log / action transition | Finding |
|---|---:|---:|---:|---|
| `/api/planner/plans/[planId]/payments/authorize` | ✅ `approvalId` | ✅ amount + `approvalRequiresReapproval` | ✅ action transition | Good baseline pattern. |
| `/api/payments/capture` | ✅ `approvalId` | ✅ approval match, amount, stale check, explicit confirmation | ✅ action transition | Good baseline pattern. |
| `lib/planner/depositPayments.ts` | Called after route checks | ✅ core approval status and cents checks | Route logs transition | Core helper rejects unsafe cents; route handles freshness. |
| `/api/planner/plans/[planId]/venue-payment/checkout` | ❌ none | ❌ no approval ID in schema | ❌ none | P0 before real host money. It checks confirmed booking ownership, but not approval record/current approved terms. |
| `/api/payments/create-intent` | ❌ none | ❌ no approval ID | ❌ none | P0/P1. Confirmed vendor booking is not enough for the 3rdPlace approval contract. |
| `/api/payments/vendor` | ❌ none | ❌ request body accepts dollar amount | ❌ none | P0. Confirms payment immediately without approval or deterministic idempotency key. |
| `/api/payments/platform-fee` | ❌ none | ❌ no approval ID | ❌ none | P1 unless this is treated as separate subscription/billing user action; still needs idempotency/ledger. |
| `/api/payments/refund` | ❌ none | ❌ only authenticates builder owner | ❌ none | P0. Refund execution has no approval record and no idempotency. |
| `/api/payments/refund/process` | ❌ none | ❌ cancellation reason only | ❌ none | P0. Can execute multiple refunds/reversals across platform/vendor payments. |
| `/api/planner/plans/[planId]/refund-decision` | 🟡 settlement status, not approval table | 🟡 amount cap only | ❌ no approval record | P0/P1. Builder decision is explicit but not normalized into the approval/audit contract. |
| `/api/venue/rentals/[transactionId]/refund-decision` | 🟡 venue decision state, not approval table | 🟡 amount cap only | ❌ no approval record | P0/P1. Explicit venue decision exists but not the standard approval record. |
| `/api/venue/kickbacks/[id]/checkout` | 🟡 settlement state only | 🟡 payer/recipient and status checks | ❌ no approval record | Needs product decision: venue-settlement approvals may be a settlement-specific approval record, but money movement still needs auditable approval. |

P0 approval blockers:

- Host-facing money movement can still happen through legacy routes without a current valid approval record.
- Refund execution is not normalized into approval/audit records.
- Several routes accept or store dollar amounts (`amount`) in payment paths; all stored/compared money should be integer cents.

## Section 5 - Connected account state machine

### Current tracked state

`lib/stripe/connect.ts` maps Stripe accounts to only:

- `active` when `charges_enabled && payouts_enabled`
- `restricted` when `disabled_reason` exists or `past_due` is non-empty
- `pending` otherwise

The rows also store:

- `stripe_account_id`
- `charges_enabled`
- `payouts_enabled`
- `requirements_due`

### Missing state granularity

Desired lifecycle:

`pending_onboarding -> onboarding_started -> capabilities_pending -> active -> restricted/disabled`

Current gaps:

- `onboarding_started` is not stored when account links are created.
- `capabilities_pending` is not distinct from general `pending`.
- `restricted` and `disabled` are collapsed.
- `capability.updated` is observed but not persisted.
- `payout.created`, `payout.paid`, `payout.failed` are observed but not attached to a UI-visible account/payout history.
- Account state changes do not mark in-flight payment intents/transactions as `blocked_by_account_state`.

### Webhook event mapping today

| Event | Current behavior | Needed behavior |
|---|---|---|
| `account.updated` | Upsert connected account row and mirror vendor/venue profile fields. | Persist detailed status, emit account-state audit record, revalidate relevant UI data. |
| `account.application.deauthorized` | Mark all matching connected account rows restricted. | Also block in-flight payment intents/transactions and surface admin/user remediation. |
| `capability.updated` | Return observed only. | Persist capability state and recompute `capabilities_pending` vs `active`. |
| `payout.created/paid/failed` | Return observed only. | Store payout state and expose on partner payout surfaces. |

### UI surfaces

Likely dependent surfaces:

- `/planner/payments` for host payment state and settlement blockers.
- `/planner/billing` for builder billing/subscription state.
- `/vendor/payouts` for vendor connected account and payout readiness.
- `/venue/payouts` for venue connected account, kickbacks, venue rental settlement, and POS proof settlement.
- Future `/admin/stripe/webhook-health` or existing admin ops surface for webhook and payment failure review.

No current test proves webhook -> DB -> UI render/revalidation. That is a P1 launch requirement after P0 safety fixes.

## Section 6 - Gap list (P0 / P1 / P2)

### P0 - must fix before real money moves

1. Persistent webhook dedup is missing from both Stripe endpoints.
2. Webhook signature verification is not the first side-effect boundary; rate-limit DB writes happen before signature verification.
3. Legacy host/partner money routes can execute without a current approval record.
4. Refund execution routes can execute without a normalized approval/audit record.
5. Several Stripe state-creating calls lack idempotency keys: direct vendor payment, platform fee PaymentIntent, kickback invoice-paid transfer, refunds, and transfer reversals.
6. Multi-table money updates are not atomic and generally have no recovery queue/compensating action.
7. Direct vendor and platform fee routes confirm Stripe payments before durable transaction records are guaranteed.
8. Payment routes still accept/handle dollar amounts in some execution paths instead of cents-only request/storage semantics.
9. Connect account restriction/deauthorization does not block in-flight payment intents/transactions.
10. Production payment entrypoints can silently degrade when Stripe env/payment method is missing (`maybeCreateStripeManualPaymentIntent` returns `null`).

### P1 - needs fix before launch

1. Connected account state machine is too coarse for production support and UI messaging.
2. Capability and payout events are observed but not persisted.
3. Existing `stripe_webhook_events` table needs endpoint-aware fields or replacement before it can serve as the production ledger.
4. No structured webhook observability contract with event ID, event type, source, livemode, outcome, and Sentry tags.
5. No admin read-only webhook health surface.
6. No end-to-end UI propagation tests for payment/account state changes.
7. Builder billing Checkout lacks deterministic idempotency for duplicate session creation.
8. Connect account save mirror updates ignore errors and should use RPC or explicit failure handling.
9. Test coverage is mostly mocked route/helper coverage; no saved signed webhook fixture tests for replay/dedup.
10. Connect onboarding uses legacy Express account creation (`type: 'express'`) and API version `2023-10-16`; keep stable if not changing now, but document migration decision for Accounts v2/current API.

### P2 - hardening / nice-to-have

1. Improve user-facing copy for restricted/pending account states so each role knows exactly who must act.
2. Add reconciliation jobs for Stripe objects that exist without a local row.
3. Add payout/transfer timeline details to admin and partner surfaces.
4. Add test-mode operational runbook for dashboard replay/resend and fixture generation.

## Section 7 - Proposed plan

Phase 2 should start from a fresh branch off latest `origin/main`, for example `codex/stripe-connect-business-readiness`, after this audit is reviewed.

### P0-1 / P0-2: webhook ledger, duplicate handling, and signature-first security

Files to touch:

- `app/api/webhooks/stripe/route.ts`
- `app/api/webhooks/stripe/connect/route.ts`
- New `lib/stripe/webhookLedger.ts`
- New or adjusted migration for `stripe_webhook_events`
- Optional `app/admin/stripe/webhook-health/page.tsx` only after the ledger exists

Migration:

- Prefer additive migration that upgrades existing `stripe_webhook_events` with `source`, `livemode`, `processing_outcome`, `processed_at`, `last_error`, `duplicate_count`, and useful indexes.
- If replacing shape is cleaner, create a new table name and document rollback. Do not drop existing data without a backfill plan.
- RLS: service-role manage policy; admin read API should use service role and admin-auth.

Tests required:

- `__tests__/integration/stripe-connect-webhook.test.ts`: unsigned request does not call `allowWebhookRequest`; invalid signature does not write ledger; duplicate event skips side effects.
- `__tests__/integration/stripe-kickback-invoice-webhook.test.ts`: duplicate `invoice.paid` event transfers exactly once.
- Saved signed fixture tests or dashboard replay/resend instructions. Do not claim duplicate same-event proof from two `stripe trigger` commands.

Risk if wrong:

- False duplicates could skip real events; bad error handling could suppress Stripe retries.

### P0-3 / P0-4: approval gating for all money/refund execution

Files to touch:

- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts`
- `app/api/payments/create-intent/route.ts`
- `app/api/payments/vendor/route.ts` or deprecate behind planner route if no longer product-valid
- `app/api/payments/platform-fee/route.ts` if this remains in launch scope
- `app/api/payments/refund/route.ts`
- `app/api/payments/refund/process/route.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.ts`
- `app/api/venue/rentals/[transactionId]/refund-decision/route.ts`
- New pure helper, likely `lib/planner/execution/paymentApprovalGate.ts`

Migration:

- If existing transaction tables need `approval_id`, add nullable columns, foreign keys to `approvals`, and indexes.
- If refund decisions need their own approval rows, add columns linking refund requests to approvals rather than inventing a fourth execution model.

Tests required:

- Missing approval rejects before Stripe call.
- Expired/stale approval rejects.
- Amount mismatch rejects.
- Counterparty mismatch rejects.
- Valid approval proceeds and writes audit row/action transition.
- Route-specific tests for venue rental Checkout, vendor payment, platform fee if kept, and refund decisions.

Risk if wrong:

- Over-strict gates can block legitimate settlement; under-strict gates violate the core 3rdPlace approval contract.

### P0-5: idempotency keys for every Stripe create/refund/reversal

Files to touch:

- `app/api/payments/vendor/route.ts`
- `app/api/payments/platform-fee/route.ts`
- `app/api/webhooks/stripe/route.ts`
- `app/api/payments/refund/route.ts`
- `app/api/payments/refund/process/route.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.ts`
- `app/api/venue/rentals/[transactionId]/refund-decision/route.ts`
- `app/api/venue/kickbacks/[id]/checkout/route.ts`
- `lib/billing/builder-billing.ts`

Migration:

- Add operation-id columns only where local rows need to store idempotency/recovery state.

Tests required:

- Duplicate route submission returns same Stripe object or no second Stripe call.
- Duplicate webhook event does not create a second transfer/refund/reversal.

Risk if wrong:

- Bad key derivation can collapse distinct legitimate operations or fail to dedup true retries.

### P0-6 / P0-7: transactional DB state and recovery

Files to touch:

- New SQL RPC migrations for venue rental payment update, kickback invoice-paid settlement, refunds, and Connect account mirror updates.
- `lib/payments/venue-rental.ts`
- `lib/payments/vendor-payments.ts`
- `lib/planner/depositPayments.ts`
- `app/api/webhooks/stripe/route.ts`
- A retry/recovery service such as `lib/stripe/paymentRecovery.ts` if Stripe-first order remains necessary.

Migration:

- Add RPC functions with stable, narrow signatures.
- Add recovery table only if existing `admin_tasks`/`app_jobs` is insufficient.

Tests required:

- DB write failure after Stripe call enqueues recovery/admin task and returns retryable status where appropriate.
- RPC updates multiple rows atomically.

Risk if wrong:

- Transactions can improve local consistency while still leaving Stripe external state unresolved; recovery paths must be explicit.

### P0-8: cents-only money execution

Files to touch:

- `app/api/payments/vendor/route.ts`
- `app/api/payments/platform-fee/route.ts`
- `app/api/payments/refund/route.ts`
- `app/api/payments/refund/process/route.ts`
- `lib/payments/vendor-payments.ts`
- Any UI callers that submit `amount` dollars to execution endpoints

Migration:

- Add cents columns for any remaining dollar-only transaction field if missing.
- Backfill from dollars only once, with rounding audited and documented.

Tests required:

- Unsafe cents rejected.
- Float request bodies rejected on execution endpoints.
- Render boundary formats cents to dollars.

Risk if wrong:

- Rounding errors can overcharge/underpay partners.

### P0-9: Connect restriction blocks in-flight money

Files to touch:

- `lib/stripe/connect-webhook.ts`
- `lib/stripe/connect.ts`
- New pure helper, likely `lib/stripe/connectStateMachine.ts`
- Payment transaction services for `payment_intents`, `venue_payment_transactions`, `vendor_transactions`, and kickback payments
- UI/API read models for `/planner/payments`, `/vendor/payouts`, `/venue/payouts`

Migration:

- Add `blocked_by_account_state` or equivalent status values only where state machines support it.
- Add `account_state_blocked_at`, `account_state_block_reason` if needed.

Tests required:

- `account.updated` with restricted account blocks in-flight intents.
- UI/API returns remediation message.
- Re-enabled account can move blocked items back into a retryable state only after explicit approval/reconfirmation.

Risk if wrong:

- Blocking too broadly can stall valid payments; not blocking can create settlement failures.

### P0-10: payment-entrypoint env validation

Files to touch:

- New `lib/stripe/env.ts`
- `lib/stripe/connect.ts`
- `lib/planner/depositPayments.ts`
- Payment route handlers that call Stripe

Migration:

- None.

Tests required:

- Production-like payment entrypoint with missing `STRIPE_SECRET_KEY` fails before local "requested" money state is created.
- Non-payment read-only routes still load without Stripe env where appropriate.

Risk if wrong:

- Over-global env validation could break read-only pages or local dev; keep checks at server/payment entrypoints.

### P1 state propagation and observability

Files to touch:

- `lib/stripe/connect-webhook.ts`
- `lib/stripe/connect.ts`
- `app/api/builder/stripe/status/route.ts`
- `app/api/vendor/stripe/status/route.ts`
- `app/api/venue/stripe/status/route.ts`
- `/planner/payments`, `/planner/billing`, `/vendor/payouts`, `/venue/payouts` data surfaces
- Optional `app/admin/stripe/webhook-health/page.tsx`

Tests required:

- Simulated webhook updates DB and the next API/UI read returns the new state.
- Payout/capability events persist visible state.

Risk if wrong:

- UI can show stale readiness after Stripe changes.

## Section 8 - Out of scope

This Phase 1 PR will not:

- Change production code.
- Change database schema.
- Merge or deploy anything.
- Troubleshoot the user's personal Stripe onboarding unless new evidence contradicts the stated assumption.
- Raise outreach autonomy defaults.
- Add new routes under `app/(dashboard)`.
- Redesign vendor, venue, builder, or planner UX.
- Change signup step structure.
- Implement Stripe Issuing, Treasury, Climate, Capital, or browser automation.
- Treat 3rdPlace as a marketplace or create any unapproved booking/payment/refund/send path.
