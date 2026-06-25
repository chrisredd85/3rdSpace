# Venue Claim -> Stripe Connect -> Payment Smoke Test

Last verified: 2026-06-24
Tester: Codex code-path audit; browser smoke still requires operator execution
Production commit to test: ddd647c5a2c4c5338814a1912dc6ccede60f68e3 or later

## Purpose

This runbook verifies the production venue claim, Stripe Connect onboarding, organizer settlement approval, and Stripe Checkout settlement path before opening paid pilot traffic. It is intentionally operator-led for the browser and Stripe-hosted steps; this audit did not run live production payments.

3rdPlace's execution invariant still applies: no booking, outbound message, or money movement should happen without an approval record.

## Code-Path Status Summary

| Step | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Venue invite -> claim URL | GREEN | `app/actions/venueInvites.ts:56` creates invite rows via `create_venue_invite`, signs a 14-day claim token, sends email, and returns `claimUrl`. | Uses integer cents through `dollarsToCents`. |
| Venue invite token secret | YELLOW | `lib/venues/venueInviteTokens.ts:61` accepts fallback secrets when `VENUE_INVITE_SECRET` is absent. | Not the same as `SETTLEMENT_ACK_TOKEN_SECRET`. For paid pilot, set `VENUE_INVITE_SECRET` explicitly and consider hardening the fallback later. |
| `/venue/claim` invite flow | GREEN | `app/venue/claim/page.tsx:21` tries invite token first, then opportunity token. `app/api/venue/claim/route.ts:20` claims invited venue and creates a venue owner account. | Claim form keeps venue unpublished until profile/payout setup. |
| Opportunity claim/resume path | GREEN | `app/api/venue/opportunity/[token]/claim/route.ts:18`, `app/api/venue/profile/complete/route.ts:25`, and `app/api/venue/opportunity/[token]/stripe-resume/route.ts:18`. | Supports token-gated claim, profile completion, and Stripe resume. |
| Stripe Connect onboarding | GREEN | `app/api/venue/stripe/connect/route.ts:18` and `app/api/venue/stripe/callback/route.ts:24`. | Existing implementation uses Stripe Connect Express-style accounts through current repo helper patterns. |
| Connect account webhook fan-out | GREEN | `app/api/webhooks/stripe/connect/route.ts:22` verifies `STRIPE_CONNECT_WEBHOOK_SECRET`; `lib/stripe/connect-webhook.ts:46` updates venue/vendor/builder rows on `account.updated`; venue readiness calls `handleVenueStripeReadyForOwner`. | Also records `capability.updated`, `payout.created`, `payout.paid`, and `payout.failed` as observed events. |
| Venue Stripe reminder loop | GREEN | `lib/venues/venueOpportunityRecovery.ts:32` defines day 0/1/7/14 reminders; `lib/venues/venueOpportunityRecovery.ts:472` enqueues reminder jobs; `:296` moves Stripe-ready opportunities forward. | Requires job runner/cron health. |
| Settlement run creation | GREEN | `app/api/cron/settlement-runs/create/route.ts:19` enqueues `settlement.run.create` with `CRON_SECRET`; `lib/finance/settlement-runs.ts:97` creates runs. | Only CHI-eligible venue types are enqueued. |
| Organizer settlement approval | GREEN | `app/api/planner/settlement-runs/[runId]/review/route.ts:23` calls `reviewSettlementRun`; `lib/finance/settlement-checkout.ts:280` ensures a settlement approval record. | Approval is required before checkout. |
| Settlement checkout | GREEN | `app/api/venue/settlement/[token]/pay/route.ts:16` rate-limits token actions and calls `startSettlementCheckout`; `lib/finance/settlement-checkout.ts:394` verifies token, status, approval, amount drift, and organizer Stripe readiness. | #150 added amount-drift revalidation before checkout. |
| Stripe Checkout routing | GREEN | `lib/finance/settlement-checkout.ts:817` creates Checkout with card + ACH and `transfer_data.destination`. | Platform fee must remain zero through settlement amount checks. |
| Checkout/webhook idempotency | GREEN | `app/api/webhooks/stripe/route.ts:858` reserves webhook events; `lib/finance/settlement-checkout.ts:694` handles `checkout.session.completed`; `:755` handles failed PaymentIntent. | Duplicate deliveries are skipped through webhook ledger. |
| Token revocation after completion/dispute | GREEN | `lib/finance/settlement-checkout.ts:223`, `:594`, `:694`, and `:750`. | Status endpoint returns `410 token_revoked` for revoked tokens. |
| Transfer ID persistence | YELLOW | Checkout uses `transfer_data.destination` at `lib/finance/settlement-checkout.ts:836`, but this path does not directly patch `settlement_charges.stripe_transfer_id`. | During smoke, verify whether Stripe transfer events carry usable metadata or whether the dashboard transfer is the authoritative proof. |
| Audit log | GREEN | `lib/finance/settlement-run-state.ts:217` and `:268` write `settlement_audit_log` for run and charge transitions. | Verify one charge audit row after payment. |

## Required Production Env Vars

Confirm these in Vercel Production before running the smoke:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL=https://www.3rdplace.io`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`
- `STRIPE_CONNECT_CLIENT_ID`
- `SETTLEMENT_ACK_TOKEN_SECRET` with length >= 32
- `VENUE_INVITE_SECRET` with length >= 32
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` or `NOTIFICATIONS_FROM_EMAIL`
- Redis rate limit credentials: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or Vercel KV aliases `KV_REST_API_URL` + `KV_REST_API_TOKEN`

## Pre-Test Setup

- [ ] Pick a real venue inbox you control.
- [ ] Pick an organizer account you control.
- [ ] Confirm organizer has a connected Stripe account ready to receive CHI settlement funds.
- [ ] Confirm the venue inbox can receive Resend emails from 3rdPlace.
- [ ] Confirm Vercel Production is on commit `ddd647c5a2c4c5338814a1912dc6ccede60f68e3` or newer.
- [ ] Confirm hosted Supabase migrations are applied through `20260625001000`.
- [ ] Confirm `/api/health` returns `200`.
- [ ] Confirm Stripe dashboard has both webhook endpoints:
  - Platform: `https://www.3rdplace.io/api/webhooks/stripe`
  - Connect: `https://www.3rdplace.io/api/webhooks/stripe/connect`

## Step 1: Invite Venue

Action:

1. Sign in as organizer.
2. Go to `/planner/venues`.
3. Use the invite form for the test venue email.
4. Include a proposed amount and attach it to an active plan when possible.

Expected:

- UI returns success with `claimUrl`.
- Email is received by the venue inbox within 60 seconds.
- `venues` row exists with:
  - `contact_email = <test venue email>`
  - `is_claimed = false`
  - `claim_status = invited_unclaimed`
  - `invited_at` set
- `venue_term_agreements` row exists if terms were proposed.

Verification SQL:

```sql
select id, venue_name, contact_email, is_claimed, claim_status, invited_at, invited_by_user_id
from public.venues
where lower(contact_email) = lower('<venue-test-email>')
order by created_at desc
limit 5;

select id, venue_id, organizer_user_id, term_type, amount_cents, status, confirmed_at
from public.venue_term_agreements
where venue_id = '<venue-id>'
order by created_at desc;
```

Expected logs:

- No `[venue invite]` server error.
- If email fails, `emailSent` may be false and the claim URL should still be visible in the UI for operator copy/paste.

Failure modes to test:

- Missing/invalid email should fail validation.
- Existing venue email should return existing invite context or a safe error, not a 500.
- Missing `VENUE_INVITE_SECRET` should not block today because fallback exists, but paid pilot should set it explicitly.

## Step 2: Claim Venue

Action:

1. Open the claim link in a fresh browser or private window.
2. Confirm the page loads `/venue/claim?token=...`.
3. Create the venue account using the invited email.
4. Accept or counter terms.

Expected:

- Claim page renders venue name and organizer.
- Form requires the invited email and password with minimum 8 chars.
- Submit creates a venue owner auth user.
- `venues.is_claimed = true`.
- `venues.claim_status = invited_claimed`.
- `venues.is_published = false`.
- Accepted terms move to `confirmed`.
- Redirect goes to `/venue/profile/complete?claim_complete=1`.

Verification SQL:

```sql
select id, venue_name, owner_id, claimed_user_id, is_claimed, is_published, claim_status, contact_email
from public.venues
where id = '<venue-id>';

select id, term_type, amount_cents, status, confirmed_at
from public.venue_term_agreements
where venue_id = '<venue-id>'
order by created_at desc;
```

Expected logs:

- No `Unexpected venue claim error`.
- No Supabase auth admin create user failure.

Failure modes to test:

- Wrong email returns "Use the email address that received this invite."
- Reused token after claim returns already-claimed state or safe error.
- Regenerated invite token should reject stale `invited_at`.

## Step 3: Complete Profile And Stripe Connect

Action:

1. Complete `/venue/profile/complete`.
2. Continue to Stripe payout setup from venue dashboard or token-gated resume link.
3. Finish Stripe-hosted onboarding.
4. Return to 3rdPlace callback.

Expected:

- Profile completion updates address, city, state, zip, capacity, type, and email.
- `/api/venue/stripe/connect` creates or validates the connected account.
- Stripe redirects back to `/api/venue/stripe/callback`.
- `venue_stripe_accounts` row exists.
- `account.updated` Connect webhook updates:
  - `charges_enabled`
  - `payouts_enabled`
  - `details_submitted`
  - `account_status`
  - `last_webhook_event_id`
  - `last_webhook_event_type`
  - `last_webhook_at`
- If this came from an opportunity token, pending reminders are cancelled and organizer gets a "payment ready" notification.

Verification SQL:

```sql
select owner_id, stripe_account_id, account_status, charges_enabled, payouts_enabled,
       details_submitted, disabled_reason, last_webhook_event_type, last_webhook_at
from public.venue_stripe_accounts
where owner_id = '<venue-owner-user-id>';

select id, status, stripe_setup_started_at, stripe_ready_at,
       payment_confirmation_requested_at
from public.venue_opportunity_invites
where venue_id = '<venue-id>'
order by updated_at desc;
```

Expected logs:

- `[venue.stripe.connect]` should not log failure.
- `[venue.stripe.callback]` should not log failure.
- `[stripe.connect.webhook]` should process `account.updated`.

Failure modes to test:

- Stripe onboarding cancelled redirects safely with `stripe=error`.
- Mode mismatch clears the stale account and requires reconnect.
- Restricted/disabled account must not become payment-ready.

## Step 4: Organizer Initiates Settlement Payment

Action:

1. Trigger settlement run creation after a completed eligible event, or manually run the cron endpoint with `CRON_SECRET`:

```bash
curl -i https://www.3rdplace.io/api/cron/settlement-runs/create \
  -H "Authorization: Bearer $CRON_SECRET"
```

2. In planner settlement review, record attendance if needed.
3. Organizer approves the settlement run.

Expected:

- `settlement_runs` row exists for the event.
- Run progresses through:
  - `pending`
  - `awaiting_attendance` or `awaiting_organizer_review`
  - `awaiting_venue_ack`
- An `approvals` row exists with:
  - `approval_type = chi_settlement`
  - `status = authorized`
  - `settlement_run_id = <run-id>`
  - `authorized_amount_cents = settlement_runs.total_cents`
- Settlement acknowledgement email is sent to venue with `/venue/settlement/<token>`.

Verification SQL:

```sql
select id, event_id, organizer_id, venue_id, status, total_cents, finalized_attendance_count
from public.settlement_runs
where event_id = '<event-id>'
order by created_at desc;

select id, approval_type, status, settlement_run_id, authorized_amount_cents
from public.approvals
where settlement_run_id = '<run-id>'
order by created_at desc;

select id, settlement_run_id, venue_email, expires_at, first_viewed_at, revoked_at
from public.venue_settlement_tokens
where settlement_run_id = '<run-id>';
```

Expected logs:

- `[settlement-runs.create]` returns `ok: true`.
- No `Cannot create CHI settlement approval without an attached planner plan`.

Failure modes to test:

- If the event has no likely attached planner plan, approval creation fails by design.
- If amount changes after approval, #150 should return `409 approval_amount_drift`.
- If organizer Stripe account is restricted, checkout should block and mark settlement blocked.

## Step 5: Venue Pays Through Stripe Checkout

Action:

1. Open the settlement email link as the venue.
2. Review amount and status.
3. Click payment CTA.
4. Complete Stripe Checkout.

Recommended Stripe test card:

- Card: `4242 4242 4242 4242`
- Expiration: any future date
- CVC: any 3 digits
- ZIP: any valid US ZIP

Also test failure card in a separate run:

- Card: `4000 0000 0000 0002`

Expected:

- `/api/venue/settlement/[token]/pay` returns `hosted_checkout_url`.
- `settlement_charges` row created with:
  - `status = checkout_created`
  - `amount_cents = settlement_runs.total_cents`
  - `platform_fee_cents = 0`
  - `organizer_payout_cents = amount_cents`
  - `stripe_connected_account_id` set
  - `stripe_checkout_session_id` set
  - `checkout_url` set
- Stripe Checkout uses `transfer_data.destination` to route funds to organizer connected account.

Verification SQL before paying:

```sql
select id, settlement_run_id, approval_id, organizer_id, venue_id, amount_cents,
       platform_fee_cents, organizer_payout_cents, status,
       stripe_checkout_session_id, stripe_payment_intent_id,
       stripe_transfer_id, stripe_connected_account_id, checkout_url
from public.settlement_charges
where settlement_run_id = '<run-id>'
order by created_at desc;
```

Expected logs:

- No `[venue.settlement.pay] Failed to create settlement checkout`.
- No `approval_amount_drift`.

Failure modes to test:

- Repeated pay click should reuse existing active checkout URL or return `checkout_in_progress`, not create a second active charge.
- Expired token returns `404 token_expired`.
- Revoked token returns `410 token_revoked`.

## Step 6: Webhook Completion And Money Landing

Action:

1. Complete Checkout.
2. Watch Stripe dashboard event delivery.
3. Wait for platform webhook processing.

Expected:

- Platform webhook receives `checkout.session.completed`.
- `settlement_charges.status = paid`.
- `settlement_charges.paid_at` set.
- `settlement_charges.stripe_payment_intent_id` set.
- `settlement_runs.status = settled`.
- `settlement_audit_log` has charge and run transition rows.
- Settlement token is revoked.
- Organizer receives payment-completed notification.
- Stripe dashboard shows funds routed to the connected account.

Verification SQL after paying:

```sql
select id, status, stripe_payment_intent_id, stripe_transfer_id, paid_at, trueup_processed_at
from public.settlement_charges
where settlement_run_id = '<run-id>';

select id, status, updated_at
from public.settlement_runs
where id = '<run-id>';

select id, revoked_at
from public.venue_settlement_tokens
where settlement_run_id = '<run-id>';

select entity_type, entity_id, action, actor_type, created_at
from public.settlement_audit_log
where entity_id in ('<run-id>', '<charge-id>')
order by created_at asc;
```

Expected logs:

- `[stripe.webhook] Processed event` for `checkout.session.completed`.
- Duplicate delivery should log duplicate skip, not process twice.

Yellow verification:

- Confirm whether `settlement_charges.stripe_transfer_id` is populated. The checkout session uses `transfer_data.destination`, so money movement should occur, but this audit did not find a direct patch of the automatic transfer id into `settlement_charges`. If this field stays null while Stripe shows the transfer, create a follow-up to persist transfer id from the PaymentIntent charge or transfer webhook.

Failure modes to test:

- Payment failure card should move `settlement_charges.status = failed` and email venue.
- Webhook replay should stay idempotent.

## Cleanup

- Refund the test charge in Stripe dashboard.
- Confirm whether refund webhook handling should be tested in a separate refund runbook.
- Archive test run IDs, charge IDs, and screenshots.
- Optionally delete or mark the test venue/event rows as test data.

## Sign-Off Criteria

The venue claim -> Stripe Connect -> settlement payment flow is production-ready for a paid pilot only when all of the following are true:

- [ ] Venue invite email delivered and claim URL works.
- [ ] Venue claim creates venue owner and keeps listing unpublished.
- [ ] Venue profile completion succeeds.
- [ ] Stripe Connect onboarding completes and `venue_stripe_accounts` updates from webhook.
- [ ] Venue Stripe setup reminders enqueue and cancel correctly.
- [ ] Organizer receives payment-ready notification after venue Stripe readiness.
- [ ] Settlement run exists and is attached to a planner plan.
- [ ] Organizer approval row exists before payment.
- [ ] Settlement checkout blocks on missing approval, amount drift, or blocked organizer Stripe account.
- [ ] Checkout completes with Stripe test card.
- [ ] `settlement_charges.status = paid`, `paid_at` is set, and audit log rows exist.
- [ ] Stripe dashboard confirms destination transfer to the connected account.
- [ ] Token status endpoint returns `410 token_revoked` after successful payment.
- [ ] No Vercel 500 logs during the run.
- [ ] No Sentry events tagged to settlement checkout, venue claim, Stripe Connect callback, or Connect webhook during the run.

## Risks To Resolve Or Accept Before Paid Pilot

1. `VENUE_INVITE_SECRET` is not documented in `.env.example` and the current token helper has a fallback chain. Set the env var explicitly before the smoke.
2. The settlement checkout path should be smoke-verified for `stripe_transfer_id` persistence. Money should route through `transfer_data.destination`, but the DB transfer id field may remain empty unless a recognized transfer event fills it.
3. The Stripe Connect implementation uses existing Express-style account creation. This matches current repo patterns, but future Connect work should evaluate Stripe Accounts v2.
4. A real browser run is still required. This document is not a substitute for the production smoke itself.
