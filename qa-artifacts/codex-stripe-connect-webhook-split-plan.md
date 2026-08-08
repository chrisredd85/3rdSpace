# Stripe Connect Webhook Split Plan

Date: 2026-06-03
Source branch: `codex/stripe-connect-webhook`
Source commit inspected: `490ec4d feat(payments): add Stripe Connect webhook handler`
Target: future focused implementation PR, not this markdown-only plan.

## Verdict

Do not cherry-pick the branch wholesale. It is small and mostly coherent, but
the safe port is still selective because the platform Stripe webhook has moved
forward on main since the source branch was created.

The useful work is a focused Stripe Connect webhook slice:

- Add a dedicated Connect webhook endpoint.
- Add shared Connect account/payout sync handlers.
- Harden the existing platform webhook so platform events and Connect events do
  not share webhook secrets or silently route through the wrong endpoint.
- Add the integration test coverage from the branch, updated against current
  main.

## Files To Port

### `lib/stripe/connect-webhook.ts`

Port the whole helper module from `490ec4d`.

Purpose:

- Defines supported Connect event types:
  - `account.updated`
  - `capability.updated`
  - `payout.created`
  - `payout.paid`
  - `payout.failed`
- Resolves connected account ids from Stripe event payloads.
- Looks up matching rows in `venue_stripe_accounts`,
  `vendor_stripe_accounts`, and `builder_stripe_accounts`.
- Mirrors account state into the Stripe account rows:
  - `charges_enabled`
  - `payouts_enabled`
  - `account_status`
  - `requirements_due`
- Mirrors venue/vendor payout readiness into existing profile fields.
- Records latest payout state under `requirements_due.latest_payout`.

Current-main compatibility notes:

- Current main already has the account tables and shared helpers in
  `lib/stripe/connect.ts`.
- Before implementation, re-check generated DB types for the exact account table
  fields used by the helper. The inspected fields exist in current main, but the
  implementation PR should still compile against the current generated types.

### `app/api/webhooks/stripe/connect/route.ts`

Port the whole route from `490ec4d`, adjusted only for current-main imports if
needed.

Required behavior:

- Runtime remains Node.js and dynamic.
- Reads raw request body.
- Rate limits under a separate `stripe-connect` key.
- Verifies signatures with `STRIPE_CONNECT_WEBHOOK_SECRET` only.
- Rejects missing or invalid signatures.
- Ignores unsupported Connect event types with an explicit ignored response.
- Requires a connected account id and ignores events that do not carry one.
- Dispatches to the shared handlers by event type.

Do not fall back to `STRIPE_WEBHOOK_SECRET` for this endpoint.

### `app/api/webhooks/stripe/route.ts`

Do not replace the file. Apply only the current-main equivalents of these hunks:

1. Add a local `CONNECT_ACCOUNT_EVENT_TYPES` set for:
   - `account.updated`
   - `capability.updated`
   - `payout.created`
   - `payout.paid`
   - `payout.failed`

2. Change the platform webhook secret lookup from the current fallback:

   ```ts
   process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET
   ```

   to:

   ```ts
   process.env.STRIPE_WEBHOOK_SECRET
   ```

3. After Stripe event construction, add the guard that ignores account-scoped
   Connect account events received on the platform endpoint:

   ```ts
   if (event.account && CONNECT_ACCOUNT_EVENT_TYPES.has(event.type)) {
     return NextResponse.json({
       received: true,
       ignored: true,
       reason: 'connect_event_wrong_endpoint',
     })
   }
   ```

Important preservation rule:

- Preserve all current main platform webhook behavior, including builder
  billing, venue rental, kickback invoice/payment handling, and application
  deauthorization logic. The split only prevents account-scoped Connect account
  events from being handled through the platform webhook secret.

### `__tests__/integration/stripe-connect-webhook.test.ts`

Port the test file from `490ec4d`, then update mocks/imports only as needed for
current main.

Coverage to preserve:

- Invalid Connect signature is rejected.
- `account.updated` updates venue, vendor, and builder Stripe account rows.
- Venue/vendor profile mirror fields are updated.
- `capability.updated` updates requirement capability state.
- Payout events are idempotently recorded.
- `payout.failed` restricts payout readiness and mirrors the profile state.
- Platform-side events delivered to the Connect endpoint are ignored.
- Account-scoped Connect events delivered to the platform endpoint are ignored.

## Files Not To Port

No other files are expected from `codex/stripe-connect-webhook`. The source diff
against current main only contains the three implementation files plus the test.

## Environment And Deploy Preconditions

- `STRIPE_CONNECT_WEBHOOK_SECRET` must exist in Vercel Production before the new
  endpoint receives live events.
- The Stripe Dashboard should send connected-account event types to
  `/api/webhooks/stripe/connect`.
- The existing platform endpoint should keep using `STRIPE_WEBHOOK_SECRET`.

## Validation Required In The Implementation PR

- `npm install`
- `npm run type-check`
- `npm test -- __tests__/integration/stripe-connect-webhook.test.ts --runInBand`
- `npm test`
- `npm run lint`
- `npm run build`

Manual/staging checks:

- Send a Stripe CLI Connect test event to the new Connect endpoint with the
  Connect webhook secret.
- Send a platform webhook event to the existing endpoint with the platform
  webhook secret.
- Confirm an account-scoped Connect event sent to the platform endpoint is
  ignored with `connect_event_wrong_endpoint`.

## Product And Safety Posture

This slice does not create a new execution mode. It only keeps connected
account readiness synchronized. It must not trigger bookings, payments, payouts,
refunds, or outbound messages on its own. Any future user-facing payment action
still goes through existing approval/payment flows.

## Recommendation

Open a focused implementation PR from current `origin/main` using the selective
port above. Do not merge it until the Connect webhook secret is provisioned and
the focused integration test passes against current main.
