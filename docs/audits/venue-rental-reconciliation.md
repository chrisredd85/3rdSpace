# Venue Rental Reconciliation

Date: 2026-05-30
Repo snapshot: `0176d2b fix(money-flow): regenerate types + tighten transfer namespace before Phase 2 (#9)`

This is a read-only reconciliation for Phase 2, Builder -> Venue rental payment. It answers what already exists, what is missing, and what needs a human decision before implementation.

## 1. Sources Inspected

- `AGENTS.md`: planner model and approval rule at lines 10-14; route boundaries and no new `(dashboard)` routes at lines 29-47; execution modes and no auto-execution at lines 60-71; reusable booking and Stripe tables at lines 75-91; design system at lines 125-138; hard rules for cents, RLS, and dashboard boundaries at lines 161-170.
- `MONEY_FLOW_SANITY_CHECK.md`: Phase 2 marked not started at lines 57-67; prior webhook/money/schema findings at lines 81-135; Phase 2 readiness blockers listed at lines 181-196. Those blockers are now addressed by PR #9 at `0176d2b`.
- `lib/types/database-generated.ts`: `event_kickback_agreements` at lines 1634-1692; `kickback_payments` at lines 2884-2921; `payment_intents` at lines 3583-3650; `vendor_transactions` at lines 6057-6078; `venue_bookings` at lines 6284-6397; `venue_opportunity_invites` at lines 6578-6607; `venue_stripe_accounts` found at line 6836; `venues` at lines 6880-6948.
- `supabase/migrations/20260420000000_remote_baseline.sql`: `venue_bookings` table at lines 1326-1354; indexes at lines 2313-2333; updated_at trigger at line 2381; fee trigger at line 2397; FKs at lines 2827-2838; RLS policies at lines 3036 and 3206; RLS enabled at line 3404.
- `supabase/migrations/20260428143000_add_venue_bulk_approval.sql`: approval columns at lines 17-27; approval audit table at lines 29-48; auto-approval uses `COALESCE(NEW.final_price, NEW.quoted_price, 0)` at line 95; trigger at lines 142-147.
- `supabase/migrations/20260504000016_add_planner_deposit_payments.sql`: existing `payment_intents`/`payouts` authorization tables at lines 6-49; status comments and indexes at lines 51-67; update triggers at lines 69-79; RLS at lines 81-141.
- `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql`: venue cents columns at lines 111-115; backfill at lines 117-120; constraints/comments at lines 179-212; sync trigger behavior at lines 220-240.
- `app/api/webhooks/stripe/route.ts`: PR #9 kickback transfer namespace constant at line 26; kickback-only transfer gate at lines 56-60; unrecognized transfer logging at lines 63-68; kickback transfer update by transfer id at lines 166-185; invoice-created kickback transfer metadata at lines 212-221; checkout/invoice/payment/charge/transfer dispatch at lines 355-475.
- `app/api/venue/kickbacks/[id]/checkout/route.ts`: existing Checkout Session destination-charge pattern at lines 151-188; invoice pattern and ACH/card payment settings at lines 281-305; venue customer metadata at lines 475-481.
- `app/api/payments/create-intent/route.ts`: existing vendor PaymentIntent route was inspected; it creates PaymentIntents for `deposit` and `final_payment`, writes `vendor_transactions`, and does not yet set `payment_kind_namespace`.
- `app/api/payments/confirm/route.ts`: existing vendor confirmation route was inspected; it retrieves a succeeded PaymentIntent, calls `createVendorTransfer`, then marks `vendor_transactions` and `vendor_bookings` paid.
- `app/api/payments/vendor/route.ts`: existing direct vendor destination-charge route was inspected; it remains active and does not set namespace metadata.
- `lib/payments/vendor-payments.ts`: canonical imported money helpers at lines 5-10; re-export at line 63; amount calculation at lines 75-87; vendor Connect readiness at lines 190-214; transfer creation metadata at lines 227-240.
- `lib/stripe/connect.ts`: Stripe client creation at lines 62-77; account status helpers at lines 87-118; save vendor/venue/builder Stripe accounts at lines 165-259; venue owner auth at lines 300-367; builder payout owner auth at lines 369-404.
- `lib/money.ts`: canonical money helper file exists and is used by newer payment code. `lib/payments/vendor-payments.ts` imports from it at lines 5-10.
- `lib/email.ts`: generic email wrapper at lines 40-112; kickback notification wrapper pattern starts at lines 114-166; paid/failure/refund wrappers at lines 187-301.
- `app/(planner)/planner/page.tsx`: approval card renders in focused and message views at lines 3457-3468 and 4067-4077; inline approval component starts at lines 4935-4968; authorization handler at lines 5086-5110; edit flow contains an inline `Math.round(amountValue * 100)` at line 5135; "Authorize" button at lines 5353-5357.
- `components/planner/PlannerLivePlanPanel.tsx`: derives approval summaries from `approval_request` messages at lines 500-530; artifact authorization cards render at lines 1235-1295.
- `components/planner/BookedPartnersWorkspace.tsx`: booked partner payment status shape at lines 115-120; partner payment summary display at lines 319-324; payment status card and "Mark deposit placed" placeholder at lines 401-429; mapping from workspace payment status at lines 557-566.
- `app/(planner)/planner/payments/page.tsx`: existing builder payments ledger loads `/api/builder/payouts/summary` at lines 73-83; refund decision route at lines 119-150; page copy at lines 163-178; refund request UI at lines 212-264; builder payout ledger at lines 322-360.
- `app/(dashboard)/venue/payouts/page.tsx`: existing venue payout page type at lines 56-89; card copy mentions deposits/kickbacks at lines 91-100; loads `/api/venue/kickbacks/summary` at lines 338-345; starts checkout at lines 428-438; refund request flow at lines 443-484; page copy at lines 509-513; settlement metrics at lines 631-662; row actions at lines 858-892.
- `app/api/builder/payouts/summary/route.ts`: builder kickback ledger endpoint selects `kickback_payments` at lines 56-70, enriches by agreements/plans/venues at lines 83-155, and returns summary/payments at lines 157-167.
- `app/api/venue/kickbacks/summary/route.ts`: venue kickback ledger endpoint selects `kickback_payments` at lines 59-67, enriches by agreements/events/builders/plans at lines 78-144, and returns summary/payments at lines 146-155.
- `app/api/vendor/payouts/summary/route.ts`: vendor payout endpoint selects `vendor_transactions` at lines 47-58, enriches via `vendor_bookings` at lines 63-86, and returns summary/transactions at lines 88-98.
- `app/api/builder/venue-bookings/route.ts`: existing builder-created venue booking request estimates price from venue hourly rate at lines 57-62 and inserts `venue_bookings` with `quoted_price`, `subtotal`, `total_amount`, and `payment_status='pending'` at lines 166-183.
- `app/api/venue/bookings/[id]/route.ts`: venue owner confirms/declines bookings and can set `final_price`/`quoted_price` at lines 49-90.
- `lib/bookings/venue-booking-adapter.ts`: selected venue booking details at lines 21-68; DTO maps `payment_status === 'succeeded'` to `deposit_paid` at lines 88-103; update mapper includes `final_price` and `quoted_price` at lines 122-156.
- `lib/planner/depositPayments.ts`: existing planner deposit authorization record shape at lines 8-24; explicit authorization and manual capture flow at lines 44-105 and 107-156; Stripe metadata uses `payment_kind: 'planner_deposit'` at lines 235-251.
- Stripe best-practices skill references: Checkout Sessions are recommended for one-time on-session payments; Connect marketplace guidance recommends choosing one charge type and starting with destination charges for most platforms.

## 2. Existing Schema Inventory

`venue_payment_transactions` does not exist. Grep found no table, type, migration, route, or UI usage matching `venue_payment_transactions` or `venue_rental`. Generated types jump from `venue_opportunity_invites` and `venue_stripe_accounts` to `venues`; there is no rental payment ledger table in `lib/types/database-generated.ts`.

There is an existing `payment_intents` table, but it is not the right replacement for Phase 2. It was created for planner partner deposit authorization, not venue rental settlement. Its columns are `plan_id`, `approval_id`, `partner_kind`, `partner_id`, `amount_cents`, `status`, `stripe_payment_intent_id`, `authorized_at`, `captured_at`, `refund_terms`, and `platform_fee_cents` (`supabase/migrations/20260504000016_add_planner_deposit_payments.sql:6-30`; generated type at `lib/types/database-generated.ts:3583-3650`). It has no `venue_booking_id`, no builder/venue/owner denormalization for RLS, no checkout session id, no charge id, no transfer id, no refund ids, and no Stripe transfer reversal id. Keep it as a planner deposit authorization table, not the Phase 2 ledger.

`venue_bookings` already stores venue rental/request amounts, but in legacy numeric dollar fields, not cents. The table has `quoted_price`, `final_price`, `subtotal`, `platform_fee_amount`, `total_amount`, `stripe_payment_intent_id`, `payment_status`, and `paid_at` (`supabase/migrations/20260420000000_remote_baseline.sql:1326-1354`; generated type at `lib/types/database-generated.ts:6284-6314`). The builder booking route writes `quoted_price`, `subtotal`, `total_amount`, and `payment_status='pending'` when creating a pending request (`app/api/builder/venue-bookings/route.ts:166-183`). Venue owners can later update `final_price` or `quoted_price` when confirming/declining (`app/api/venue/bookings/[id]/route.ts:49-90`).

`venue_bookings` has useful agreement semantics and RLS, but it is not a payment transaction ledger. It has FKs to `events`, `users`, and `venues` (`lib/types/database-generated.ts:6375-6397`), indexes for event/organizer/status/payment status/Stripe intent (`supabase/migrations/20260420000000_remote_baseline.sql:2313-2333`), RLS for organizer and venue owner reads (`supabase/migrations/20260420000000_remote_baseline.sql:3036`, `3206`), and an updated_at trigger (`supabase/migrations/20260420000000_remote_baseline.sql:2381`). It cannot safely represent multiple payment attempts, partial refunds, transfer reversals, or Stripe checkout lifecycle by itself.

The source of truth for venue rental price is mixed:

- Static listing estimates exist on `venues`: canonical cents fields `hourly_rate_cents`, `daily_rate_cents`, `price_per_night_cents`, and `deposit_amount_cents` (`lib/types/database-generated.ts:6898-6909`, `6927`; migration comments at `supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:204-212`). Legacy dollar fields remain (`deposit_amount`, `hourly_rate`).
- Per-event booking amounts exist on `venue_bookings`: `quoted_price`, `final_price`, `subtotal`, and `total_amount` (`lib/types/database-generated.ts:6293-6311`). Auto-approval already treats `final_price` then `quoted_price` as the booking amount (`supabase/migrations/20260428143000_add_venue_bulk_approval.sql:95`).
- Recommendation-time estimates exist in planner code. `lib/planner/opportunityBuilder.ts` estimates venue price cents from `venue.hourly_rate` and minimum hours, with a legacy heuristic that treats values over 1000 as cents and smaller values as dollars (`lib/planner/opportunityBuilder.ts:628-646`). `lib/planner/commercialModelRanker.ts` treats flat rental outlay as a model output at lines 165-187.

Recommended anchor: use `venue_bookings` as the agreement/approval anchor when present. A `venue_payment_transactions.venue_booking_id` FK should be nullable only to support planner-origin rows before an actual `venue_bookings` record exists. For the first implementation, prefer requiring a confirmed `venue_booking_id` so payment amount comes from server-controlled booking data, not an arbitrary client-provided amount.

New Phase 2 schema needed:

- `venue_payment_transactions` table.
- RLS policies for builder reads, venue owner reads, and service-role writes.
- Indexes and unique constraints for idempotency.
- A trigger for `updated_at`.
- Generated Supabase types after migration.

Overlap already in regenerated types:

- `venues` has canonical listing cents fields.
- `venue_bookings` has legacy per-booking price and payment status fields.
- `payment_intents`/`payouts` cover planner deposit authorization but not settlement.
- No generated type overlaps enough to avoid adding `venue_payment_transactions`.

## 3. Proposed Schema Mapping

Recommended table: `public.venue_payment_transactions`.

| Column | Type | Nullable | Default | Index | Purpose |
|---|---|---|---|---|---|
| `id` | `uuid` | No | `gen_random_uuid()` | Primary key | Stable transaction id used in Stripe metadata. |
| `plan_id` | `uuid` FK to `plans(id)` | No | None | `idx_venue_payment_transactions_plan_id` | Planner plan owner and ledger grouping. |
| `venue_booking_id` | `uuid` FK to `venue_bookings(id)` | Yes | None | `idx_venue_payment_transactions_booking_id`; partial unique with `plan_id` | Agreement anchor when a real booking exists. |
| `builder_id` | `uuid` FK to `users(id)` | No | None | `idx_venue_payment_transactions_builder_id` | Auth/RLS and builder ledger filtering. |
| `venue_id` | `uuid` FK to `venues(id)` | No | None | `idx_venue_payment_transactions_venue_id` | Venue ledger filtering and joins. |
| `venue_owner_id` | `uuid` FK to `users(id)` | No | None | `idx_venue_payment_transactions_owner_id` | Venue-owner RLS even if venue data changes. |
| `amount_cents` | `integer` | No | None | None | Principal rental amount in cents. Check `amount_cents >= 50`. |
| `processing_fee_cents` | `integer` | No | `0` | None | Optional builder-paid processing fee or platform-absorbed fee tracking. Needs product decision. |
| `application_fee_cents` | `integer` | No | `0` | None | Future platform fee support. For Phase 2, keep zero. |
| `venue_payout_cents` | `integer` | No | None | None | Amount intended for venue. For 100 percent pass-through, equals `amount_cents`. |
| `currency` | `text` | No | `'usd'` | None | USD-only for now. Check `currency='usd'`. |
| `status` | `text` | No | `'pending_builder_payment'` | `idx_venue_payment_transactions_status` | Payment lifecycle. See Section 4. |
| `stripe_checkout_session_id` | `text` | Yes | None | Unique | Checkout idempotency and webhook matching. |
| `stripe_payment_intent_id` | `text` | Yes | None | Unique | PaymentIntent webhook matching. |
| `stripe_charge_id` | `text` | Yes | None | Index optional | Charge/refund lookup. |
| `stripe_transfer_id` | `text` | Yes | None | Unique, nullable | Transfer event lookup. |
| `stripe_refund_id` | `text` | Yes | None | Index optional | Refund tracking. |
| `stripe_transfer_reversal_id` | `text` | Yes | None | Index optional | Transfer reversal tracking. |
| `refund_amount_cents` | `integer` | Yes | None | None | Requested/approved refund amount. |
| `refund_reason` | `text` | Yes | None | None | Builder-visible/venue-visible reason. |
| `refund_requested_by` | `uuid` FK to `users(id)` | Yes | None | None | Actor requesting refund. |
| `refund_requested_at` | `timestamptz` | Yes | None | None | Request timestamp. |
| `refund_approved_by` | `uuid` FK to `users(id)` | Yes | None | None | Actor approving refund. |
| `refund_approved_at` | `timestamptz` | Yes | None | None | Approval timestamp. |
| `paid_at` | `timestamptz` | Yes | None | None | Builder payment success timestamp. |
| `transfer_completed_at` | `timestamptz` | Yes | None | None | Transfer observed timestamp if separated from paid state. |
| `failed_at` | `timestamptz` | Yes | None | None | Failed payment timestamp. |
| `failure_reason` | `text` | Yes | None | None | Stripe or app failure reason. |
| `created_at` | `timestamptz` | No | `now()` | Default ordering | Row creation. |
| `updated_at` | `timestamptz` | No | `now()` | None | Required with a moddatetime/update trigger. `kickback_payments` lacks this; do not repeat that. |

Constraints and indexes:

- Primary key on `id`.
- Check `amount_cents >= 50`, `processing_fee_cents >= 0`, `application_fee_cents >= 0`, `venue_payout_cents >= 0`.
- Check `currency = 'usd'`.
- Check status values from Section 4.
- Unique `stripe_checkout_session_id` where not null.
- Unique `stripe_payment_intent_id` where not null.
- Unique `stripe_transfer_id` where not null.
- Partial unique index on `(plan_id, venue_booking_id)` where `venue_booking_id IS NOT NULL` to prevent duplicate active payment rows for the same booking.
- Consider partial unique active row index on `(plan_id, venue_id)` where `venue_booking_id IS NULL AND status IN ('pending_builder_payment','checkout_created','paid')`.

RLS:

- Builder can select rows where `builder_id = auth.uid()` or where `plan_id` belongs to a plan with `plans.user_id = auth.uid()`.
- Venue owner can select rows where `venue_owner_id = auth.uid()` or `venues.owner_id = auth.uid()`.
- Builder insert should happen through server route/service role only; if authenticated insert policy is added, constrain it to own plan and matching `builder_id`.
- Venue owner update only for refund decision fields if the API ever bypasses service role. Recommended: service role full management and authenticated read-only policies.
- Service role full access.

Divergence from likely Phase 2 assumptions:

- Do not rely only on `venue_bookings.payment_status` as the transaction ledger. It is useful as a denormalized status but too small for Stripe lifecycle.
- Include `processing_fee_cents` even if Phase 2 sets it to zero initially; otherwise the fee decision will be undocumented.
- Include `updated_at` and trigger from day one.

## 4. Status Enum Decision

Proposed lifecycle from the spec:

- `pending_builder_payment`
- `checkout_created`
- `paid`
- `transfer_complete`
- `refund_requested`
- `refund_approved`
- `refunded_partial`
- `refunded_full`
- `cancelled`
- `failed`

Recommendation: use the full set, but treat `transfer_complete` as conditional on the Stripe pattern.

If Phase 2 uses Checkout Session with destination charge (`payment_intent_data.transfer_data.destination`), `paid` and `transfer_complete` are mostly redundant from a business-state perspective because funds are routed to the connected account as part of the charge. The webhook may still learn the `stripe_transfer_id` after the `checkout.session.completed` handler via the expanded charge or `transfer.created`, but no separate application transfer job is needed. In that design, use:

- `pending_builder_payment`
- `checkout_created`
- `paid`
- `refund_requested`
- `refund_approved`
- `refunded_partial`
- `refunded_full`
- `cancelled`
- `failed`

Keep `transfer_completed_at` nullable for observability, but do not make `transfer_complete` a required state unless implementation chooses separate charge + transfer.

If Phase 2 instead uses separate charge + manual transfer, then `paid` and `transfer_complete` are distinct:

- `paid` = builder payment succeeded and platform holds funds.
- `transfer_complete` = transfer to venue Connect account was created/observed.

Given the recommended destination-charge pattern in Section 5, the implementation should skip `transfer_complete` as a status and record the transfer id/timestamp while remaining `paid`.

Naming consistency:

- `kickback_payments` uses `paid`, `completed`, `refund_requested`, `refund_approved`, `refund_processing`, `refunded_partial`, and `refunded_full` in API/UI summaries (`app/api/builder/payouts/summary/route.ts:157-164`; `app/api/venue/kickbacks/summary/route.ts:146-152`).
- Venue rental should prefer `paid` over `succeeded` for the main row to align with kickbacks, while optionally updating `venue_bookings.payment_status` to legacy `succeeded` because that table has an existing check constraint (`supabase/migrations/20260420000000_remote_baseline.sql:1352`).

## 5. Stripe Pattern Decision

Recommendation: Stripe Checkout Session using a destination charge.

Why:

- The builder is making an on-session, user-approved payment. Stripe guidance favors Checkout Sessions for one-time on-session payments.
- The app already uses Checkout Sessions with `payment_intent_data.transfer_data.destination` for kickback checkout (`app/api/venue/kickbacks/[id]/checkout/route.ts:163-188`).
- The older vendor direct route also uses `transfer_data.destination` with `application_fee_amount: 0` (`app/api/payments/vendor/route.ts` inspected; destination charge behavior is present there).
- Checkout reduces SCA and payment-method handling complexity versus custom PaymentIntent UI.
- Invoice is semantically wrong for builder-paid venue rental. The invoice pattern is appropriate for venue-to-builder kickback settlement, where the venue owes after an event (`app/api/venue/kickbacks/[id]/checkout/route.ts:281-305`).

Charge mechanism:

- Use Checkout Session `mode: 'payment'`.
- Use `payment_intent_data.transfer_data.destination = venueStripeAccountId`.
- Set `payment_intent_data.application_fee_amount = 0` for now if the implementation explicitly wants no platform fee.
- Set `payment_intent_data.metadata`, session `metadata`, and line item product metadata with the same identifiers.
- Use an idempotency key like `venue_rental_checkout_${venuePaymentTransactionId}_${amountCents}`.

Required metadata:

- `payment_kind_namespace: 'venue_rental'`
- `venue_payment_transaction_id`
- `plan_id`
- `venue_booking_id` when present
- `venue_id`
- `venue_owner_id`
- `builder_id`

Payment method types:

- Default recommendation: let Checkout dynamic payment methods decide, or explicitly allow `['card', 'us_bank_account']` only if product wants ACH available on this route.
- Kickback invoices explicitly allow `['us_bank_account', 'card']` (`app/api/venue/kickbacks/[id]/checkout/route.ts:302-304`), but rental Checkout is different. ACH has slower settlement and failure windows. Card-only is simpler; card + ACH is lower cost for larger venue rentals.
- Human decision needed: whether builder UX should allow ACH for venue rental. See Section 11.

Fee decision:

- "100 percent pass-through to venue" can mean no platform fee, but Stripe fees still exist. With destination charges, fee/liability behavior depends on Connect account/controller configuration. Phase 2 must decide whether Stripe processing fee is absorbed by the platform, added to the builder total, or effectively borne by the connected venue through account settings. Do not leave this implicit.

## 6. Webhook Routing Plan

Current state: PR #9 prevents accidental kickback mutation, but the transfer gate is kickback-only. `isKickbackTransferEvent` accepts only `payment_kind_namespace === 'venue_builder_kickback'` or `kickback_payment_id` (`app/api/webhooks/stripe/route.ts:56-60`). `transfer.created`, `transfer.updated`, and `transfer.reversed` call kickback logic only when that function passes; otherwise they log and drop (`app/api/webhooks/stripe/route.ts:452-475`).

Therefore, Phase 2 must extend webhook routing before creating any `venue_rental` transfer events. Otherwise legitimate venue rental transfer events will be logged as "no recognized namespace" and ignored.

Recommended implementation shape:

- Replace the kickback-only transfer predicate with a namespace router:
  - `venue_builder_kickback` -> kickback handler.
  - `venue_rental` -> venue rental handler.
  - Later `vendor_payment` -> vendor payment handler.
  - no namespace -> builder subscription fallback where applicable, or log/drop for transfer events.

Event routing:

`checkout.session.completed`

- Gate first on `session.metadata.payment_kind_namespace === 'venue_rental'`.
- If venue rental, load `venue_payment_transactions.id = session.metadata.venue_payment_transaction_id`.
- Record `stripe_checkout_session_id`, `stripe_payment_intent_id`, `paid_at`, and status `paid`.
- If using destination charge, retrieve/expand PaymentIntent latest charge as the kickback handler already does via `getChargeFromPaymentIntent` (`app/api/webhooks/stripe/route.ts:33-48`, `70-80`) and store `stripe_charge_id`, `stripe_transfer_id`, and receipt URL if available.
- Update `venue_bookings.payment_status = 'succeeded'`, `paid_at = now()`, and `stripe_payment_intent_id`.
- Send builder and venue notification emails.
- Return handled so `applyCheckoutSessionCompleted` for builder billing is not called.

`payment_intent.succeeded`

- Gate on `paymentIntent.metadata.payment_kind_namespace === 'venue_rental'`.
- Idempotently update the same transaction if checkout completion has not already done so.
- Do not let venue rental PaymentIntents fall through to planner deposit or kickback handlers (`app/api/webhooks/stripe/route.ts:428-435` currently tries planner deposit first, then kickback).

`payment_intent.payment_failed`

- Gate on `paymentIntent.metadata.payment_kind_namespace === 'venue_rental'`.
- Set status `failed`, `failed_at`, `failure_reason`.

`charge.refunded`

- Gate by PaymentIntent/charge/refund metadata when available, or by `stripe_charge_id`.
- Set `refunded_partial` or `refunded_full` based on refunded cents versus `amount_cents`.
- Store `stripe_refund_id` where available.
- Current `charge.refunded` falls through from kickback to planner deposit only (`app/api/webhooks/stripe/route.ts:438-449`); Phase 2 must add venue rental before the planner fallback.

`transfer.created` and `transfer.updated`

- Extend the transfer namespace router to recognize `payment_kind_namespace === 'venue_rental'`.
- For destination charges, store/confirm `stripe_transfer_id` and optionally `transfer_completed_at`.
- Do not mutate `kickback_payments`.

`transfer.reversed`

- Extend the namespace router to recognize `venue_rental`.
- Update status to `refunded_partial`/`refunded_full` only if paired with an approved refund path or Stripe reversal metadata.
- Store `stripe_transfer_reversal_id`.

Namespace isolation proof needed in tests:

- Kickbacks: `payment_kind_namespace='venue_builder_kickback'` and/or `kickback_payment_id`.
- Venue rentals: `payment_kind_namespace='venue_rental'` and `venue_payment_transaction_id`.
- Vendor payments: later `payment_kind_namespace='vendor_payment'`.
- Builder subscriptions: no namespace metadata and use billing handlers only for invoice/checkout events, not transfers.

## 7. Route Plan

| Route | Add/Modify | Purpose | Auth |
|---|---|---|---|
| `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts` | Add | Builder starts a venue rental Checkout Session from an approved plan/venue booking. Creates or reuses `venue_payment_transactions`. | Authenticated `community_builder`; plan owner; confirmed venue booking; venue Connect ready. |
| `app/api/planner/plans/[planId]/venue-payment/refund-request/route.ts` | Add | Builder requests a refund of a paid venue rental. | Plan owner/builder. |
| `app/api/venue/payments/[id]/refund-decision/route.ts` | Add | Venue owner approves/rejects a builder refund request. | Authenticated venue owner for `venue_owner_id` or owning venue. |
| `app/api/planner/payments/venue-rentals/summary/route.ts` | Add or combine into a new planner ledger endpoint | Builder planner payments page needs outgoing venue rental payments. Existing `/api/builder/payouts/summary` is for incoming kickback payouts, not outgoing rentals. | Authenticated builder, own plans only. |
| `app/api/venue/payments/summary/route.ts` | Add | Venue payouts page needs incoming rental payments separate from outgoing kickback obligations. Existing `/api/venue/kickbacks/summary` is kickback-only. | Authenticated venue owner. |
| `app/api/webhooks/stripe/route.ts` | Modify | Add venue rental handlers and extend transfer namespace routing. | Stripe signature. |
| `lib/payments/venue-rental.ts` | Add | Shared amount resolution, Connect readiness, Checkout creation parameters, refund execution, webhook idempotency helpers. | Server-only helper. |
| `lib/email.ts` | Modify | Add venue rental payment/refund notification wrappers mirroring kickback wrappers. | Server-only email helper. |

No new files under `app/(dashboard)`. Existing dashboard file `app/(dashboard)/venue/payouts/page.tsx` can be modified because AGENTS.md only forbids new dashboard expansion, not maintenance of the existing route.

Reuse opportunities:

- Reuse `getAuthenticatedVenueOwner`, `getStripeClient`, and `getAppBaseUrl` from `lib/stripe/connect.ts`.
- Reuse `validateStripeConnectAccount` pattern from kickback checkout.
- Reuse `dollarsToCents`, `centsToDollars`, and `readCents` directly from `lib/money.ts`.
- Do not reuse `payment_intents` as the settlement ledger; it is an authorization table.

## 8. UI Integration Surface

Venue approval cards currently render inline in `app/(planner)/planner/page.tsx`, not a separate `components/planner/PlannerApprovalCard.tsx` file. The focused approvals tab renders `PlannerApprovalCard` at lines 3457-3468, and message cards render the same component at lines 4067-4077. The component is declared in the same file at lines 4935-4968.

Current placeholder behavior:

- `PlannerApprovalCard` records authorization through `/api/planner/plans/${planId}/approvals` (`app/(planner)/planner/page.tsx:5063-5071`).
- It does not move money; after approval it shows "Authorization recorded ... pending execution" (`app/(planner)/planner/page.tsx:5290-5312`).
- The active button label is `Authorize` unless it is venue outreach, where it becomes `Approve and send` (`app/(planner)/planner/page.tsx:5353-5357`).
- The edit path uses `Math.round(amountValue * 100)` (`app/(planner)/planner/page.tsx:5135`), which should not be copied into Phase 2.

The live plan panel has a separate artifact-style authorization display. It derives approvals from `approval_request` messages (`components/planner/PlannerLivePlanPanel.tsx:500-530`) and renders "Payment + Agent Authorization" cards with `Authorize`/`Approve` buttons (`components/planner/PlannerLivePlanPanel.tsx:1235-1295`). Phase 2 should verify whether this panel is only a summary/control surface or whether it also needs the venue rental payment button.

Booked partner workspace has another likely integration point after a venue relationship is accepted. It exposes payment status fields (`components/planner/BookedPartnersWorkspace.tsx:115-120`), shows a payment summary in the partner list (`components/planner/BookedPartnersWorkspace.tsx:319-324`), and has a "Payment Status" card with "Mark deposit placed" and "Upload contract" placeholders (`components/planner/BookedPartnersWorkspace.tsx:401-429`). This may be a better surface for "Pay venue rental" after a booking is confirmed than the original approval card alone.

Planner payments ledger exists at `app/(planner)/planner/payments/page.tsx`. It currently loads only `/api/builder/payouts/summary` (`app/(planner)/planner/payments/page.tsx:73-83`) and renders a "Builder Payout Ledger" for venue-to-builder revenue share (`app/(planner)/planner/payments/page.tsx:322-360`). Phase 2 needs a separate outgoing "Venue rental payments" section or a unified ledger endpoint; do not overload the builder payout endpoint.

Venue payout dashboard exists at `app/(dashboard)/venue/payouts/page.tsx`. It currently loads only `/api/venue/kickbacks/summary` (`app/(dashboard)/venue/payouts/page.tsx:338-345`) and frames the page as Stripe readiness plus venue-to-builder settlement invoices/refunds (`app/(dashboard)/venue/payouts/page.tsx:509-513`). Phase 2 can add a "Rental payments received" section to this existing page without adding a new dashboard route.

New components likely needed under planner/components:

- A small reusable `VenueRentalPaymentButton` or `VenueRentalCheckoutButton` under `components/planner/` if the payment action must appear in both approval cards and booked partner workspace.
- A `VenueRentalLedgerSection` under `components/planner/` if planner payments page would become too large.

Use existing components where possible, but the current approval card is embedded inside a large page file. Extracting a payment subcomponent may reduce risk if tests cover it.

## 9. Money Rules

Current enforcement:

- `lib/money.ts` is the canonical helper location. `lib/payments/vendor-payments.ts` imports `centsToDollars`, `dollarsToCents`, and `readCents` from `@/lib/money` at lines 5-10 and re-exports them at line 63.
- Newer ledger routes use `readCents` from `@/lib/money`, e.g. `app/api/builder/payouts/summary/route.ts:3-5` and `app/api/venue/kickbacks/summary/route.ts:2-5`.
- Venue listing cents columns are canonical after PR #9, with comments identifying legacy dollar fields (`supabase/migrations/20260527000001_normalize_marketplace_money_cents.sql:204-212`).

Known debt still present:

- `lib/planner/vendorEconomicsCosts.ts` still has a local `dollarsToCents` at lines 259-262.
- `app/(planner)/planner/analytics/page.tsx` still has local money helpers at lines 903-908.
- `app/(planner)/planner/page.tsx` has inline `Math.round(amountValue * 100)` at line 5135.
- `lib/planner/opportunityBuilder.ts` has a legacy heuristic that converts smaller values by `* 100` at lines 643-646.

Recommendation:

- Phase 2 should use `@/lib/money` directly and introduce no new inline `* 100`, `/ 100`, or local duplicate helper.
- Phase 2 should not be blocked on cleaning all existing debt unless implementation must touch those files. If touching `app/(planner)/planner/page.tsx` for payment buttons, replace the specific edited-path conversion with `dollarsToCents` rather than preserving the inline conversion.
- Store all new Phase 2 amounts as integer cents only.
- Do not write floats into `venue_payment_transactions`.
- For `venue_bookings`, preserve legacy numeric fields for compatibility, but derive and persist the Phase 2 transaction amount in cents at checkout creation.
- Refund math should mirror kickback/vendor semantics: refund principal can be partial or full; Stripe processing fees are not automatically refunded unless product explicitly decides otherwise.

## 10. Tests Required

Schema migration test:

- Assert `venue_payment_transactions` exists with all required columns, cents checks, status check, FKs, indexes, unique constraints, `updated_at` trigger, and RLS enabled.
- Assert RLS policies allow builder read and venue owner read but block unrelated authenticated users.

Checkout route tests:

- Plan owner can create/reuse a venue rental Checkout Session for a confirmed `venue_booking_id`.
- Non-owner receives 403/404.
- Missing or unconfirmed booking returns 409/422.
- Missing amount returns 409/manual review.
- Missing venue owner Connect account returns a clear 409 with onboarding/manual action metadata.
- Checkout metadata contains `payment_kind_namespace='venue_rental'`, `venue_payment_transaction_id`, `plan_id`, `venue_booking_id`, `venue_id`, `venue_owner_id`, and `builder_id`.
- Idempotency returns/reuses the same active transaction/session for double click.

Webhook namespace tests:

- `checkout.session.completed` with `venue_rental` updates only `venue_payment_transactions`.
- `payment_intent.succeeded` with `venue_rental` is idempotent.
- `payment_intent.payment_failed` with `venue_rental` marks failed.
- `charge.refunded` with `venue_rental` marks partial/full refund.
- `transfer.created`, `transfer.updated`, and `transfer.reversed` with `venue_rental` route to venue rental handler.
- `venue_builder_kickback` transfer still routes to kickback handler.
- unknown transfer namespace still logs/drops safely.
- builder subscription invoice events still reach billing handlers only when no marketplace namespace is present.

Refund route tests:

- Builder refund request route validates plan owner, paid status, amount bounds, and reason.
- Venue refund decision route validates venue owner, handles approve/reject, creates Stripe refund/reversal through mocked Stripe client, and updates transaction status.
- Idempotent repeat approval/reject does not double refund.

UI tests:

- Planner approval/partner card shows "Pay venue rental" or equivalent only after approval/confirmed booking state.
- Button calls checkout route and redirects to returned Checkout URL.
- Loading/error states render for Connect missing, checkout failure, and already-paid states.
- Planner payments page renders a venue rental section with event, venue, amount, status, paid_at, transfer id, and refund action.
- Venue payouts page renders "Rental payments received" with builder/event/amount/status/transfer id.
- Refund request/decision UI renders and calls the right routes.

Integration/mock Stripe test:

- Full mocked flow: checkout route -> checkout.session.completed webhook -> transfer event -> planner ledger -> venue ledger.
- Refund flow: builder refund request -> venue approval -> refund/reversal webhook -> both ledgers update.

## 11. Open Questions

1. Is venue rental amount fixed from listing or negotiated per plan?

Recommended answer: negotiated per booking. Use `venue_bookings.final_price` first, then `quoted_price`, then `total_amount`; require a confirmed `venue_booking_id` for Phase 2 checkout. Static `venues.*_cents` fields are recommendation/default inputs, not the payment source of truth. Rationale: current venue owner flow can set `final_price`/`quoted_price` (`app/api/venue/bookings/[id]/route.ts:49-90`), and auto-approval already treats those as booking amount (`supabase/migrations/20260428143000_add_venue_bulk_approval.sql:95`).

2. Who approves refunds?

Recommended answer: builder initiates refund, venue owner approves/rejects. Rationale: this matches the Phase 2 spec and the money direction. For kickbacks the venue requests and builder decides; for rental payments the builder requests and venue decides.

3. ACH, card, or both?

Recommended answer: start with Checkout dynamic payment methods or card-only for the first implementation unless product explicitly wants ACH. ACH is attractive for larger rental amounts, but slower settlement/failure windows complicate "paid" state. If ACH is enabled, represent `checkout_created` and `paid` carefully and avoid promising instant venue availability.

4. Is `transfer_complete` necessary?

Recommended answer: not if using Checkout destination charges. Use `paid` plus `stripe_transfer_id`/`transfer_completed_at`. Add `transfer_complete` only if choosing separate charge + manual transfer.

5. Destination charge or separate charge + transfer?

Recommended answer: Checkout destination charge. It matches Stripe marketplace guidance and existing kickback checkout code. Separate charge + transfer gives more control but increases operational risk and requires `paid` vs `transfer_complete` separation.

6. What happens when venue listings have no owner or no Connect account?

Recommended answer: block automated payment and route to concierge/admin queue. Do not create Checkout. `venues.owner_id` is nullable (`lib/types/database-generated.ts:6922`), and listings can be admin seeded. Payment to a venue without an owner/connect account violates the approval and Connect-readiness model.

7. Should there be min/max rental amount validation?

Recommended answer: yes. Minimum `amount_cents >= 50`. Maximum should be a product-configured limit, with high amounts requiring concierge/admin review. A default like `$25,000` or `$50,000` should be confirmed before implementation.

8. Who pays Stripe processing fees?

Recommended answer needed before implementation. "100 percent pass-through to venue" says no platform fee deducted from venue payout, but Stripe fees still exist. Options: platform absorbs, builder pays added processing fee, or connected venue bears fees through Connect configuration. This affects schema (`processing_fee_cents`), line item amount, and checkout copy.

9. What if venue Connect capability is lost after checkout creation but before payment completion?

Recommended answer: check Connect readiness at checkout creation, and in webhook mark transaction `failed`/`requires_manual_review` if Stripe reports a failure. For destination charges, Stripe should fail if destination cannot receive funds; do not silently mark paid.

10. Currency?

Recommended answer: USD-only for Phase 2. Enforce `currency='usd'`.

11. Idempotency and double-click prevention?

Recommended answer: create the transaction row first, use it in Stripe metadata, and use a unique partial index on `(plan_id, venue_booking_id)` plus Stripe idempotency key. If an active transaction exists, return its checkout URL/session if recoverable or create a new session only after marking the old one cancelled/failed.

12. Should existing `payment_intents`/`payouts` be reused?

Recommended answer: no. They support planner deposit authorization and manual capture, not venue rental settlement. They can inform approval-gating tests, but adding all rental/refund/transfer fields there would blur concepts and risk regressions.

13. Should the planner payment button live on approval cards or booked partner workspace?

Recommended answer: both may be needed, but first implementation should put the payment action where the confirmed venue booking is visible. The approval card is good for authorizing outreach/terms; the booked partner workspace already exposes payment status and a "Mark deposit placed" placeholder. The implementation should avoid paying before venue terms are confirmed.

## 12. Recommendation

**NEEDS HUMAN DECISION**

No hard repository blocker prevents Phase 2 implementation. PR #9 has landed, generated types are current, and the dangerous kickback transfer fallback is guarded. The repo has enough existing primitives to implement venue rental payments safely.

Minimum human decisions before code:

1. Confirm payment amount source: recommended `venue_bookings.final_price || quoted_price || total_amount`, with confirmed `venue_booking_id` required.
2. Confirm Stripe pattern: recommended Checkout Session destination charge.
3. Confirm fee handling: platform absorbs Stripe fees, builder pays a processing fee, or connected venue bears Stripe fees.
4. Confirm ACH support: dynamic/card-only first, or explicitly card + ACH.
5. Confirm status set: recommended no `transfer_complete` status if using destination charge.
6. Confirm maximum payment threshold for concierge review.
7. Confirm UI primary surface: booked partner workspace plus planner payments ledger, with approval card only starting payment after booking terms are confirmed.

Implementation can begin after those decisions. The first implementation commit should be the schema migration plus generated types for `venue_payment_transactions`, with RLS and idempotency constraints, then stop for review before route/webhook/UI commits.
