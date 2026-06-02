# Vendor Payment UI Reconciliation

Date: 2026-05-30
Repo: /Users/chrisredd/3rdSpace.webapp
Latest inspected main: 3bf08df feat(payments): Phase 2 - Builder -> Venue rental payment flow (#10)

This is a read-only reconciliation pass for Phase 3 of the money flow plan:
vendor payment UI wiring. It uses the post-Phase-2 main branch as the current
source of truth. The implementation has not started.

## 1. Sources Inspected

### Preconditions

- `git log origin/main --oneline -3` shows PR #10 merged at the top:
  `3bf08df feat(payments): Phase 2 - Builder -> Venue rental payment flow (#10)`.
- The root worktree is detached at `origin/main`. That is acceptable for this
  read-only reconciliation.
- `MONEY_FLOW_SANITY_CHECK.md` and `VENUE_RENTAL_RECONCILIATION.md` exist as
  untracked audit artifacts. They are required inputs and were intentionally
  kept out of git in the prior workflow.
- `app/api/webhooks/stripe/route.ts` currently recognizes the two existing
  transfer namespaces:
  - `venue_builder_kickback` via `KICKBACK_TRANSFER_NAMESPACE` at
    `app/api/webhooks/stripe/route.ts:37`.
  - `venue_rental` via `VENUE_RENTAL_PAYMENT_NAMESPACE` routing at
    `app/api/webhooks/stripe/route.ts:450-455`.

### Architecture and product rules

- `AGENTS.md:31-46` confirms `(planner)` is the primary experience and
  `(dashboard)` is legacy. No new routes/files should be added under
  `app/(dashboard)`.
- `AGENTS.md:60-66` defines the approval-first execution model. Vendor payments
  are controlled payments; the user approves before money moves.
- `AGENTS.md:125-138` defines the dark vibrant UI system that Phase 3 UI must
  match.
- `AGENTS.md:131-139` includes the hard rules: no new dashboard routes, no
  auto-execution, integer cents for money, and no breaking existing Stripe
  patterns.
- `MONEY_FLOW_SANITY_CHECK.md:57-77` is stale for Phase 2 because it predates
  PR #10. It still correctly marks Phase 3 P3.23-P3.25 as missing/not started.
- `MONEY_FLOW_SANITY_CHECK.md:187-189` already called out that Phase 3 should
  wait for Phase 2 namespace work and should deprecate `/api/payments/vendor`.
- `VENUE_RENTAL_RECONCILIATION.md:223-230` documented the same namespace risk
  that now applies to vendor payments.
- `VENUE_RENTAL_RECONCILIATION.md:279` reserved
  `payment_kind_namespace='vendor_payment'` for Phase 3.
- `VENUE_RENTAL_RECONCILIATION.md:334-348` established `@/lib/money` as the
  canonical money helper location and documented the duplicate helper debt.

### Phase 2 patterns to mirror

- `lib/payments/venue-rental.ts:4-10` defines the venue rental namespace and
  shared fee constants.
- `lib/payments/venue-rental.ts:35-54` provides shared card and ACH fee math.
- `lib/payments/venue-rental.ts:56-94` provides event identification and lookup
  helpers.
- `lib/payments/venue-rental.ts:96-194` provides idempotent status update
  helpers for paid, failed, refunded, transfer completed, and transfer reversed
  states.
- `components/planner/VenueRentalPaymentMethodPicker.tsx:20-41` shows the
  two-option payment method picker pattern Phase 3 should mirror.
- `components/planner/VenueRentalPaymentButton.tsx:54-94` posts the selected
  payment method to the checkout route and redirects to Stripe-hosted Checkout.
- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:13-25` shows
  the Phase 2 request schema and namespace constants.
- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:89-100`
  explains why the builder selects a method before Checkout is created.
- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:494-504`
  shows the required metadata shape on the Checkout session.
- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:537-544`
  shows the same namespace metadata duplicated onto the PaymentIntent.
- `app/api/webhooks/stripe/route.ts:427-476` is the current shared transfer
  namespace router.
- `app/(planner)/planner/payments/page.tsx:431-531` is the Phase 2 builder-side
  ledger section that Phase 3 should parallel for vendor service payments.
- `components/planner/BookedPartnersWorkspace.tsx:615-736` is the Phase 2
  workspace payment pattern for venue rentals.

### Existing vendor backend

- `app/api/payments/create-intent/route.ts:21-203` was read in full.
- `app/api/payments/confirm/route.ts:21-130` was read in full.
- `app/api/payments/vendor/route.ts:12-251` was read in full.
- `app/api/payments/refund/route.ts:18-140` was read in full.
- `app/api/payments/refund/process/route.ts:13-229` and
  `app/api/payments/refund/process/route.ts:300-413` were read in full.
- `app/api/payments/refund/calculate/route.ts` exists and is a cancellation
  refund calculator endpoint.
- `lib/payments/vendor-payments.ts:5-267` was read in full.

### Existing vendor tests

- `__tests__/payments/vendorStripeReconnectRoute.test.ts:1-98` tests only the
  deprecated direct route's reconnect guard.
- `lib/payments/__tests__/vendor-payments.test.ts:14-61` tests money helper
  behavior and deposit/final amount calculation.
- No existing comprehensive tests were found for
  `app/api/payments/create-intent`, `app/api/payments/confirm`, vendor refund
  approval, vendor webhook namespace routing, or vendor UI payment components.

### Database schema

- `lib/types/database-generated.ts:5000-5041` contains `vendor_bookings`.
- `lib/types/database-generated.ts:6006-6017` contains
  `vendor_stripe_accounts`.
- `lib/types/database-generated.ts:6057-6078` contains
  `vendor_transactions`.
- `supabase/migrations/20260428161000_add_vendor_transactions.sql:21-49`
  created `vendor_transactions` with legacy dollar fields and check
  constraints.
- `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:7-47`
  added cents columns to `vendor_transactions`.
- `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:61-106`
  added a legacy dollar/cents sync trigger.
- `supabase/migrations/20260429120000_add_builder_ticketing_connections.sql:140-145`
  added the active payment partial unique index for deposit/final payments.

### Existing vendor UI surfaces

- `components/payments/PaymentForm.tsx:1-187` exists but has no call sites.
- `components/payments/PaymentForm.tsx:56-63` calls
  `/api/payments/confirm`.
- `components/payments/PaymentForm.tsx:123-128` calls
  `/api/payments/create-intent`.
- `components/planner/BookedPartnersWorkspace.tsx:514-533` shows that vendor
  partners still use a `Mark deposit placed` placeholder while venue partners
  use the new venue rental payment UI.
- `app/(planner)/planner/page.tsx:4975-5360` contains the inline approval card
  that still authorizes actions only. It does not execute vendor payment.
- `app/(dashboard)/vendor/payouts/page.tsx:61-77` still includes placeholder
  copy for deposit/balance tracking and invoices/receipts.
- `app/(dashboard)/vendor/payouts/page.tsx:325-365` renders payment activity
  from the existing vendor payouts summary, but it is not a full Phase 3
  ledger/refund decision experience.
- `app/api/vendor/payouts/summary/route.ts:37-98` already exists and returns
  vendor payout summary data.

### Email and money helpers

- `lib/email.ts:114-301` contains kickback notification wrapper patterns.
- `lib/email.ts:334-410` contains the Phase 2 venue rental refund wrappers.
- `lib/email.ts:523-569` contains the venue rental notification context loader.
- `lib/money.ts:1-32` is the canonical helper location for
  `dollarsToCents`, `centsToDollars`, and `readCents`.
- `lib/planner/vendorEconomicsCosts.ts:259-262` still contains a duplicate
  local `dollarsToCents` helper. Phase 3 should use `@/lib/money` and not
  expand the duplicate.

## 2. Existing Vendor Backend Inventory

### `POST /api/payments/create-intent`

File: `app/api/payments/create-intent/route.ts:21-203`

- HTTP method/path: `POST /api/payments/create-intent`.
- Request body:
  - `bookingId: string uuid` at `app/api/payments/create-intent/route.ts:21-22`.
  - `paymentType: 'deposit' | 'final_payment'`, default `deposit`, at
    `app/api/payments/create-intent/route.ts:23`.
  - No `service_payment`.
  - No `payment_method_type`.
  - No processing fee amount.
- Auth:
  - Loads booking by service role at `app/api/payments/create-intent/route.ts:36-38`.
  - Calls `getAuthenticatedBuilderForBooking` at
    `app/api/payments/create-intent/route.ts:44`.
  - Returns 401/403 depending on helper result at
    `app/api/payments/create-intent/route.ts:45-47`.
- Booking validation:
  - Requires `booking.status === 'confirmed'` at
    `app/api/payments/create-intent/route.ts:49-51`.
  - Ensures vendor can receive payments at
    `app/api/payments/create-intent/route.ts:53`.
- Amount logic:
  - Calls `getPaymentAmount(booking, paymentType)` at
    `app/api/payments/create-intent/route.ts:54-55`.
  - Calls `calculatePaymentAmounts(paymentAmount)` at
    `app/api/payments/create-intent/route.ts:61`.
  - Rejects amounts under Stripe minimum at
    `app/api/payments/create-intent/route.ts:62-64`.
- Idempotency:
  - Looks for existing `vendor_transactions` with same `booking_id` and
    `payment_type` in `pending` or `processing` states at
    `app/api/payments/create-intent/route.ts:67-75`.
  - Reuses an existing non-canceled/non-succeeded PaymentIntent at
    `app/api/payments/create-intent/route.ts:81-99`.
  - Catches duplicate insert conflicts and recovers the active row at
    `app/api/payments/create-intent/route.ts:138-162`.
- Stripe call:
  - `stripe.paymentIntents.create` at
    `app/api/payments/create-intent/route.ts:102-119`.
  - Arguments:
    - `amount: amounts.amountCents`.
    - `currency: 'usd'`.
    - `automatic_payment_methods: { enabled: true }`.
    - `transfer_group: vendor_booking_<booking.id>`.
    - Metadata:
      - `booking_id: booking.id`.
      - `vendor_id: booking.vendor_id`.
      - `builder_id: auth.builderProfileId`.
      - `payment_type: paymentType`.
      - `platform_fee_percentage: String(getPlatformFeePercentage())`.
  - Missing metadata:
    - `payment_kind_namespace`.
    - `vendor_payment_transaction_id`.
    - `payment_method_type`.
    - `processing_fee_cents`.
- DB writes:
  - Inserts `vendor_transactions` at
    `app/api/payments/create-intent/route.ts:121-136`.
  - Sets `amount_cents`, `platform_fee_cents`, `stripe_fee_cents: 0`,
    `vendor_payout_cents`, `payment_type`, and `status: 'pending'`.
  - Updates `vendor_bookings` payment fields at
    `app/api/payments/create-intent/route.ts:164-174`.
- Response:
  - Returns `clientSecret`, `paymentIntentId`, `connectedAccountId`,
    `transaction`, and a dollar-based `summary` at
    `app/api/payments/create-intent/route.ts:176-187`.
- Multi-statement writes are not wrapped in a transaction. If the
  PaymentIntent succeeds but the insert/update fails, recovery is partial.

### `POST /api/payments/confirm`

File: `app/api/payments/confirm/route.ts:21-130`

- HTTP method/path: `POST /api/payments/confirm`.
- Request body:
  - `paymentIntentId: string` at `app/api/payments/confirm/route.ts:21-23`.
- Auth:
  - Loads `vendor_transactions` by `stripe_payment_intent_id` at
    `app/api/payments/confirm/route.ts:37-41`.
  - Loads vendor booking at `app/api/payments/confirm/route.ts:47`.
  - Uses `getAuthenticatedBuilderForBooking` at
    `app/api/payments/confirm/route.ts:50-53`.
- Stripe call:
  - Retrieves PaymentIntent with `latest_charge.balance_transaction`
    expanded at `app/api/payments/confirm/route.ts:55-58`.
  - If `paymentIntent.status !== 'succeeded'`, updates transaction and
    booking status without creating a transfer at
    `app/api/payments/confirm/route.ts:60-72`.
- Transfer:
  - Ensures vendor can receive payments at
    `app/api/payments/confirm/route.ts:80`.
  - Calls `createVendorTransfer` when no `stripe_transfer_id` exists at
    `app/api/payments/confirm/route.ts:84-90`.
  - The transfer metadata is defined in `lib/payments/vendor-payments.ts`,
    not this route.
- DB writes:
  - Updates `vendor_transactions` with charge id, transfer id, Stripe fee,
    status `succeeded`, and `paid_at` at
    `app/api/payments/confirm/route.ts:94-105`.
  - Updates `vendor_bookings` with `payment_status`, `deposit_paid`, and
    related fields at `app/api/payments/confirm/route.ts:109-125`.
- Response:
  - Returns `{ status: 'succeeded', transaction }` at
    `app/api/payments/confirm/route.ts:127-130`.
- Idempotency:
  - Avoids duplicate transfer by checking `tx.stripe_transfer_id` at
    `app/api/payments/confirm/route.ts:81-84`.
  - Uses Stripe transfer idempotency in `createVendorTransfer`.
- Gap:
  - It does not verify PaymentIntent namespace metadata because none exists.

### `POST /api/payments/vendor` direct route

File: `app/api/payments/vendor/route.ts:12-251`

- HTTP method/path: `POST /api/payments/vendor`.
- Request body:
  - `bookingId: string uuid`.
  - `paymentMethodId: string`.
  - `amount: positive number`.
  - Defined at `app/api/payments/vendor/route.ts:12-16`.
- Auth:
  - Authenticates Supabase user at `app/api/payments/vendor/route.ts:79-87`.
  - Resolves builder profile at `app/api/payments/vendor/route.ts:90-93`.
  - Loads booking, vendor profile, and event owner at
    `app/api/payments/vendor/route.ts:95-106`.
  - Checks `booking.events?.builder_id === builderProfileId` at
    `app/api/payments/vendor/route.ts:118-120`.
- Booking and Connect checks:
  - Requires booking status `confirmed` at
    `app/api/payments/vendor/route.ts:122-124`.
  - Loads vendor Stripe account at
    `app/api/payments/vendor/route.ts:126-130`.
  - Validates stored Stripe account at
    `app/api/payments/vendor/route.ts:152-158`.
  - Requires `charges_enabled` at `app/api/payments/vendor/route.ts:172-177`.
- Fee logic:
  - `estimateStripeFee` uses a hard-coded card formula in dollars at
    `app/api/payments/vendor/route.ts:27-35`.
  - Converts the estimate to cents at
    `app/api/payments/vendor/route.ts:148-150`.
- Stripe call:
  - Creates and confirms a destination-charge PaymentIntent at
    `app/api/payments/vendor/route.ts:179-196`.
  - Arguments:
    - `amount: amountCents`.
    - `currency: 'usd'`.
    - `payment_method: paymentMethodId`.
    - `confirm: true`.
    - `application_fee_amount: 0`.
    - `transfer_data.destination: validation.accountId`.
    - Metadata:
      - `booking_id: booking.id`.
      - `vendor_id: booking.vendor_id`.
      - `builder_id: builderProfileId`.
      - `platform_fee: '0'`.
      - `payment_type: 'service_payment'`.
  - Missing metadata:
    - `payment_kind_namespace`.
    - `vendor_payment_transaction_id`.
    - `payment_method_type`.
    - `processing_fee_cents`.
- DB writes:
  - Inserts `vendor_transactions` at `app/api/payments/vendor/route.ts:200-214`.
  - Sets `vendor_payout_cents` to `Math.max(amountCents - stripeFeeCents, 0)`
    at `app/api/payments/vendor/route.ts:207-210`.
  - Updates `vendor_bookings` when PaymentIntent succeeded at
    `app/api/payments/vendor/route.ts:225-237`.
- Response:
  - Returns `success`, `payment_intent_id`, and Stripe status at
    `app/api/payments/vendor/route.ts:247-251`.
- Status:
  - This route has unique direct destination-charge behavior, but it violates
    the Phase 2/3 exact fee model and should be deprecated, not deleted.

### `POST /api/payments/refund`

File: `app/api/payments/refund/route.ts:18-140`

- HTTP method/path: `POST /api/payments/refund`.
- Request body:
  - `transactionId?: string uuid`.
  - `bookingId?: string uuid`.
  - `amount?: number`.
  - `reason?: string`.
  - Requires either `transactionId` or `bookingId` at
    `app/api/payments/refund/route.ts:18-25`.
- Auth:
  - Loads a succeeded non-refund `vendor_transactions` row at
    `app/api/payments/refund/route.ts:37-57`.
  - Loads booking and authenticates builder at
    `app/api/payments/refund/route.ts:59-65`.
- Stripe calls:
  - Creates a refund at `app/api/payments/refund/route.ts:73-83`.
  - Refund metadata:
    - `booking_id: tx.booking_id`.
    - `original_transaction_id: tx.id`.
    - `reason: parsedBody.data.reason || ''`.
  - Missing `payment_kind_namespace`.
  - Creates a transfer reversal at `app/api/payments/refund/route.ts:92-99`.
  - Reversal metadata:
    - `booking_id: tx.booking_id`.
    - `refund_id: refund.id`.
  - Missing `payment_kind_namespace`.
- DB writes:
  - Inserts a refund row into `vendor_transactions` at
    `app/api/payments/refund/route.ts:105-123`.
  - Updates original transaction status at
    `app/api/payments/refund/route.ts:127-130`.
- Gap:
  - Immediate builder-executed refund. No vendor approval, no reject, no
    counter, and no explicit processing fee model.

### `POST /api/payments/refund/process`

File: `app/api/payments/refund/process/route.ts:13-229`,
`app/api/payments/refund/process/route.ts:300-413`

- HTTP method/path: `POST /api/payments/refund/process`.
- Request body:
  - `bookingId: string uuid`.
  - `reason: non-empty string`.
  - Defined at `app/api/payments/refund/process/route.ts:13-16`.
- Purpose:
  - Cancellation refund processor, not a vendor approval refund flow.
- Stripe calls:
  - `stripe.transfers.createReversal` in `reverseVendorTransfer` at
    `app/api/payments/refund/process/route.ts:59-66`.
  - Reversal metadata:
    - `booking_id`.
    - `refund_id`.
    - `original_transaction_id`.
  - `stripe.refunds.create` for platform fee transactions at
    `app/api/payments/refund/process/route.ts:106-115`.
  - Platform fee refund metadata:
    - `booking_id`.
    - `refund_type: 'platform_fee'`.
    - `platform_fee_transaction_id`.
  - `stripe.refunds.create` for vendor service payments at
    `app/api/payments/refund/process/route.ts:176-187`.
  - Vendor refund metadata:
    - `booking_id`.
    - `refund_type: 'vendor_service'`.
    - `original_transaction_id`.
    - `cancellation_reason`.
  - Missing `payment_kind_namespace` in all vendor refund/reversal metadata.
- DB writes:
  - Inserts refund rows into `vendor_transactions` at
    `app/api/payments/refund/process/route.ts:195-211`.
  - Updates original transaction status at
    `app/api/payments/refund/process/route.ts:213-216`.
  - Updates `vendor_bookings` cancellation and refund fields at
    `app/api/payments/refund/process/route.ts:367-382`.
- Money debt:
  - Uses dollar rounding at `app/api/payments/refund/process/route.ts:371`,
    `app/api/payments/refund/process/route.ts:389`, and
    `app/api/payments/refund/process/route.ts:402`.
- Gap:
  - Not suitable as the primary Phase 3 refund route unless it is refactored
    or wrapped with new approval/counter routes.

### `lib/payments/vendor-payments.ts`

File: `lib/payments/vendor-payments.ts:5-267`

- Exports:
  - `VendorPaymentType = 'deposit' | 'final_payment'` at
    `lib/payments/vendor-payments.ts:14`.
  - `VendorTransactionStatus = 'pending' | 'processing' | 'succeeded' |
    'failed' | 'refunded'` at `lib/payments/vendor-payments.ts:15`.
  - `centsToDollars`, `dollarsToCents`, and `readCents` re-exported at
    `lib/payments/vendor-payments.ts:63`.
  - `toMoney(value)` at `lib/payments/vendor-payments.ts:65-67`.
  - `getPlatformFeePercentage()` at `lib/payments/vendor-payments.ts:69-73`.
  - `calculatePaymentAmounts(amount)` at `lib/payments/vendor-payments.ts:75-88`.
  - `getBookingTotal(booking)` at `lib/payments/vendor-payments.ts:90-92`.
  - `getPaymentAmount(booking, paymentType)` at
    `lib/payments/vendor-payments.ts:94-104`.
  - `getFriendlyStripeError(error)` at `lib/payments/vendor-payments.ts:106-121`.
  - `getAuthenticatedBuilderForBooking(supabase, booking)` at
    `lib/payments/vendor-payments.ts:123-159`.
  - `getVendorBookingForPayment(admin, bookingId)` at
    `lib/payments/vendor-payments.ts:161-172`.
  - `getVendorStripeAccount(admin, vendorId)` at
    `lib/payments/vendor-payments.ts:174-188`.
  - `ensureVendorCanReceivePayments(admin, vendorId)` at
    `lib/payments/vendor-payments.ts:190-215`.
  - `createVendorTransfer(params)` at
    `lib/payments/vendor-payments.ts:217-247`.
  - `getStripeFeeCentsFromPaymentIntent(paymentIntent)` at
    `lib/payments/vendor-payments.ts:249-257`.
  - `getStripeFeeFromPaymentIntent(paymentIntent)` at
    `lib/payments/vendor-payments.ts:259-261`.
  - `getChargeIdFromPaymentIntent(paymentIntent)` at
    `lib/payments/vendor-payments.ts:263-267`.
- Money helper usage:
  - Imports canonical `@/lib/money` helpers at
    `lib/payments/vendor-payments.ts:5-10`.
- Amount calculation:
  - `getBookingTotal` uses `final_price` before `quoted_price` at
    `lib/payments/vendor-payments.ts:90-92`.
  - Deposit uses `deposit_amount` if positive; otherwise full total; capped at
    total at `lib/payments/vendor-payments.ts:97-100`.
  - Final payment subtracts `deposit_amount` only when `deposit_paid` is true
    at `lib/payments/vendor-payments.ts:102-103`.
- Connect readiness:
  - Requires `stripe_account_id` at `lib/payments/vendor-payments.ts:190-195`.
  - Validates account mode/account id at `lib/payments/vendor-payments.ts:197-208`.
  - Requires `payouts_enabled` and not `restricted` at
    `lib/payments/vendor-payments.ts:210-212`.
  - It does not explicitly require `charges_enabled` on this canonical path.
- Platform fee:
  - `getPlatformFeePercentage` reads `PLATFORM_FEE_PERCENTAGE` and allows
    0-30 at `lib/payments/vendor-payments.ts:69-73`.
  - `calculatePaymentAmounts` subtracts that platform fee from vendor payout
    at `lib/payments/vendor-payments.ts:75-88`.
  - Default tests expect 0, but the helper can take a non-zero fee if env is
    set. Phase 3 should lock vendor payment platform fee to 0 for this flow.
- Transfer metadata:
  - `createVendorTransfer` metadata at `lib/payments/vendor-payments.ts:234-239`
    includes:
    - `booking_id`.
    - `vendor_id`.
    - `transaction_id`.
    - `payment_type`.
  - Missing:
    - `payment_kind_namespace: 'vendor_payment'`.
    - `vendor_payment_transaction_id`.

### `PaymentForm.tsx`

File: `components/payments/PaymentForm.tsx:1-187`

- Props:
  - `bookingId: string`.
  - `paymentType?: 'deposit' | 'final_payment'`.
  - `onPaymentSucceeded?: (transaction: unknown) => void`.
  - Defined at `components/payments/PaymentForm.tsx:9-15`.
- Internal state:
  - Stores `intent`, loading, and error at
    `components/payments/PaymentForm.tsx:105-107`.
- API calls:
  - Creates the intent via `/api/payments/create-intent` at
    `components/payments/PaymentForm.tsx:123-128`.
  - Confirms the PaymentIntent with Stripe Elements at
    `components/payments/PaymentForm.tsx:45-48`.
  - Finalizes via `/api/payments/confirm` at
    `components/payments/PaymentForm.tsx:56-63`.
- Reuse assessment:
  - It is compatible with the existing two-step backend.
  - It has no call sites.
  - It does not support `service_payment`.
  - It does not show card vs ACH fee before intent creation.
  - It uses Stripe Elements instead of the Phase 2 Stripe Checkout pattern.
  - Its styling is not aligned with the current dark vibrant Phase 2 modal
    pattern.
  - Recommendation: treat as legacy/reference. Do not delete in Phase 3 unless
    a separate cleanup is approved. Build new planner components that mirror
    Phase 2 and either leave this uncalled or refactor it explicitly.

## 3. Webhook Namespace Gap Analysis (LIKELY P0 BLOCKER)

CRITICAL FINDING: the existing vendor backend does not set
`payment_kind_namespace='vendor_payment'` anywhere in PaymentIntents,
Transfers, Refunds, or transfer reversals.

### A. PaymentIntent metadata from `/api/payments/create-intent`

Source: `app/api/payments/create-intent/route.ts:102-119`

Current metadata shape:

```ts
metadata: {
  booking_id: booking.id,
  vendor_id: booking.vendor_id,
  builder_id: auth.builderProfileId,
  payment_type: paymentType,
  platform_fee_percentage: String(getPlatformFeePercentage()),
}
```

Does it include `payment_kind_namespace='vendor_payment'`?

- No.

What metadata is present?

- `booking_id`.
- `vendor_id`.
- `builder_id`.
- `payment_type`.
- `platform_fee_percentage`.

Additional gap:

- The current route creates the PaymentIntent before inserting
  `vendor_transactions` at `app/api/payments/create-intent/route.ts:102-136`.
  That means it cannot currently include `vendor_payment_transaction_id` at
  PaymentIntent creation time without either reordering the row creation or
  updating PaymentIntent metadata after insert.

### B. Transfer metadata from `/api/payments/confirm`

Source call site: `app/api/payments/confirm/route.ts:84-90`

Transfer helper: `lib/payments/vendor-payments.ts:217-247`

Current transfer metadata shape:

```ts
metadata: {
  booking_id: params.transaction.booking_id,
  vendor_id: params.transaction.vendor_id,
  transaction_id: params.transaction.id,
  payment_type: params.transaction.payment_type,
}
```

Does it include `payment_kind_namespace='vendor_payment'`?

- No.

What metadata is present?

- `booking_id`.
- `vendor_id`.
- `transaction_id`.
- `payment_type`.

Consequence:

- Post-PR #9/#10, the shared transfer router only routes kickback and venue
  rental transfers. A vendor transfer with this metadata will reach
  `routeTransferEvent`, fail kickback detection at
  `app/api/webhooks/stripe/route.ts:432-448`, fail venue rental detection at
  `app/api/webhooks/stripe/route.ts:450-455`, and log/drop at
  `app/api/webhooks/stripe/route.ts:475`.

### C. Direct destination-charge metadata from `/api/payments/vendor`

Source: `app/api/payments/vendor/route.ts:179-196`

Current PaymentIntent metadata shape:

```ts
metadata: {
  booking_id: booking.id,
  vendor_id: booking.vendor_id,
  builder_id: builderProfileId,
  platform_fee: '0',
  payment_type: 'service_payment',
}
```

Does it include `payment_kind_namespace='vendor_payment'`?

- No.

What metadata is present?

- `booking_id`.
- `vendor_id`.
- `builder_id`.
- `platform_fee`.
- `payment_type`.

Additional gap:

- This route uses destination-charge `transfer_data.destination` at
  `app/api/payments/vendor/route.ts:184-187`, but the resulting transfer event
  still lacks a clear vendor namespace.
- The route deducts estimated Stripe fee from `vendor_payout_cents` at
  `app/api/payments/vendor/route.ts:207-210`, which contradicts the Phase 3
  money rule.

### D. Refund and reversal metadata

`app/api/payments/refund/route.ts`

- Refund metadata at `app/api/payments/refund/route.ts:78-82`:

```ts
metadata: {
  booking_id: tx.booking_id,
  original_transaction_id: tx.id,
  reason: parsedBody.data.reason || '',
}
```

- Reversal metadata at `app/api/payments/refund/route.ts:95-98`:

```ts
metadata: {
  booking_id: tx.booking_id,
  refund_id: refund.id,
}
```

`app/api/payments/refund/process/route.ts`

- Reversal metadata at `app/api/payments/refund/process/route.ts:61-65`:

```ts
metadata: {
  booking_id: params.transaction.booking_id,
  refund_id: params.stripeRefundId,
  original_transaction_id: params.transaction.id,
}
```

- Vendor service refund metadata at
  `app/api/payments/refund/process/route.ts:181-186`:

```ts
metadata: {
  booking_id: params.bookingId,
  refund_type: 'vendor_service',
  original_transaction_id: transaction.id,
  cancellation_reason: params.reason,
}
```

Does either refund path include `payment_kind_namespace='vendor_payment'`?

- No.

### E. Classification

Bucket: COMPLETELY ABSENT.

No existing vendor backend route sets `payment_kind_namespace='vendor_payment'`
on:

- PaymentIntent metadata.
- Transfer metadata.
- Refund metadata.
- Transfer reversal metadata.

Phase 3 should not start UI wiring until the canonical vendor backend emits
namespace metadata and the shared webhook router can recognize vendor events.

### F. Required precursor commit shape: P3.23-pre

Recommended commit before UI work:

`fix(payments): add vendor payment namespace metadata`

Exact file changes:

1. `lib/payments/vendor-payments.ts`
   - Add `export const VENDOR_PAYMENT_NAMESPACE = 'vendor_payment'`.
   - Extend `VendorPaymentType` to include `service_payment` if canonical path
     will own one-time payments.
   - Add shared fee helpers if Phase 3 adopts exact builder-paid processing fee.
   - Add namespace metadata to `createVendorTransfer` at
     `lib/payments/vendor-payments.ts:234-239`:
     - `payment_kind_namespace: VENDOR_PAYMENT_NAMESPACE`.
     - `vendor_payment_transaction_id: params.transaction.id`.
     - Keep existing `transaction_id` during transition.

2. `app/api/payments/create-intent/route.ts`
   - Add `payment_kind_namespace: 'vendor_payment'` to PI metadata at
     `app/api/payments/create-intent/route.ts:108-114`.
   - Prefer reordering to create a pending `vendor_transactions` row before
     PaymentIntent creation so PI metadata can include
     `vendor_payment_transaction_id`.
   - If reordering is too risky, update PaymentIntent metadata immediately
     after insert.

3. `app/api/payments/confirm/route.ts`
   - No direct metadata shape here, but confirm route should call the updated
     `createVendorTransfer` and assert it only handles vendor namespace
     transactions.

4. `app/api/payments/vendor/route.ts`
   - Add deprecation comment and `console.warn`.
   - Add namespace to metadata at `app/api/payments/vendor/route.ts:188-194`
     while the route remains live.
   - Preserve behavior for callers during transition, but stop using it from
     new UI.

5. `app/api/payments/refund/route.ts`
   - Add namespace and `vendor_payment_transaction_id` to refund metadata at
     `app/api/payments/refund/route.ts:78-82`.
   - Add namespace and `vendor_payment_transaction_id` to reversal metadata at
     `app/api/payments/refund/route.ts:95-98`.

6. `app/api/payments/refund/process/route.ts`
   - Add namespace and transaction id to vendor reversal metadata at
     `app/api/payments/refund/process/route.ts:61-65`.
   - Add namespace and transaction id to vendor refund metadata at
     `app/api/payments/refund/process/route.ts:181-186`.
   - Be careful not to incorrectly label platform-fee refunds at
     `app/api/payments/refund/process/route.ts:110-114` as vendor payments.

7. `app/api/webhooks/stripe/route.ts`
   - Extend `routeTransferEvent` at `app/api/webhooks/stripe/route.ts:427-476`
     with a `vendor_payment` branch.
   - Add vendor payment handlers for `payment_intent.succeeded`,
     `payment_intent.payment_failed`, and `charge.refunded` where appropriate.

Estimated diff size:

- Namespace-only patch: roughly 40-90 lines across 5-7 files plus tests.
- Exact-fee/schema-aware patch: larger, likely a full P3.23 commit plus a
  schema migration if `payment_method_type` and `processing_fee_cents` are
  added to `vendor_transactions`.

### G. Webhook handler event-type gaps

Current webhook coverage:

- `checkout.session.completed` first calls venue rental, then kickback, then
  legacy checkout handling at `app/api/webhooks/stripe/route.ts:522-531`.
  There is no vendor payment Checkout path.
- `invoice.paid` and `invoice.payment_failed` still route builder subscription
  events after kickback checks at `app/api/webhooks/stripe/route.ts:534-553`.
  Vendor payments should not touch invoice events.
- `payment_intent.succeeded` and `payment_intent.payment_failed` first call
  venue rental, then planner deposit, then kickback at
  `app/api/webhooks/stripe/route.ts:600-611`. There is no vendor payment
  handler.
- `charge.refunded` first calls venue rental, then kickback, then planner
  deposit at `app/api/webhooks/stripe/route.ts:614-628`. There is no vendor
  payment handler.
- `transfer.created`, `transfer.updated`, and `transfer.reversed` route
  through `routeTransferEvent` at `app/api/webhooks/stripe/route.ts:631-639`.
  The router does not yet recognize vendor payment transfers.

Conclusion:

- Phase 3 must extend the namespace router before or as part of P3.23.
- Without that extension, future vendor payment transfers will keep being
  logged and dropped as unknown transfer events.

## 4. UI Integration Surface

### A. Vendor approval card location

File: `app/(planner)/planner/page.tsx`

- Recommendation action classification detects vendor actions at
  `app/(planner)/planner/page.tsx:4478-4487`.
- Target type normalization maps vendor recommendation actions to `vendor` at
  `app/(planner)/planner/page.tsx:4493-4503`.
- The inline approval card reads label/provider/terms/amount at
  `app/(planner)/planner/page.tsx:5024-5034`.
- The approval card records authorization only via `patchApproval` at
  `app/(planner)/planner/page.tsx:5054-5084`.
- The button label remains generic `Authorize` unless it is a venue outreach
  approval at `app/(planner)/planner/page.tsx:5353-5357`.

Current state:

- This surface is approval-only. That is correct per AGENTS.md.
- It should not directly move vendor money.
- Phase 3 can improve label/copy for vendor approvals, but the actual payment
  trigger should live in the partner workspace after booking/terms are
  confirmed, matching Phase 2.

### B. Booked partner workspace vendor section

File: `components/planner/BookedPartnersWorkspace.tsx`

- Partner kind supports `venue` and `vendor` at
  `components/planner/BookedPartnersWorkspace.tsx:92-99`.
- Venue partner branch uses `VenueRentalWorkspacePayment` at
  `components/planner/BookedPartnersWorkspace.tsx:514-522`.
- Vendor partner branch still renders `Mark deposit placed` placeholder at
  `components/planner/BookedPartnersWorkspace.tsx:523-533`.
- The payload currently includes `venue_rental` but no vendor transaction
  context at `components/planner/BookedPartnersWorkspace.tsx:142-148`.
- `mapWorkspaceToPartner` maps `venueRental` only at
  `components/planner/BookedPartnersWorkspace.tsx:852-885`.

Current state:

- Vendor workspace is the main missing UI surface.
- Phase 3 must add vendor payment context to the workspace API/helper before
  the component can render deposit/final/payment state correctly.

### C. Planner payments ledger

File: `app/(planner)/planner/payments/page.tsx`

- The page loads builder payout summary and venue rental summary at
  `app/(planner)/planner/payments/page.tsx:125-147`.
- Phase 2 added the `Venue Rental Payments` section at
  `app/(planner)/planner/payments/page.tsx:431-531`.
- The existing kickback builder payout ledger starts at
  `app/(planner)/planner/payments/page.tsx:533-587`.

Current state:

- Architecture supports adding a third section cleanly.
- Phase 3 should add `Vendor Service Payments` as its own section, not merge it
  into venue rentals or builder payout ledger.
- The new section should call a new builder-facing summary endpoint, likely
  `GET /api/planner/payments/vendor-services/summary`.

### D. Vendor payouts dashboard

File: `app/(dashboard)/vendor/payouts/page.tsx`

- Existing placeholder content remains at
  `app/(dashboard)/vendor/payouts/page.tsx:61-77`.
- Page already fetches `/api/vendor/payouts/summary` at
  `app/(dashboard)/vendor/payouts/page.tsx:143-150`.
- Payment activity list exists at
  `app/(dashboard)/vendor/payouts/page.tsx:325-365`.

Current state:

- This page is partially data-backed, but still has placeholder cards and no
  vendor refund decision UI.
- AGENTS.md allows modifying this existing file. Do not add new files/routes
  under `app/(dashboard)`.

### E. Email notification trigger points

- Kickback wrappers live in `lib/email.ts:193-301`.
- Venue rental refund wrappers live in `lib/email.ts:334-410`.
- Venue rental context loader lives in `lib/email.ts:523-569`.

Phase 3 needs:

- Vendor payment paid email to vendor.
- Vendor final payment paid email to vendor.
- Builder refund requested -> vendor email.
- Vendor refund approved/rejected/countered -> builder email.
- Context loader should use `vendor_transactions`, `vendor_bookings`,
  `vendor_profiles`, `events/plans`, and builder user/profile data.

## 5. Money Rules Verification

### A. Cents enforcement

Good:

- Canonical vendor helper imports `@/lib/money` at
  `lib/payments/vendor-payments.ts:5-10`.
- `calculatePaymentAmounts` uses `dollarsToCents` at
  `lib/payments/vendor-payments.ts:75-88`.
- Cents columns were added and constrained at
  `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:7-47`.
- The generated type includes `amount_cents`, `platform_fee_cents`,
  `stripe_fee_cents`, and `vendor_payout_cents` at
  `lib/types/database-generated.ts:6057-6078`.

Debt:

- `app/api/payments/vendor/route.ts:33-35` uses direct dollar fee math.
- `app/api/payments/refund/process/route.ts:371`,
  `app/api/payments/refund/process/route.ts:389`, and
  `app/api/payments/refund/process/route.ts:402` use dollar rounding for
  returned totals.
- `app/(planner)/planner/page.tsx:5135` converts an approval edit amount with
  `Math.round(amountValue * 100)`.
- `lib/planner/vendorEconomicsCosts.ts:259-262` still has a duplicate
  `dollarsToCents` helper.

Recommendation:

- Phase 3 should use `@/lib/money` and shared vendor-payment fee helpers.
- Do not expand duplicate money helpers.
- Fix money debt only where directly touched by Phase 3.

### B. Platform fee

Existing canonical two-step backend:

- `getPlatformFeePercentage` reads `PLATFORM_FEE_PERCENTAGE` at
  `lib/payments/vendor-payments.ts:69-73`.
- `calculatePaymentAmounts` subtracts platform fee from vendor payout at
  `lib/payments/vendor-payments.ts:75-88`.
- Test coverage expects a zero platform fee by default at
  `lib/payments/__tests__/vendor-payments.test.ts:23-32`.

Existing direct route:

- `application_fee_amount: 0` at `app/api/payments/vendor/route.ts:184`.
- But it deducts `stripeFeeCents` from `vendor_payout_cents` at
  `app/api/payments/vendor/route.ts:207-210`.

Phase 3 rule:

- Platform takes zero fee from vendor payments.
- Vendor receives 100 percent of negotiated principal.
- Builder pays exact Stripe processing fee separately.

Recommendation:

- Lock vendor payment platform fee to zero in Phase 3 regardless of
  `PLATFORM_FEE_PERCENTAGE`.
- Keep `platform_fee_cents` at zero.
- Add `processing_fee_cents` separately if exact builder-paid fee is approved.

### C. Processing fee model

Current state:

- `POST /api/payments/create-intent` charges only `amounts.amountCents` at
  `app/api/payments/create-intent/route.ts:104`.
- It uses `automatic_payment_methods`, so the backend does not know card vs ACH
  before intent creation at `app/api/payments/create-intent/route.ts:106`.
- It does not show a builder-paid processing fee before commitment.
- `POST /api/payments/vendor` estimates a card fee at
  `app/api/payments/vendor/route.ts:27-35` and then deducts it from vendor
  payout at `app/api/payments/vendor/route.ts:207-210`.

Conclusion:

- Existing backend does not satisfy the Phase 2-style exact fee model.
- If Phase 3 must mirror Phase 2 exactly, a schema and route adjustment is
  required before UI wiring:
  - Add `payment_method_type`.
  - Add `processing_fee_cents`.
  - Add builder-selected method to create-intent request.
  - Charge principal + exact fee.
  - Transfer only principal to vendor.

## 6. Status Enum and Lifecycle

### Current schema status set

`vendor_transactions` status check constraint:

- `pending`
- `processing`
- `succeeded`
- `failed`
- `refunded`

Source: `supabase/migrations/20260428161000_add_vendor_transactions.sql:37-40`.

Current generated type leaves status as `string` at
`lib/types/database-generated.ts:6066-6070`, but the database constraint still
limits values.

### Current payment type set

`vendor_transactions_payment_type_check` allows:

- `deposit`
- `final_payment`
- `service_payment`
- `refund`

Source: `supabase/migrations/20260428161000_add_vendor_transactions.sql:37-38`.

`lib/payments/vendor-payments.ts` only types `VendorPaymentType` as
`deposit | final_payment` at `lib/payments/vendor-payments.ts:14`.

### Reuse vs new table

Recommendation: reuse `vendor_transactions`, but add columns/statuses rather
than creating a new parallel table.

Reasons:

- `vendor_transactions` already has the correct booking/vendor/builder anchor.
- It already has RLS and summary route usage.
- It already supports deposit/final/service/refund payment types.
- Existing UI and vendor summary route already read this table.

### Needed schema extensions if Phase 3 mirrors Phase 2

Likely migration:

- Add `payment_method_type text` with check `card` or `us_bank_account`.
- Add `processing_fee_cents integer not null default 0`.
- Add `stripe_refund_id text`.
- Add `stripe_transfer_reversal_id text`.
- Add `refund_amount_cents integer`.
- Add `refund_reason text`.
- Add `refund_requested_by uuid`.
- Add `refund_requested_at timestamptz`.
- Add `refund_approved_by uuid`.
- Add `refund_approved_at timestamptz`.
- Add `failed_at timestamptz`.
- Add `failure_reason text`.
- Add/update status constraint for:
  - `pending`
  - `processing`
  - `succeeded`
  - `failed`
  - `refund_requested`
  - `refund_approved`
  - `refunded_partial`
  - `refunded_full`
  - `cancelled`
- Keep legacy `refunded` temporarily for existing rows or migrate it to
  `refunded_full`.

### Lifecycle recommendation

Use a compatibility lifecycle:

- Pending intent created: `pending`.
- Stripe payment requires confirmation: `processing`.
- Confirm route completed transfer: `succeeded`.
- Payment failed: `failed`.
- Builder refund request: `refund_requested`.
- Vendor approval before webhook finalization: `refund_approved`.
- Webhook/refund finalization: `refunded_partial` or `refunded_full`.

Do not create a new `paid` status unless the team wants strict consistency with
venue rental naming. Reusing `succeeded` minimizes migration and UI churn.

## 7. Route Plan

| Route | Add / Modify / Deprecate | Purpose | Auth |
| --- | --- | --- | --- |
| `app/api/payments/create-intent/route.ts` | Modify | Canonical vendor payment intent creation; add namespace, selected payment method, exact processing fee, `service_payment` support if approved | Builder owner of vendor booking |
| `app/api/payments/confirm/route.ts` | Modify | Confirm PI and create vendor Connect transfer with `vendor_payment` namespace metadata | Builder owner of vendor booking |
| `app/api/payments/vendor/route.ts` | Deprecate | Legacy direct destination-charge route; preserve callers but add deprecation comment/warn and namespace metadata | Builder owner of booking event |
| `app/api/payments/refund/route.ts` | Modify or supersede | Current immediate vendor refund route; should not remain the primary Phase 3 approval refund path | Builder owner today |
| `app/api/payments/refund/process/route.ts` | Modify or supersede | Current cancellation refund route; add namespace metadata if retained | Builder owner |
| `app/api/webhooks/stripe/route.ts` | Modify | Add `vendor_payment` namespace routing for PI/charge/transfer events | Stripe signature |
| `app/api/planner/payments/vendor-services/summary/route.ts` | Add | Builder-facing ledger summary for outgoing vendor payments | Authenticated builder |
| `app/api/vendor/payouts/summary/route.ts` | Modify | Existing vendor payout summary; enrich for Phase 3 ledger/refund decisions | Authenticated vendor |
| `app/api/planner/plans/[planId]/vendor-payment/[transactionId]/refund-request/route.ts` | Add if approval refund flow approved | Builder requests vendor payment refund | Plan owner/builder |
| `app/api/vendor/payments/[transactionId]/refund-decision/route.ts` | Add if approval refund flow approved | Vendor approves/rejects/counters refund | Vendor owner |
| `components/planner/BookedPartnersWorkspace.tsx` | Modify | Wire vendor partner payment button and state | Client component |
| `app/(planner)/planner/payments/page.tsx` | Modify | Add `Vendor Service Payments` ledger section | Planner user |
| `app/(dashboard)/vendor/payouts/page.tsx` | Modify only | Replace placeholders with real vendor payment/refund decision UI | Vendor user |

Critical rule:

- Do not add new files under `app/(dashboard)`. Modifying
  `app/(dashboard)/vendor/payouts/page.tsx` is allowed by AGENTS.md.

## 8. Component Plan

### New components under `components/planner/`

1. `<VendorPaymentMethodPicker>`

- Mirrors `VenueRentalPaymentMethodPicker`.
- Inputs:
  - `amountCents`.
  - `paymentType: 'deposit' | 'final_payment' | 'service_payment'`.
  - `onSelect(method: 'card' | 'us_bank_account')`.
  - `isSubmitting`.
  - `error`.
- Shows:
  - Card processing fee.
  - ACH processing fee.
  - Total builder charge.
  - Settlement copy.
- Must share fee calculation with backend helper to avoid UI/API drift.

2. `<VendorPaymentButton>`

- Mirrors `VenueRentalPaymentButton`.
- Inputs:
  - `planId` or event/booking context if plan linkage is unavailable.
  - `vendorBookingId`.
  - `vendorName`.
  - `amountCents`.
  - `paymentType`.
  - Optional callbacks.
- Behavior:
  - Opens modal.
  - Renders picker.
  - Calls canonical `create-intent` or a new checkout-style vendor endpoint
    with `bookingId`, `paymentType`, and `payment_method_type`.
  - If retaining two-step PaymentIntent, mounts a Stripe Payment Element after
    method selection and then calls `/api/payments/confirm`.
  - If switching to Checkout, redirects to hosted Checkout like Phase 2.

### PaymentForm reuse decision

Recommendation: do not use `PaymentForm.tsx` as-is.

Reasons:

- It is uncalled.
- It supports only deposit/final.
- It creates the intent before the builder chooses a fee-bearing payment
  method.
- It does not match the Phase 2 modal/picker pattern.
- It uses old Stripe Elements appearance settings at
  `components/payments/PaymentForm.tsx:147-160`.

Options:

- Preferred: build new Phase 3 components under `components/planner/` and keep
  `PaymentForm.tsx` as legacy until a cleanup PR deletes or refactors it.
- Acceptable: refactor `PaymentForm.tsx` into an internal subcomponent used by
  `<VendorPaymentButton>` only after adding method selection and updated
  styling.
- Not recommended: wire `PaymentForm.tsx` directly into planner cards.

### Existing component modifications

- `components/planner/BookedPartnersWorkspace.tsx` needs vendor transaction
  context parallel to `venueRental`.
- The vendor branch at `components/planner/BookedPartnersWorkspace.tsx:523-533`
  should be replaced with status-aware vendor payment UI.
- The Phase 2 venue branch at `components/planner/BookedPartnersWorkspace.tsx:615-736`
  is the closest pattern to copy.

### Component tests

Add:

- `components/planner/__tests__/VendorPaymentMethodPicker.test.tsx`.
- `components/planner/__tests__/VendorPaymentButton.test.tsx`.

Mirror:

- `components/planner/__tests__/VenueRentalPaymentMethodPicker.test.tsx`.
- `components/planner/__tests__/VenueRentalPaymentButton.test.tsx`.

## 9. Payment Type Branching Logic

### A. Existing create-intent request branching

Current canonical route:

- Uses request body `paymentType: 'deposit' | 'final_payment'` at
  `app/api/payments/create-intent/route.ts:21-24`.
- Does not support `service_payment`.
- Does not infer payment type from booking state.

Current direct route:

- Hard-codes `payment_type: 'service_payment'` in metadata at
  `app/api/payments/vendor/route.ts:188-194`.
- Inserts `payment_type: 'service_payment'` at
  `app/api/payments/vendor/route.ts:207-212`.

### B. Existing amount logic

Source: `lib/payments/vendor-payments.ts:90-104`

- Total:
  - `final_price` first.
  - `quoted_price` fallback.
- Deposit:
  - `deposit_amount` if positive.
  - Otherwise total.
  - Capped at total.
- Final:
  - If deposit already paid, total minus deposit amount.
  - If deposit is not paid, full total.
- One-time `service_payment`:
  - No canonical helper support.
  - Direct route trusts request `amount` from the client.

### C. UI payment type recommendation

Recommended UI:

- Do not show three arbitrary buttons by default.
- Auto-detect the next due payment from booking state:
  - If `deposit_amount > 0` and `deposit_paid !== true`, show
    `Pay deposit`.
  - If `deposit_paid === true` and remaining balance > 0, show
    `Pay final`.
  - If no deposit split exists, show `Pay vendor`.
- Show the computed amount and let the builder choose card vs ACH in the
  method picker.
- Only expose a manual payment type switch if the booking data is ambiguous.

Rationale:

- The builder should not have to understand internal `payment_type` values.
- It reduces accidental final-payment attempts before deposit.
- It mirrors the Phase 2 "one payment action after confirmed booking" model,
  while accounting for deposit/final complexity.

### D. Booking anchor and confirmation

- Vendor payment should anchor to `vendor_bookings`.
- `vendor_bookings.status` exists at `lib/types/database-generated.ts:5033`.
- Existing canonical route already requires `booking.status === 'confirmed'`
  at `app/api/payments/create-intent/route.ts:49-51`.
- Existing direct route also requires confirmed status at
  `app/api/payments/vendor/route.ts:122-124`.

Recommendation:

- Keep `confirmed` booking requirement.
- Add vendor transaction context to partner workspaces so the UI only renders
  payment buttons for confirmed vendor bookings.

## 10. Refund Flow Design

### Direction by money flow

- Phase 1 kickback: venue requests refund, builder approves.
- Phase 2 venue rental: builder requests refund, venue approves.
- Phase 3 vendor payment: builder should request refund, vendor should approve.

### A. Existing refund route behavior

`app/api/payments/refund/route.ts`

- Processes a vendor refund immediately after builder auth.
- Supports transaction id or booking id.
- Allows partial amount via `amount?: number`.
- Does not require vendor approval.
- Does not provide reject or counter.
- Does not namespace Stripe refund/reversal calls.

`app/api/payments/refund/process/route.ts`

- Cancellation refund route.
- Uses refund policy calculation.
- Refunds platform fees and vendor service payments.
- Cancels `vendor_bookings`.
- Does not model a vendor approval decision.

### B. Partial refund support

Existing refund support is partial in raw Stripe terms:

- `app/api/payments/refund/route.ts:67-72` caps requested amount to the
  transaction amount.
- `app/api/payments/refund/process/route.ts:165-167` caps refund amount per
  transaction.

But it does not model Phase 2-style `refund_requested`,
`refund_approved`, `refunded_partial`, or `refunded_full` states.

### C. Processing fee invariant

Existing backend has no builder-paid `processing_fee_cents` field.

- The canonical path records `stripe_fee_cents` after payment at
  `app/api/payments/confirm/route.ts:92-100`.
- It does not charge that fee as a separate builder-visible amount.
- The direct route deducts estimated fee from vendor payout at
  `app/api/payments/vendor/route.ts:207-210`.

Conclusion:

- The invariant "processing fee is never refunded" cannot be fully enforced
  until Phase 3 adds explicit `processing_fee_cents` and charges it separately.

### D. Refund route recommendation

Recommended Phase 3 refund model:

1. Add:
   - `POST /api/planner/plans/[planId]/vendor-payment/[transactionId]/refund-request`.
   - Auth: builder/plan owner or builder owner of vendor booking.
   - Updates `vendor_transactions` to `refund_requested`.
2. Add:
   - `POST /api/vendor/payments/[transactionId]/refund-decision`.
   - Auth: vendor owner.
   - Supports `approve`, `reject`, `counter`.
3. On approve:
   - Reverse only vendor principal transfer.
   - Refund only vendor principal amount.
   - Do not refund processing fee.
   - Add `payment_kind_namespace='vendor_payment'` metadata to refund and
     reversal.
4. Webhook route:
   - Handles `charge.refunded` and `transfer.reversed` with vendor namespace.

Do not reuse existing immediate refund route as the primary Phase 3 UX without
wrapping it in an approval flow.

## 11. Open Questions

### A. Should Phase 3 refund flow mirror Phase 2?

Recommendation: yes.

Use builder requests, vendor approves/rejects/counters. Vendor payments are
counterparty payments like venue rentals. The vendor should have a chance to
approve or counter before Stripe reversal/refund execution.

### B. ACH support for vendor payments?

Recommendation: support both card and ACH, but default the UI copy toward card
for smaller payments and ACH for larger balances.

Reason:

- Phase 2 established the exact fee picker pattern.
- Vendor payments can still include caterers, AV, production, and talent, which
  may be large enough for ACH to matter.
- The exact fee model requires method selection before intent/session creation
  either way.

### C. Deprecate `/api/payments/vendor` immediately?

Recommendation: yes, deprecate in P3.23, but do not delete.

Required actions:

- Add route header comment.
- Add `console.warn` when hit.
- Add namespace metadata while it remains live.
- Keep `__tests__/payments/vendorStripeReconnectRoute.test.ts` as legacy
  regression coverage and label it in comments.

### D. PaymentForm.tsx: delete, reuse, or replace?

Recommendation: replace for Phase 3 UI, leave file in place.

Reason:

- It is uncalled and older.
- It can still serve as reference for the two-step confirm route.
- Deleting it is cleanup outside the minimum Phase 3 path.

### E. Add `payment_method_type` column to `vendor_transactions`?

Recommendation: yes, if Phase 3 must enforce exact fee neutrality.

Reason:

- Phase 2 learned this needs to be recorded at row creation time.
- Without it, reconciliation cannot prove which processing fee formula was used.
- Existing `vendor_transactions` has no equivalent column at
  `lib/types/database-generated.ts:6057-6078`.

Also add `processing_fee_cents`.

### F. Ledger grouping on planner payments page?

Recommendation: separate `Vendor Service Payments` section.

Reason:

- Venue rental payments are outgoing venue principal plus fee.
- Vendor payments are outgoing service deposits/finals plus fee.
- Builder payout ledger is incoming kickback/revenue share.
- Separate sections match the three money flows and make support/debugging
  easier.

### G. Maximum vendor payment amount cap?

Recommendation: use the same `$50,000` self-serve cap as venue rentals until
product chooses a lower vendor-specific cap.

Reason:

- Caterers, AV, production, and talent can exceed small-ticket assumptions.
- A single cap keeps concierge fallback consistent.

### H. Concierge fallback for vendors without Stripe Connect?

Recommendation: yes, same as Phase 2.

Existing canonical helper already returns/throws a reconnect condition for
missing or mismatched Stripe accounts at
`lib/payments/vendor-payments.ts:190-215`.

### I. Is P3.23-pre required?

Recommendation: yes.

Reason:

- Namespace is completely absent from vendor Stripe API calls.
- Webhook route does not recognize vendor namespace.
- Exact fee model likely requires small schema changes before UI can be
  truthful.

Minimum P3.23-pre:

- Add namespace constants/metadata to all vendor Stripe calls.
- Extend transfer namespace router.
- Add tests proving vendor transfers no longer drop as unknown.

Likely full P3.23:

- Also canonicalize/deprecate `/api/payments/vendor`.
- Add exact fee method support and required schema columns if approved.

### J. Existing test fixtures?

Existing:

- `__tests__/payments/vendorStripeReconnectRoute.test.ts:52-98` for direct
  route reconnect regression.
- `lib/payments/__tests__/vendor-payments.test.ts:14-61` for helper logic.

Missing:

- Create-intent route tests.
- Confirm route tests.
- Vendor transfer namespace tests.
- Vendor refund request/decision tests.
- Vendor summary route tests.
- Vendor planner UI component tests.

Recommendation:

- Add tests rather than relying on existing coverage.
- Mirror the Phase 2 venue rental test files and shapes.

### K. Two-step PaymentIntent vs Checkout Session for canonical path?

Recommendation needing human decision.

Current Phase 3 spec says canonicalize on `create-intent + confirm`, not
`/api/payments/vendor`. That matches existing backend and `PaymentForm.tsx`.

However, Phase 2 established a Stripe Checkout flow with preselected method,
exact fee line item, and hosted redirect. If Phase 3 must mirror that UX
exactly, it may be cleaner to add a vendor Checkout route instead of stretching
`create-intent + confirm`.

Decision needed:

- Option 1: Keep two-step PaymentIntent path as canonical. Add
  `payment_method_type`, exact fee, namespace metadata, and a refactored
  Payment Element UI.
- Option 2: Switch vendor payments to Checkout Session like Phase 2. This is
  more UX-consistent but is a larger backend change and no longer matches the
  original Phase 3 canonicalization language.

My recommendation:

- Keep the two-step path for P3.23 if the goal is the smallest Phase 3.
- Still use a Phase 2-style method picker before creating the PaymentIntent.
- Use `payment_method_types: [selectedMethod]` instead of
  `automatic_payment_methods`.
- Charge `principal + processing_fee_cents`.
- Transfer only principal to vendor in `confirm`.

## 12. Final Recommendation

NEEDS HUMAN DECISION

Phase 3 is implementable, but not as pure UI wiring yet. The backend exists,
but it is not ready for the post-PR #9/#10 namespace isolation and exact
builder-paid fee model.

Minimum decisions needed before implementation:

1. Confirm whether vendor payments should stay on the two-step
   `create-intent + confirm` path or switch to a Phase 2-style Checkout
   Session.
2. Confirm schema additions to `vendor_transactions`:
   `payment_method_type`, `processing_fee_cents`, refund request/approval
   fields, refund Stripe ids, and expanded statuses.
3. Confirm vendor refund flow mirrors Phase 2:
   builder requests, vendor approves/rejects/counters.
4. Confirm ACH support for vendor payments.
5. Confirm the `$50,000` self-serve cap applies to vendor payments.

Recommended implementation sequence:

1. P3.23-pre: namespace and schema readiness.
   - Add `VENDOR_PAYMENT_NAMESPACE = 'vendor_payment'`.
   - Add namespace metadata to PaymentIntents, Transfers, Refunds, and
     reversals.
   - Extend webhook namespace router to route vendor transfers.
   - Add/prepare schema columns for exact fee and refund lifecycle if approved.
2. P3.23: canonicalize vendor payment path.
   - Deprecate `/api/payments/vendor`.
   - Make `create-intent + confirm` the canonical path.
   - Add exact payment method fee calculation.
   - Add comprehensive route/helper tests.
3. P3.24: planner workspace UI.
   - Add vendor method picker/button.
   - Wire confirmed vendor bookings in `BookedPartnersWorkspace`.
4. P3.25: ledgers and vendor payouts.
   - Add planner vendor service payments ledger.
   - Enhance existing vendor payouts page.
   - Add refund request/decision UI and email wrappers if approved.

Do not begin implementation until Chris answers the open questions above.
