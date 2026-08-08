## Summary

Markdown-only split plan for `codex/stripe-connect-webhook`.

The source branch contains a useful Stripe Connect webhook slice, but it should
not be cherry-picked wholesale. This PR records the selective port plan so the
implementation can happen later from current `main`.

## Findings

- Source commit inspected: `490ec4d feat(payments): add Stripe Connect webhook handler`
- Candidate files:
  - `lib/stripe/connect-webhook.ts`
  - `app/api/webhooks/stripe/connect/route.ts`
  - `__tests__/integration/stripe-connect-webhook.test.ts`
  - narrow hardening hunks in `app/api/webhooks/stripe/route.ts`
- Current main already has the account tables and Stripe Connect helper shapes
  needed for this slice.
- The platform webhook currently still falls back from
  `STRIPE_CONNECT_WEBHOOK_SECRET` to `STRIPE_WEBHOOK_SECRET`; the implementation
  PR should separate those secrets.

## Recommendation

Open a future focused implementation PR that ports only:

1. The dedicated Connect webhook route.
2. The shared Connect account/payout sync helper.
3. The integration test coverage.
4. The platform webhook hardening that ignores account-scoped Connect account
   events on the platform endpoint and uses only `STRIPE_WEBHOOK_SECRET`.

Do not change booking/payment execution semantics. This work only synchronizes
Stripe connected-account readiness.

## Validation

- Markdown-only PR.
- Commit went through the normal Husky pre-commit hook.
