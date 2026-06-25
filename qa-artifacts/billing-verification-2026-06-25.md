# SaaS Billing Verification - 2026-06-25

## Status

**Implemented with minor follow-up recommended.** The SaaS billing rail exists on `origin/main` and is wired through Stripe Checkout, builder billing status, subscription cancellation, planner gating, execution gating, webhook synchronization, and focused regression tests.

The prompt's `$69/month` assumption is stale. Current product pricing is `$30/event`, `$79/month`, and `$690/year`. Evidence: `BUILDER_BILLING_PRICES` defaults to `30`, `79`, and `690` in `lib/billing/builder-billing.ts:10-15`, and migration `supabase/migrations/20260623000000_update_builder_pro_monthly_to_79.sql:1-14` updates the database plan row to `$79/month`.

## Evidence

| Area | Current state | Evidence |
| --- | --- | --- |
| Pricing env | Stripe price IDs are documented for pay-per-event, Pro monthly, and Pro annual. | `.env.example:26-28` |
| Pricing source | Code exposes two free events, `$30/event`, `$79/month`, `$690/year`. | `lib/billing/builder-billing.ts:10-15` |
| Schema | Builder profiles track tier, free usage, credits; subscriptions and platform fee transactions exist. | `supabase/migrations/20260428163000_add_builder_event_billing.sql:9-29`, `:177-246` |
| Checkout | Authenticated builder checkout creates Stripe Checkout for `pay_per_event`, `pro_monthly`, or `pro_annual`. | `app/api/builder/billing/checkout/route.ts:12-45` |
| Stripe customer | Builder Stripe Customer is created/reused and stored on `builder_profiles`. | `lib/billing/builder-billing.ts:301-337`, `:363-392` |
| Checkout mode | Pro uses `subscription`; pay-per-event uses `payment`; checkout metadata includes billing type, builder ID, user ID. | `lib/billing/builder-billing.ts:394-455` |
| Billing status | UI/API returns current tier, free events, paid credits, Pro access, and prices. | `app/api/builder/billing/status/route.ts:12-23`, `lib/billing/builder-billing.ts:183-208` |
| Billing UI | Planner billing page shows status, usage, pay-per-event, monthly/annual Pro, and cancel. | `app/(planner)/planner/billing/page.tsx:35-112`, `:173-411` |
| Signup/planner gate | Plan creation checks active plan count, free events, credits, and Pro access; exhausted users get `402 billingRequired`. | `app/api/planner/plans/route.ts:181-194`, `lib/billing/builder-billing.ts:228-282` |
| Execution gate | Free/paid access is consumed when approval, outreach, or date-change execution begins. | `lib/planner/productAccess.ts:37-106`, `app/api/planner/plans/[planId]/approvals/route.ts:270-292`, `app/api/planner/plans/[planId]/outreach/approve-batch/route.ts:95-100`, `app/api/planner/plans/[planId]/date-change/route.ts:59-71` |
| Billing modal | Client surfaces exhausted access with buy-single-event, Pro upgrade, or archive-old-plan options. | `components/planner/BillingGateModal.tsx:61-80`, `:123-260` |
| Webhooks | Checkout, invoice, and subscription events update builder profiles/subscriptions and fee transactions. | `lib/billing/builder-billing.ts:589-668`, `:670-811`; `app/api/webhooks/stripe/route.ts:902-955` |
| Idempotency | Checkout session completion is deduped by session ID; event access consumption is an RPC with existing-consumption behavior. | `lib/billing/builder-billing.ts:596-603`, `supabase/migrations/20260623000000_update_builder_pro_monthly_to_79.sql:76-120` |
| Tests | Focused tests cover Stripe customer reuse/replacement, checkout customer behavior, free-tier defaults, and event-access consumption. | `lib/billing/__tests__/builder-billing.test.ts:45-158`, `:160-198`; `__tests__/billing/builder-billing-idempotent.test.ts:1-260` |

## Stubbed / Missing / Partial

1. **Stripe Customer Portal is not implemented.** The product has first-party checkout and subscription cancellation, but no `/api/billing/portal` or `stripe.billingPortal.sessions.create` route was found. This is not a blocker for purchase/cancel, but it is the cleanest way to let customers update payment methods and invoices.
2. **Naming differs from the prompt.** The canonical tables are `builder_subscriptions`, `platform_fee_transactions`, `builder_event_usage`, and `builder_event_access_consumptions`, not generic `billing_subscriptions` / `billing_events`. Do not add parallel tables.
3. **Generic agent-run billing is conservative and separate.** `/api/ai/agents/run` blocks `free_trial` users for most direct agent runs and logs that pay-per-event AI credit enforcement is pending (`app/api/ai/agents/run/route.ts:124-155`). The primary planner execution gates are stronger and more specific.

## Recommendation

**Do not rebuild billing.** Use the current builder billing system as canonical for MVP. Before broad paid launch, add one small follow-up PR for a Stripe Customer Portal route/button so Pro users can manage payment methods and invoices without support intervention.

## Production Smoke Runbook

Prereqs:
- Vercel Production env has `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PAY_PER_EVENT`, `STRIPE_PRICE_PRO_MONTHLY`, and `STRIPE_PRICE_PRO_ANNUAL`.
- Stripe Dashboard has matching live Prices: `$30` one-time, `$79/month`, `$690/year`.
- Hosted Supabase has migrations through `20260623000000_update_builder_pro_monthly_to_79.sql`.

Steps:
1. Log in as a test creator and open `/planner/billing`.
2. Confirm the page shows free usage, event credits, Pro status, `$30/event`, `$79/month`, and `$690/year`.
3. Call `GET /api/builder/billing/status`; confirm `billing.prices.proMonthlyAmount` is `79`.
4. Start pay-per-event checkout with `POST /api/builder/billing/checkout` body `{"type":"pay_per_event"}`.
5. Complete Stripe Checkout in test mode. Verify `checkout.session.completed` is delivered to `/api/webhooks/stripe`.
6. Verify Supabase: `builder_profiles.paid_event_credits` increments by `1`, `billing_tier` becomes `pay_per_event`, and `platform_fee_transactions` has one succeeded `per_event` row.
7. Trigger a real event action: approve an approval, start outreach, or start a date-change outreach. Verify `builder_event_access_consumptions` gets one row for the plan and credit/free access is consumed only once.
8. Start Pro monthly checkout with `{"type":"pro_monthly"}`. Complete checkout and verify `builder_profiles.billing_tier='pro_monthly'`, `subscription_status='active'`, and `builder_subscriptions.status='active'`.
9. Use Stripe CLI or Dashboard test tools to send `invoice.payment_failed` for the subscription. Verify `builder_profiles.subscription_status='past_due'`, `builder_subscriptions.status='past_due'`, and a failed `platform_fee_transactions` row is recorded.
10. From `/planner/billing`, cancel the subscription. Verify Stripe subscription is set to cancel at period end and local `builder_subscriptions.cancel_at_period_end=true`.
