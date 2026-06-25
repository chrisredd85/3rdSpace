# SaaS Billing Status - 2026-06-25

## Summary

3rdPlace already has a production builder billing rail on `origin/main`:

- 2 free events per builder account.
- $30 pay-per-event credits.
- $79/month Pro subscription.
- $690/year annual Pro subscription.
- Stripe Checkout for pay-per-event and subscriptions.
- Stripe webhooks for checkout completion, invoices, and subscription lifecycle.
- Planner gating that consumes event access when a real event moves forward.

This pass does not add a duplicate billing table. The existing ledger equivalent is `platform_fee_transactions`; the existing access-consumption ledger is `builder_event_access_consumptions`.

## Existing billing implementation

### Pricing and environment

- `.env.example` documents the primary Stripe price IDs:
  - `STRIPE_PRICE_PAY_PER_EVENT`
  - `STRIPE_PRICE_PRO_MONTHLY`
  - `STRIPE_PRICE_PRO_ANNUAL`
- `.env.example` documents pricing:
  - `PLATFORM_FEE_PER_EVENT=30.00`
  - `PLATFORM_FEE_PRO_MONTHLY=79.00`
  - `PLATFORM_FEE_PRO_ANNUAL=690.00`
- `lib/billing/builder-billing.ts` exposes `BUILDER_BILLING_PRICES` with 2 free events, $30 per-event, $79 monthly, and $690 annual.

### Database state

Existing migrations cover the required billing schema:

- `builder_profiles` stores builder billing tier, Stripe customer id, free events used, free events granted, and paid event credits.
- `builder_subscriptions` stores Stripe subscription state.
- `subscription_plans` stores configured plan rows.
- `platform_fee_transactions` records builder platform fee transactions.
- `builder_event_access_consumptions` records consumed event access and idempotency metadata.

No new schema is needed for the hosted Stripe billing portal pass.

### Planner enforcement

Event access is enforced in the planner path:

- Creating plans calls the billing access check and returns `402` when the builder is out of access.
- Outreach approval batch creation consumes event access with reason `outreach_started`.
- Date-change workflows consume event access with reason `date_change_started`.
- Approval/authorize flows consume event access before side effects.

The product definition for a used free event is therefore:

> A free event is used when a plan crosses into execution work, including outreach started, date-change outreach started, or approval/authorization that would create downstream action.

### Stripe lifecycle

Existing webhook handling processes:

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Gap closed by this PR

### Stripe Customer Portal

Before this PR, builders could start checkout and cancel a Pro subscription through an app route, but there was no hosted Stripe Customer Portal route for self-service management.

This PR adds:

- `POST /api/builder/billing/portal`
- `createBuilderBillingPortalSession()`
- "Manage in Stripe" action on `/planner/billing`

This lets builders manage payment methods, invoices, billing details, and subscription changes through Stripe's hosted portal.

### Stripe price ID aliases

This PR keeps the existing canonical env vars and accepts shorter aliases:

- `STRIPE_PRICE_PER_EVENT` as an alias for `STRIPE_PRICE_PAY_PER_EVENT`
- `STRIPE_PRICE_MONTHLY` as an alias for `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_ANNUAL` as an alias for `STRIPE_PRICE_PRO_ANNUAL`

Canonical env vars still win when both are present.

## Production smoke runbook

Use a test builder account in Stripe test mode or a controlled production test account.

1. Sign in as a builder.
2. Open `/planner/billing`.
3. Confirm the page shows:
   - Free trial remaining count.
   - Event credits.
   - Pro status.
   - $30 pay-per-event.
   - $79/month Pro.
   - $690/year Pro.
4. Click "Buy a credit".
5. Confirm Stripe Checkout opens and returns to `/planner/billing?checkout=success`.
6. Confirm `platform_fee_transactions` records the pay-per-event transaction after webhook delivery.
7. Confirm `paid_event_credits` increments on the builder profile.
8. Click "Upgrade to Pro".
9. Confirm Stripe Checkout opens for the selected monthly or annual price.
10. After checkout success and webhook delivery, confirm:
    - `builder_profiles.billing_tier` is `pro_monthly` or `pro_annual`.
    - `builder_profiles.subscription_status` is `active`.
    - `builder_subscriptions` has the Stripe subscription id.
11. Return to `/planner/billing`.
12. Click "Manage in Stripe".
13. Confirm Stripe Customer Portal opens.
14. Return from the portal to `/planner/billing`.
15. Create or advance a planner event enough to consume event access.
16. Confirm `builder_event_access_consumptions` receives exactly one row per event.

## Out of scope

- New custom card-entry UI. Stripe Checkout and Customer Portal are the intended hosted surfaces.
- New `billing_events` table. Existing ledger tables cover the current product need.
- New dashboard routes.
- Changes to venue/vendor payment rails.
