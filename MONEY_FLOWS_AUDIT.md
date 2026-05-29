# Money Flows Audit

Date: 2026-05-27
Repo: `/Users/chrisredd/3rdSpace.webapp`
Branch inspected: `codex/rev-share-settlement-schema`
Scope: 3rdPlace marketplace money flows and vendor/venue pricing self-service capabilities.

## 1. Executive Summary

No. If a builder signed up today, they could create a plan, approve planner outreach/hold requests, browse catalog pricing signals, and potentially use some standalone vendor-payment backend routes if a confirmed vendor booking already existed and the vendor had completed Stripe Connect. They could not complete the full launch-critical money lifecycle end-to-end. Venue rental payment is missing. Vendor deposit/final payment has schema and backend routes but no reachable planner approval/payment UI. Venue-to-builder kickback settlement is partial, not merged to `main`, and still lacks the invoice settlement branch, refund decision flow, notifications, compliance gate, and real planner ledger. Builder-to-platform billing exists, but the inspected code grants one free event, not the expected two, and the planner plan POST route does not call a plan-creation billing gate. Venue bank payout for rental payments does not exist today; vendor payouts require Connect and a payment route that is not wired into the planner flow.

## 2. Sources Inspected

- Git state: `git branch --show-current`, `git log main --oneline -n 20`, `git log --oneline main..HEAD`
- `QA_REPORT.md:1-90`, `QA_REPORT.md:164-183`
- `RECONCILIATION.md:104-120`, `RECONCILIATION.md:165-218`
- `lib/types/database-generated.ts:1629-1680`, `lib/types/database-generated.ts:2836-2865`, `lib/types/database-generated.ts:4869-4912`, `lib/types/database-generated.ts:5319-5339`, `lib/types/database-generated.ts:5527-5640`, `lib/types/database-generated.ts:5926-5945`, `lib/types/database-generated.ts:6734-6800`
- `supabase/migrations/20260428161000_add_vendor_transactions.sql:21-49`
- `supabase/migrations/20260504000016_add_planner_deposit_payments.sql:1-58`
- `supabase/migrations/20260527000000_kickback_settlement_schema.sql:10-28`, `supabase/migrations/20260527000000_kickback_settlement_schema.sql:107-125`, `supabase/migrations/20260527000000_kickback_settlement_schema.sql:141-162`
- `app/api/builder/venue-bookings/route.ts:1-70`, `app/api/builder/venue-bookings/route.ts:111-190`
- `app/api/venue/deposit/route.ts`
- `app/api/vendor/deposit/route.ts`
- `app/api/planner/plans/route.ts:150-230`
- `app/api/planner/plans/[planId]/approvals/route.ts:266-315`
- `app/api/planner/plans/[planId]/payments/authorize/route.ts:1-95`
- `app/api/payments/create-intent/route.ts:1-190`
- `app/api/payments/confirm/route.ts:1-145`
- `app/api/payments/vendor/route.ts:170-245`
- `app/api/payments/capture/route.ts:1-105`
- `app/api/payments/refund/calculate/route.ts:17-60`
- `app/api/payments/refund/process/route.ts:45-115`, `app/api/payments/refund/process/route.ts:140-215`
- `app/api/venue/kickbacks/[paymentId]/checkout/route.ts:47-176`
- `app/api/venue/kickbacks/summary/route.ts:43-112`
- `app/api/builder/payouts/summary/route.ts:45-128`
- `app/api/webhooks/stripe/route.ts:50-112`, `app/api/webhooks/stripe/route.ts:203-290`
- `app/api/builder/billing/checkout/route.ts:1-50`
- `app/api/vendor/payouts/summary/route.ts:35-80`
- `app/(planner)/planner/payments/page.tsx:1-130`
- `app/(dashboard)/vendor/payouts/page.tsx:1-90`, `app/(dashboard)/vendor/payouts/page.tsx:230-360`
- `app/(dashboard)/vendor/services/page.tsx:34-58`, `app/(dashboard)/vendor/services/page.tsx:288-308`, `app/(dashboard)/vendor/services/page.tsx:639-705`, `app/(dashboard)/vendor/services/page.tsx:820-840`
- `app/(dashboard)/venue/pricing/page.tsx:1-180`, `app/(dashboard)/venue/pricing/page.tsx:220-560`
- `app/(planner)/planner/vendors/page.tsx:470-570`, `app/(planner)/planner/vendors/page.tsx:840-875`
- `components/auth/SignupExperience.tsx:820-930`, `components/auth/SignupExperience.tsx:1040-1105`, `components/auth/SignupExperience.tsx:1160-1245`, `components/auth/SignupExperience.tsx:1290-1395`
- `components/builder/DepositDisplay.tsx:40-80`, `components/builder/DepositDisplay.tsx:168-215`
- `components/builder/event-wizard/EventVenueStep.tsx:1-80`
- `components/builder/event-wizard/EventVendorStep.tsx:1-90`
- `components/builder/CancelBookingModal.tsx:80-125`
- `components/payments/PaymentForm.tsx`
- `components/shared/StripeIntegrationNotice.tsx:1-80`
- `components/vendor/ServiceListingForm.tsx:55-120`, `components/vendor/ServiceListingForm.tsx:175-240`
- `components/vendor/VendorServicesManager.tsx:21-70`
- `lib/billing/builder-billing.ts:1-25`, `lib/billing/builder-billing.ts:326-360`, `lib/billing/builder-billing.ts:532-612`, `lib/billing/builder-billing.ts:660-705`
- `lib/payments/vendor-payments.ts:90-245`
- `lib/payments/refund-calculator.ts:160-230`
- `lib/planner/catalogRanker.ts:500-560`, `lib/planner/catalogRanker.ts:850-890`
- `lib/planner/commercialModelRanker.ts:1-280`
- `lib/planner/depositPayments.ts:44-105`, `lib/planner/depositPayments.ts:126-156`, `lib/planner/depositPayments.ts:222-260`
- `lib/planner/opportunityBuilder.ts:560-660`
- `lib/planner/vendorEconomicsCosts.ts:70-170`, `lib/planner/vendorEconomicsCosts.ts:220-260`
- `lib/server/account-setup.ts:280-340`, `lib/server/account-setup.ts:400-465`
- `lib/stripe/connect.ts:1-90`
- `lib/venues/venue-adapter.ts:1-170`

## 3. Flow-by-Flow Findings

### Flow 1: Builder -> Venue Rental Payment

**Status: ❌ Missing**

**What exists**

- A builder can create a pending venue booking request. `app/api/builder/venue-bookings/route.ts` accepts venue/date/time/headcount only (`:6-15`), estimates price from `hourly_rate * minimum_hours` (`:57-60`, `:128-130`), creates an `events` row (`:134-155`), and inserts `venue_bookings` with `payment_status: 'pending'` (`:166-183`).
- Venue deposit terms exist as configuration. `components/builder/DepositDisplay.tsx` resolves `/api/venue/deposit` or `/api/vendor/deposit` (`:47-59`) and calculates fixed/percentage deposits (`:69-75`).
- Planner deposit schema exists and supports both partner kinds. `payment_intents.partner_kind` and `payouts.partner_kind` allow `venue` or `vendor`, with amounts stored as integer cents (`supabase/migrations/20260504000016_add_planner_deposit_payments.sql:6-49`).
- `lib/planner/depositPayments.ts` can create a manual-capture PaymentIntent when a payment method exists (`:44-105`) and can mark a local payout row after capture (`:126-153`).
- The planner commercial model ranker estimates and scores `flat_rental`, `minimum_spend`, `per_head_kickback`, `bar_revenue_share`, and `ticket_revenue_share` (`lib/planner/commercialModelRanker.ts:1-7`, `:104-145`, `:162-204`).

**What's missing**

- No `venue_payment_transactions` or equivalent table was found. Searches found `venue_stripe_accounts` and `venue_bookings.stripe_payment_intent_id`, but no venue rental transaction ledger.
- No builder-initiated venue rental route creates a Stripe PaymentIntent/Checkout Session with `transfer_data.destination` pointing to a venue Connect account. The only venue booking route writes pending booking records (`app/api/builder/venue-bookings/route.ts:166-183`).
- The planner approval card does not call the planner deposit payment route. `handleAuthorizationAction` only PATCHes approval status or POSTs a `hold_request` agent action (`components/planner/PlannerLivePlanPanel.tsx:857-899`); the button copy is "Approve"/"Authorize" (`:1239-1253`) but no payment method is collected.
- The planner deposit PaymentIntent route has no `transfer_data.destination` in the Stripe create call (`lib/planner/depositPayments.ts:235-252`). Capture inserts a local `payouts` row only (`:144-153`); it does not create a Stripe transfer to the venue.
- The deposit UI explicitly says "Payment collection is not active yet" and renders the Stripe placeholder notice (`components/builder/DepositDisplay.tsx:184-213`; `components/shared/StripeIntegrationNotice.tsx:10-23`).
- `event_kickback_agreements.base_fee_amount` and `flat_base_fee` exist in generated types (`lib/types/database-generated.ts:1638`, `:1657`), but they belong to kickback agreement records, not a builder-to-venue rental payment execution path.
- Commercial model ranking is only estimation and recommendation logic. It does not execute payment for `flat_rental`, `minimum_spend`, or any rev-share model.

**Risk if unfixed**

P0. A real builder can request a venue but cannot pay venue rental through 3rdPlace. A venue cannot receive rental money into a bank account through Stripe Connect, even if it completed venue Connect onboarding. Any production booking would require off-platform payment or manual operations, which breaks marketplace trust, auditability, refund handling, and platform fee capture.

### Flow 2: Builder -> Vendor Service Payments

**Status: ⚠ Partial**

**What exists**

- The actual table is `vendor_transactions`, not `vendor_payment_transactions`. Columns are `id`, `booking_id`, `vendor_id`, `builder_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_transfer_id`, `amount`, `platform_fee`, `stripe_fee`, `vendor_payout`, `payment_type`, `status`, `paid_at`, and `created_at` (`supabase/migrations/20260428161000_add_vendor_transactions.sql:21-49`; generated type at `lib/types/database-generated.ts:5926-5945`).
- `vendor_transactions.payment_type` supports `deposit`, `final_payment`, `service_payment`, and `refund` (`supabase/migrations/20260428161000_add_vendor_transactions.sql:37-40`).
- `vendor_bookings` has payment fields: `deposit_amount`, `deposit_paid`, `final_price`, `quoted_price`, `payment_status`, `platform_fee_amount`, `refund_amount`, `stripe_payment_intent_id`, `subtotal`, and `total_amount` (`lib/types/database-generated.ts:4869-4912`).
- `app/api/payments/create-intent/route.ts` supports `paymentType: 'deposit' | 'final_payment'`, verifies a confirmed booking, requires vendor payout readiness, creates a Stripe PaymentIntent, and inserts a pending `vendor_transactions` row (`:20-23`, `:48-55`, `:98-130`).
- `app/api/payments/confirm/route.ts` retrieves the PaymentIntent, creates a vendor transfer if needed, stores `stripe_transfer_id`, marks the transaction succeeded, and marks deposit paid for deposit payments (`:54-88`, `:92-123`).
- `lib/payments/vendor-payments.ts` computes deposit vs final payment amounts (`:95-104`), verifies vendor Connect payout readiness (`:191-215`), and creates the transfer to the vendor connected account (`:218-243`).
- A separate direct vendor payment route exists: `app/api/payments/vendor/route.ts` creates a PaymentIntent with `transfer_data.destination` to the vendor account and logs `service_payment` (`:177-212`).
- Vendor payout status UI loads Stripe account and `vendor_transactions` data (`app/api/vendor/payouts/summary/route.ts:41-52`) and displays recent payment activity (`app/(dashboard)/vendor/payouts/page.tsx:317-357`).
- Refund rails exist for vendor payments. The refund calculator loads vendor deposit policy (`lib/payments/refund-calculator.ts:183-218`), refund routes calculate and process cancellation refunds (`app/api/payments/refund/calculate/route.ts:17-60`; `app/api/payments/refund/process/route.ts:140-215`), and transfer reversal is implemented when a transfer exists (`app/api/payments/refund/process/route.ts:45-65`).

**What's missing**

- No reachable UI uses `components/payments/PaymentForm.tsx`; search found only the component definition, not a call site. Its submit path to `/api/payments/create-intent` is therefore not wired into an actual builder flow.
- Planner approval clicks do not call `/api/payments/create-intent`, `/api/payments/vendor`, or `/api/planner/plans/[planId]/payments/authorize`; they only mark planner approval/hold intent (`components/planner/PlannerLivePlanPanel.tsx:857-899`).
- `app/(dashboard)/vendor/payouts/page.tsx` still includes placeholder copy for "Deposit and balance tracking" and "Invoices and receipts" (`:54-69`) even though it can render transaction summaries when rows exist.
- The two-step deposit/final model exists in schema and API, but no UI was found that starts the deposit and later starts final payment for a confirmed vendor booking.
- There are two vendor payment approaches: one PaymentIntent followed by a separate transfer (`create-intent` + `confirm`) and one PaymentIntent with immediate `transfer_data.destination` (`/api/payments/vendor`). The app does not expose a clear canonical builder path.

**What happens today when a builder clicks "Authorize" on a vendor approval**

Today it records intent only. If the card has an `approvalId`, the planner PATCHes `/api/planner/plans/{planId}/approvals` with `action: 'authorize'` and `authorizedAmountCents` (`components/planner/PlannerLivePlanPanel.tsx:866-875`). If it does not have an `approvalId`, it creates a `hold_request` agent action (`:878-892`). It does not collect a card, create a PaymentIntent, create a vendor transfer, or mark a vendor deposit paid.

**Risk if unfixed**

P0 for launch. The backend has usable pieces, but the real user flow is not end-to-end. A builder cannot reliably pay a vendor deposit or final balance from the planner approval card. Vendors cannot trust "authorized spend" as money until payment UI and canonical transfer flow are wired.

### Flow 3: Venue -> Builder Rev Share Kickback

**Status: ⚠ Partial, not merged to main**

**Current merge state**

- Current branch: `codex/rev-share-settlement-schema`.
- `main` latest inspected commits end at `21c50eb fix(payments): handle stripe connect mode mismatch (#3)`.
- Current branch is ahead of `main` by only three commits: `15c5f2a feat(db): kickback settlement schema migration...`, `744b4e4 docs: add rev share settlement QA report`, and `1be2ed8 test: add extraction QA fixtures`.
- The expected rev-share implementation is not merged to local `main`, and the inspected branch does not contain a complete 14-commit runtime implementation.

**Acceptance gate state**

| Acceptance item | Status | Evidence |
|---|:-:|---|
| Rev-share PR merged to `main` | ❌ | `git log main --oneline` does not include the branch commits; `main` ends at `21c50eb`. |
| All 14 PR commits landed | ❌ | `git log --oneline main..HEAD` shows 3 commits only. |
| QA report acceptance gates pass | ❌ | `QA_REPORT.md:164-183` marks staging E2E, compliance, refunds, dashboard, economics, cron, receipts/invoices/transfers/refunds, and Resend logs as not implemented/blocked. |
| `kickback_payments` / `event_kickback_agreements` settlement schema | ⚠ | Migration adds plan/proof/revenue fields and payment invoice/refund fields (`supabase/migrations/20260527000000_kickback_settlement_schema.sql:10-22`, `:107-123`), but generated types do not include those new fields (`lib/types/database-generated.ts:1629-1680`, `:2836-2865`). |
| Checkout route has invoice settlement branch | ❌ | Route selects legacy `amount`, creates a Checkout Session, and updates statuses (`app/api/venue/kickbacks/[paymentId]/checkout/route.ts:47-176`). No `settlement_method = 'invoice'` branch exists. |
| Stripe webhook has kickback metadata gating | ⚠ | Checkout and PaymentIntent kickbacks are gated by `payment_kind === 'venue_builder_kickback'` (`app/api/webhooks/stripe/route.ts:53-112`), but invoice events always route to builder billing (`:211-217`). |
| `lib/email/kickbackNotifications.ts` exists | ❌ | File is missing. |
| Planner payments page is real ledger | ❌ | `app/(planner)/planner/payments/page.tsx` is static metrics and placeholder ledger copy (`:5-17`, `:72-79`, `:118-128`). |
| Builder payout summary route | ⚠ | `app/api/builder/payouts/summary/route.ts` reads legacy `kickback_payments.amount` rows and builder Stripe account state (`:45-128`), but planner page does not use it. |
| Venue kickback summary route | ⚠ | `app/api/venue/kickbacks/summary/route.ts` reads legacy kickback rows for the payer venue owner (`:43-112`). |

**What exists**

- Legacy venue-to-builder checkout can create a Stripe Checkout Session and transfer funds to the builder connected account via PaymentIntent `transfer_data.destination` (`app/api/venue/kickbacks/[paymentId]/checkout/route.ts:129-154`).
- Checkout completion and PaymentIntent events update kickback payment status when the `payment_kind` metadata matches (`app/api/webhooks/stripe/route.ts:53-112`, `:264-271`).
- Branch migration adds invoice/refund-oriented columns and richer status checks (`supabase/migrations/20260527000000_kickback_settlement_schema.sql:107-162`).

**What's missing**

- Runtime does not use the new migration fields because generated types are stale and routes still select legacy columns.
- No invoice creation/payment branch, invoice email, ACH fee handling, overdue cron, compliance gate, event report upload, spend report upload, refund request route, refund decision route, or kickback notification module is present. `QA_REPORT.md:46-66` lists the missing runtime files and current behavior.
- The current branch documents failure/incomplete status, not a merge-ready end-to-end implementation (`QA_REPORT.md:7-13`, `:68-79`).

**Risk if unfixed**

P0 if rev share is part of launch positioning. A venue can only use a legacy checkout path in narrow conditions. The repeat-organizer promise of tracked venue kickback settlement, invoice handling, refund decisions, compliance blocking, and planner-visible ledger is not real yet.

### Flow 4: Builder -> Platform Subscription / Per-Event Fees

**Status: ⚠ Regression against requested audit expectations**

**What exists**

- Builder billing has pay-per-event, Pro monthly, and Pro annual concepts (`lib/billing/builder-billing.ts:7-15`).
- Checkout route exists for `pay_per_event`, `pro_monthly`, and `pro_annual` (`app/api/builder/billing/checkout/route.ts:12-45`).
- Builder checkout creation supports payment or subscription mode and attaches billing metadata (`lib/billing/builder-billing.ts:326-355`).
- `checkout.session.completed` updates credits/subscription state and inserts platform fee transactions (`lib/billing/builder-billing.ts:532-612`).
- Subscription invoice handlers are guarded by `invoice.subscription`; non-subscription invoices return early (`lib/billing/builder-billing.ts:660-702`).
- Webhook routing still sends `customer.subscription.*` and `invoice.payment_*` to builder billing handlers (`app/api/webhooks/stripe/route.ts:211-225`).
- Planner approval flow checks product access before consuming event access (`app/api/planner/plans/[planId]/approvals/route.ts:266-315`).

**What's missing / changed**

- The prompt expected `freeEventsGranted: 2`, but inspected code has `freeEventsGranted: 1` (`lib/billing/builder-billing.ts:10-12`).
- The prompt expected `app/api/planner/plans/route.ts` POST to call `checkPlanCreationAccess` and block at a third free-tier plan. The inspected POST creates a plan directly (`app/api/planner/plans/route.ts:150-230`), and `rg` found no `checkPlanCreationAccess` symbol in `app`, `lib`, or `components`.
- Billing enforcement exists later, at planner approval/outreach authorization (`app/api/planner/plans/[planId]/approvals/route.ts:291-310`), not at plan creation.
- No current branch changes appear to intentionally modify builder billing, but the code does not match the requested "freeEventsGranted: 2" and "plan creation access" checks.

**Risk if unfixed**

P1 if plan creation itself must be metered. Builders may create plans without consuming billing access, then hit the paywall only when approving outreach. That may be acceptable product behavior, but it does not match the audit prompt's expected third-plan block. The one-vs-two free event mismatch should be resolved before pricing claims are made publicly.

## 4. Vendor Pricing Self-Service Matrix

| Capability | Schema | API | UI | Used at booking | Status |
|---|:-:|:-:|:-:|:-:|:-:|
| Base rates per service | ✅ | ✅ | ✅ | ⚠ | ⚠ Partial |
| Deposit percentage | ✅ | ✅ | ✅ | ⚠ | ⚠ Partial |
| Emergency / rush surcharge | ✅ | ⚠ | ✅ | ❌ | ⚠ Partial |
| Cancellation policy | ✅ | ⚠ | ✅ | ⚠ | ⚠ Partial |
| Minimum booking value | ❌ | ❌ | ❌ | ❌ | ❌ Missing |
| Travel / out-of-area fees | ⚠ | ⚠ | ⚠ | ❌ | ❌ Missing |
| Payment terms | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ Partial |

**Base rates per service**

Schema exists in `vendor_offerings.base_price`, `duration_hours`, `pricing_model`, and `service_category` (`lib/types/database-generated.ts:5319-5339`) plus profile-level `vendor_profiles.base_rate`, `hourly_rate`, `per_person_rate`, and `pricing_model` (`:5581-5640`). APIs exist for listing/creating/updating/deleting vendor services (`app/api/vendor/services/route.ts:13-24`, `:73-100`, `:116-158`; `app/api/vendor/services/[id]/route.ts:13-23`, `:75-118`, `:135-162`). UI exists through `VendorServicesManager` and `ServiceListingForm`, which saves `base_price`, duration, category, and add-ons (`components/vendor/VendorServicesManager.tsx:21-70`; `components/vendor/ServiceListingForm.tsx:55-120`, `:175-227`). Booking/planner usage is partial: public vendor detail loads offerings/packages (`app/api/vendors/[id]/route.ts:89-116`), vendor economics estimates from profile/selection prices (`lib/planner/vendorEconomicsCosts.ts:73-160`, `:236-249`), but payment amount ultimately comes from `vendor_bookings.quoted_price/final_price/deposit_amount`, not directly from service rules (`lib/payments/vendor-payments.ts:91-104`).

**Deposit percentage**

Schema exists on `vendor_profiles.deposit_percentage`, `requires_deposit`, `deposit_amount`, `deposit_type`, and `deposit_terms` (`lib/types/database-generated.ts:5596-5601`, `:5624`). Signup collects `deposit_pct` (`components/auth/SignupExperience.tsx:1175-1231`, `:1333-1340`) and `ensureVendorProfile` persists `deposit_percentage` and `requires_deposit` (`lib/server/account-setup.ts:406-427`). Vendor settings UI saves it (`app/(dashboard)/vendor/services/page.tsx:288-306`, `:639-655`). `app/api/vendor/deposit/route.ts` exists. Booking usage is partial: `EventVendorStep` only calculates percentage deposits when a booking cost already exists (`components/builder/event-wizard/EventVendorStep.tsx:40-49`), and planner opportunity building estimates deposit from `deposit_percentage` (`lib/planner/opportunityBuilder.ts:639-650`). Actual vendor payment uses `vendor_bookings.deposit_amount` (`lib/payments/vendor-payments.ts:95-104`), so the percentage must be materialized somewhere else before payment.

**Emergency / rush surcharge**

Schema exists as `vendor_profiles.emergency_available`, `emergency_rate_uplift`, and `lead_time_days` (`lib/types/database-generated.ts:5602-5603`, `:5612`). Signup and settings UI collect these (`components/auth/SignupExperience.tsx:1227-1231`, `:1356-1384`; `app/(dashboard)/vendor/services/page.tsx:682-705`). Planner catalog displays emergency uplift and lead time (`app/(planner)/planner/vendors/page.tsx:490-492`, `:549-563`). No booking/payment code applies the surcharge to amount owed.

**Cancellation policy**

Schema exists as `vendor_profiles.cancellation_terms`, plus deposit refund fields (`lib/types/database-generated.ts:5589`, `:5598-5600`). Signup and settings collect cancellation terms (`components/auth/SignupExperience.tsx:1227-1228`, `:1342-1348`; `app/(dashboard)/vendor/services/page.tsx:672-679`). Refund calculation uses `deposit_refundable`, `deposit_terms`, deposit amount/type/percentage, and fixed time windows (`lib/payments/refund-calculator.ts:183-218`), not the freeform `cancellation_terms` text. Therefore it is policy-visible but not truly rule-driven.

**Minimum booking value**

No vendor-level minimum booking value column or API/UI was found. `minimum_hours` exists on vendor profiles (`lib/types/database-generated.ts:5613`) but that is not a minimum booking dollar threshold and is not exposed as a budget rejection rule.

**Travel / out-of-area fees**

Schema has service-area style fields (`regions_served`, `service_area`, `travel_radius`) (`lib/types/database-generated.ts:5623`, `:5626`, `:5635`), and signup captures service area (`components/auth/SignupExperience.tsx:1294-1297`). No mileage rate, travel surcharge, out-of-area fee, or booking calculation was found. This is not a real fee capability.

**Payment terms**

Vendor deposit terms exist (`deposit_terms`) and vendor invoice-related code references `vendor_transactions`, but no general vendor payment terms such as net 30, due on receipt, milestone billing, or final-balance due date rule is exposed as a self-service pricing capability. The payment model is hard-coded around `deposit` and `final_payment` transaction types (`supabase/migrations/20260428161000_add_vendor_transactions.sql:37-40`).

## 5. Venue Pricing Self-Service Matrix

| Capability | Schema | API | UI | Used at booking | Status |
|---|:-:|:-:|:-:|:-:|:-:|
| Base rental rates | ⚠ | ⚠ | ⚠ | ⚠ | ⚠ Partial |
| Minimum spend | ⚠ | ⚠ | ❌ | ⚠ | ⚠ Partial |
| Deposit percentage | ✅ | ✅ | ✅ | ⚠ | ⚠ Partial |
| Kickback / rev share terms | ⚠ | ⚠ | ✅ | ⚠ | ⚠ Partial |
| Cancellation policy | ⚠ | ⚠ | ⚠ | ❌ | ⚠ Partial |
| Off-peak vs peak pricing | ❌ | ❌ | ❌ | ❌ | ❌ Missing |
| Cleaning / security / gratuity | ❌ | ❌ | ❌ | ❌ | ❌ Missing |

**Base rental rates**

Generated `venues` includes `hourly_rate`, `minimum_hours`, and `pricing_model` (`lib/types/database-generated.ts:6760`, `:6768`, `:6777`), but not `daily_rate` or `flat_rate`. Venue pricing UI reads and writes `daily_rate` (`app/(dashboard)/venue/pricing/page.tsx:122-136`, `:156-170`), so this is schema drift relative to generated types. Signup stores `price_per_night` into `hourly_rate` while forcing `pricing_model: 'hourly'` (`lib/server/account-setup.ts:281-300`), which is semantically confusing. Booking estimates use `hourly_rate * minimum_hours` (`app/api/builder/venue-bookings/route.ts:57-60`, `:128-130`), and planner opportunity estimates use hourly/minimum hours (`lib/planner/opportunityBuilder.ts:594-599`), but no rental payment execution exists.

**Minimum spend**

There is no first-class `venues.minimum_spend` column in generated types. Admin catalog seeding accepts `minimum_spend` in integer cents and stores it under `auto_approve_conditions.minimum_spend_cents` (`app/api/admin/catalog/venues/route.ts:19-27`, `:84-88`). Planner rankers can infer minimum spend from `minimum_spend_cents`, `minimum_spend`, or `auto_approve_conditions.minimum_spend_cents` (`lib/planner/catalogRanker.ts:516-523`; `lib/planner/commercialModelRanker.ts:118-123`, `:201-204`). No venue self-service UI/API was found for editing minimum spend.

**Deposit percentage**

Generated `venues` includes `deposit_amount`, `deposit_percentage`, `deposit_refundable`, `deposit_terms`, `deposit_type`, and `requires_deposit` (`lib/types/database-generated.ts:6753-6758`, `:6778`). Signup collects fixed deposit amount and cancellation terms (`components/auth/SignupExperience.tsx:1042-1086`) and persists fixed deposit config (`lib/server/account-setup.ts:297-300`). Venue pricing page embeds `DepositSettings` (`app/(dashboard)/venue/pricing/page.tsx:537-547`), and deposit display can show amount due (`components/builder/DepositDisplay.tsx:168-213`). Booking usage is partial because payment collection is explicitly inactive (`components/builder/DepositDisplay.tsx:190-213`).

**Kickback / rev share terms**

Generated `venues` has overlapping fields: `bar_rev_share_enabled`, `bar_rev_share_pct`, `bar_revenue_percentage`, `bar_revenue_share_enabled`, `bar_revenue_share_percent`, `ticket_sales_share_enabled`, `ticket_sales_share_pct`, `ticket_sales_share_percent`, `per_head_kickback`, `per_head_kickback_amount`, and `per_head_kickback_cents` (`lib/types/database-generated.ts:6741-6745`, `:6773-6775`, `:6787-6789`). Signup collects bar kickback, per-head drink percent, and minimum bar spend (`components/auth/SignupExperience.tsx:1042-1068`). Venue pricing UI collects ticket share, bar share, and per-head kickback (`app/(dashboard)/venue/pricing/page.tsx:364-530`). Planner rankers infer venue terms from these fields (`lib/planner/catalogRanker.ts:862-880`; `lib/planner/commercialModelRanker.ts:124-140`). Settlement is still partial under Flow 3.

**Cancellation policy**

Generated `venues.cancellation_terms` exists (`lib/types/database-generated.ts:6747`). Signup collects and persists it (`components/auth/SignupExperience.tsx:1079-1086`; `lib/server/account-setup.ts:297-300`). Planner recommendation code can surface cancellation terms in candidate data, but no venue cancellation refund execution path was found. This is text capture, not enforceable payment policy.

**Off-peak vs peak pricing**

No venue schema/API/UI was found for daypart, weekday/weekend, seasonal, peak/off-peak, or time-based price bands. Availability days/open hours exist (`components/auth/SignupExperience.tsx:1090-1105`), but those are scheduling signals, not differentiated pricing.

**Cleaning / security / gratuity**

No venue-level cleaning fee, security deposit, gratuity, service charge, or itemized fee schema/API/UI was found in generated `venues` (`lib/types/database-generated.ts:6734-6800`) or the inspected pricing page. The booking route records only `quoted_price`, `subtotal`, and `total_amount` from hourly estimate (`app/api/builder/venue-bookings/route.ts:166-183`).

## 6. Cross-Flow Concerns

**Webhook metadata namespacing**

- Builder checkout uses billing metadata and only handles `checkout.session.completed` when `billing_type`, `builder_id`, and `user_id` exist (`lib/billing/builder-billing.ts:532-538`).
- Kickback checkout and PaymentIntent events use `payment_kind: 'venue_builder_kickback'` (`app/api/venue/kickbacks/[paymentId]/checkout/route.ts:120-127`; `app/api/webhooks/stripe/route.ts:53-112`).
- Planner deposits use `payment_kind: 'planner_deposit'` (`lib/planner/depositPayments.ts:243-251`) and webhook routing checks planner deposit before kickback for PaymentIntent events (`app/api/webhooks/stripe/route.ts:264-271`).
- Invoice events are not namespaced for kickbacks. They always call builder subscription handlers (`app/api/webhooks/stripe/route.ts:211-217`). Builder handlers return when there is no subscription (`lib/billing/builder-billing.ts:660-662`, `:700-702`), which protects current subscriptions but also means kickback invoices cannot work.
- Transfer events always call the kickback transfer handler (`app/api/webhooks/stripe/route.ts:281-287`). This is low risk today because it updates kickback rows by metadata or matching `stripe_transfer_id`, but vendor transfers are not handled by webhook; vendor payment confirmation is client/API-driven.

**Money unit consistency**

- New planner deposit tables use integer cents (`supabase/migrations/20260504000016_add_planner_deposit_payments.sql:12`, `:37`).
- Vendor payment tables use `NUMERIC(10,2)` dollar amounts (`supabase/migrations/20260428161000_add_vendor_transactions.sql:29-32`) and `vendor_bookings` generated numeric amount fields (`lib/types/database-generated.ts:4879-4905`). This violates the current hard rule for new money values but appears to be older schema.
- Kickback legacy `kickback_payments.amount` is dollars, while the branch migration adds `amount_cents`, `processing_fee_cents`, and `builder_payout_cents` (`RECONCILIATION.md:104-119`; `supabase/migrations/20260527000000_kickback_settlement_schema.sql:107-123`). Runtime still uses legacy `amount` (`app/api/venue/kickbacks/[paymentId]/checkout/route.ts:50`, `:136`).
- Venue commercial units are ambiguous. Admin seeding expects `hourly_rate` and `per_head_kickback_amount` in integer cents (`app/api/admin/catalog/venues/route.ts:19-27`), but venue signup saves `price_per_night` directly into `hourly_rate` without cents conversion (`lib/server/account-setup.ts:291-293`), and UI labels the inputs as dollars (`app/(dashboard)/venue/pricing/page.tsx:262-271`, `:323-334`, `:477-491`). Planner helpers attempt to normalize small numbers to cents (`lib/planner/opportunityBuilder.ts:609-612`), but not all paths do.

**Stripe Connect onboarding completeness**

- Connect onboarding routes exist for venue, vendor, and builder using Express accounts and requested `card_payments`/`transfers` capabilities (`app/api/venue/stripe/connect/route.ts:50-76`; `app/api/vendor/stripe/connect/route.ts:53-79`; `app/api/builder/stripe/connect/route.ts:50-77`).
- Vendor payment routes require a completed vendor Connect account before receiving payments (`lib/payments/vendor-payments.ts:191-215`).
- Venue rental cannot pay to venue Connect today because no rental payment route creates a destination charge or transfer to `venue_stripe_accounts`.
- Venue-to-builder kickback requires the builder to complete builder Connect onboarding, not the venue, because the venue pays and the builder receives (`app/api/venue/kickbacks/[paymentId]/checkout/route.ts:70-115`).
- `lib/stripe/connect.ts` still says payment collection is intentionally disabled in UI until Stripe keys are configured (`:1-13`), while newer backend routes do create Stripe objects. This copy is now stale and can mislead QA.

## 7. Launch Readiness by Persona

**Repeat organizer (builder, 5+ events/year)**

Works partially: can create planner plans, browse venues/vendors, approve outreach/holds, and hit builder billing at approval time. Does not work end-to-end: venue rental payment, planner-connected vendor deposit/final payment, real planner payment ledger, kickback invoice settlement, and refund decision flows are missing or partial. They cannot confidently operate five paid events/year inside 3rdPlace without off-platform money movement.

**First-time venue**

Can sign up, set some rates/deposit/kickback terms, and complete venue Stripe Connect onboarding. Cannot reliably set every pricing rule expected by marketplace self-service: no first-class minimum spend UI, no peak/off-peak, no itemized cleaning/security/gratuity, and base rate units are ambiguous. They can be requested/booked as pending, but they cannot receive venue rental payment into their bank account through the inspected app. They can pay a builder kickback only through the partial legacy checkout path if a kickback row exists and the builder has Connect ready.

**First-time vendor**

Can sign up, set base price, deposit percentage, lead time, cancellation text, emergency availability/uplift, and create bookable service listings. Can complete vendor Stripe Connect onboarding. A backend route can pay deposits/final amounts and transfer to the vendor, but the planner/builder UI does not expose that flow. Refunds exist for vendor bookings and can reverse transfers, but policy execution is hard-coded around deposit refundability and time windows rather than vendor-defined tiered cancellation terms.

## 8. Prioritized Gap List

1. **P0 - Venue rental payment rail is missing**
   - Size: large
   - Covered by existing spec: no, needs a new venue rental payment spec
   - Gap: create canonical builder-to-venue rental checkout/payment path, transaction ledger, Connect destination/transfer, webhook handling, refund handling, and planner integration.

2. **P0 - Planner approval cards do not collect or move money**
   - Size: large
   - Covered by existing spec: likely vendor payments Phase 2 / planner execution spec, but needs explicit current PR scope
   - Gap: approval action only records authorization intent. It must launch the correct payment flow after human approval and after partner acceptance.

3. **P0 - Vendor deposit/final backend is not wired to builder UI**
   - Size: medium
   - Covered by existing spec: likely vendor payments Phase 2
   - Gap: PaymentForm is unused; two-step API exists but cannot be reached from planner or booking UI.

4. **P0 - Rev-share settlement is incomplete and not merged**
   - Size: large
   - Covered by existing spec: rev share Phase 1
   - Gap: invoice settlement branch, generated types, emails, refunds, compliance gate, cron, event/spend report uploads, and planner ledger are missing.

5. **P0 - Kickback migration/types/runtime drift**
   - Size: medium
   - Covered by existing spec: rev share Phase 1
   - Gap: migration adds columns that `lib/types/database-generated.ts` does not expose, and runtime still selects/writes legacy fields.

6. **P0 - Money units are inconsistent across marketplace rails**
   - Size: medium
   - Covered by existing spec: no, needs a cross-flow money-units cleanup spec
   - Gap: cents vs dollars varies across vendor transactions, kickbacks, venue hourly rates, per-head kickbacks, and admin seed routes.

7. **P1 - Builder billing gate does not match expected free-event behavior**
   - Size: small
   - Covered by existing spec: builder billing audit
   - Gap: `freeEventsGranted` is 1, not 2; plan creation is not gated even though approval is gated.

8. **P1 - Venue pricing self-service is incomplete**
   - Size: medium
   - Covered by existing spec: no, needs venue pricing self-service spec
   - Gap: minimum spend self-service, peak/off-peak pricing, cleaning/security/gratuity, and enforceable cancellation policy are missing.

9. **P1 - Vendor cancellation policy is text, not executable policy**
   - Size: medium
   - Covered by existing spec: vendor payments/refunds Phase 2 or new refund-policy spec
   - Gap: refund calculator ignores freeform cancellation terms and uses hard-coded windows.

10. **P1 - Vendor emergency/rush surcharge is display-only**
    - Size: small/medium
    - Covered by existing spec: no
    - Gap: schema/UI exist, but booking calculation does not apply uplift.

11. **P1 - Vendor travel/out-of-area fee capability is missing**
    - Size: medium
    - Covered by existing spec: no
    - Gap: service area exists, but no mileage/travel surcharge model or booking calculation exists.

12. **P2 - Stripe Connect helper/API version is stale**
    - Size: small
    - Covered by existing spec: no
    - Gap: `lib/stripe/connect.ts` uses Stripe API version `2023-10-16` and copy that says payment collection is disabled, while backend routes now create payments.

13. **P2 - Duplicate vendor payment approaches need consolidation**
    - Size: medium
    - Covered by existing spec: vendor payments Phase 2
    - Gap: direct destination charge route and PaymentIntent-plus-transfer route coexist without a clear product path.

## 9. Open Questions

1. Should venue rental payments be destination charges, separate charges and transfers, Checkout Sessions, PaymentIntents with manual capture, or invoice-based settlement?
2. Should 3rdPlace hold venue/vendor deposits with manual capture until partner acceptance, or charge immediately after builder approval?
3. Is the canonical vendor payment architecture `create-intent` + `confirm` + `stripe.transfers.create`, or the direct `/api/payments/vendor` destination-charge path?
4. Should builder billing meter plan creation or only money-moving/outreach approval? Current code gates approval, not plan creation.
5. Is the free tier one free event or two free events? The audit prompt expects two; code grants one.
6. Are venue `hourly_rate`, `daily_rate`, `per_head_kickback_amount`, and admin catalog inputs supposed to be dollars or cents? Current routes disagree.
7. Should vendor/venue cancellation policies be structured rules that drive refunds, or human-readable terms reviewed by concierge/admin?
8. Should venue minimum spend be a first-class `venues` column or remain inside `auto_approve_conditions`?
9. Does rev-share Phase 1 need to block public venue recommendations for overdue venues before launch, or can compliance gating be post-launch?
10. Should vendors and venues be required to complete Stripe Connect at signup, at first accepted booking, or only before payout/settlement?
