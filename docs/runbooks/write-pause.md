# Production write pause

The write pause is a durable release control for coordinated schema/code
windows. Edge middleware reads the singleton
`public.release_runtime_controls.write_pause` row on every API mutation with
`cache: no-store`. It does not rely on process memory, so the state survives
restarts and is shared by every serverless instance. The control has three
durable states:

- `paused`: ordinary/user writes are blocked and signed external Stripe
  deliveries are queued;
- `draining`: ordinary/user writes remain blocked, new external Stripe
  deliveries still queue, and only CRON-authenticated replay may execute
  queued handlers with the service role;
- `open`: normal writes and normal signed webhook delivery resume.

The pause is an operational safety boundary, not a substitute for database
transactions or idempotency. It blocks new mutations immediately. The operator
script then waits for a configured drain interval before reporting
`safe_to_migrate: true`, so requests admitted just before the atomic flag flip
can finish before database changes begin.

## Release sequencing prerequisite

The pause foundation is migration
`20260709100000_add_write_pause_control.sql`. It is intentionally ordered after
the PR #203 payment-capture migration `20260709090000`. The prerequisite PR #205
release carries both the pause foundation and
`20260709110000_repair_p0_stored_functions.sql`. The coordinated PR #204 bundle
is a separate set of exactly 22 migrations beginning at `20260709114000` and
ending at `20260709178000`.

After PR #203, apply PR #205's `20260709100000` and `20260709110000`
prerequisite schemas, then deploy the exact reviewed PR #205
write-pause/middleware release. Confirm that deployment before relying on the
pause for PR #204's `20260709114000-20260709178000` window. Introducing the
mechanism for the first time in the same deployment as that bundle is circular
and unsafe.

## Request policy

While `paused` or `draining`:

- all `POST`, `PUT`, `PATCH`, and `DELETE` application API requests return 503;
- Next.js Server Action `POST` requests are blocked even outside `/api`;
- cron and internal job prefixes are blocked even when a legacy route uses
  `GET` to mutate;
- OAuth/integration callback `GET` routes are blocked;
- read-on-write endpoints (message-thread read receipts, partnership-workspace
  initialization, Stripe status synchronization/dashboard-link creation,
  captured-deposit reconciliation, and event-financial recalculation requested
  with `?recalculate=true`) are blocked because serving them would mutate local
  or provider state;
- `HEAD` is treated like `GET` for those routes because Next.js automatically
  invokes the `GET` handler; ordinary `GET`, `HEAD`, and `OPTIONS` reads continue;
- `/api/health` continues to return its normal response;
- the authenticated `/api/internal/write-pause` control route remains usable;
- the authenticated `/api/internal/stripe-webhooks/replay-deferred` route
  remains reachable, but it rejects replay unless state is `draining`;
- Stripe platform and Connect webhook routes remain reachable for signed
  receipt and durable queueing only.

The 503 body is stable and user-safe:

```json
{
  "error": "Maintenance in progress. Please retry shortly.",
  "code": "maintenance_in_progress",
  "maintenance": {
    "reason": "Coordinated database migration window",
    "state": "paused",
    "enabled_at": "2026-07-10T00:00:00.000Z",
    "revision": 1
  }
}
```

Responses include `Retry-After: 60` and `Cache-Control: no-store`.

## Stripe webhook guarantee

Stripe webhook paths bypass the middleware rejection, but they do not run
business side effects during the pause. Each request must first pass its normal
Stripe signature verification. The verified event payload is then reserved in
`stripe_webhook_events` and changed to:

- `processed = false`;
- `in_flight = false`;
- `processing_outcome = 'deferred_maintenance'`;
- `maintenance_deferred_at = now()`.

The route returns HTTP 202 with `received: true` and `queued: true`. To finish a
window, the operator first transitions `paused -> draining`. The authenticated
replay endpoint processes bounded batches while the product remains blocked.
Each reservation receives a durable fencing token; a stale worker cannot
finalize after its five-minute lease is reclaimed by a newer worker. Before
selecting each batch, replay reclaims expired reservations, and the batch fails
closed if that recovery step is unavailable.

The authoritative CRON replay bypasses only the public delivery rate limiter.
A normal signed delivery that is rate-limited is saved with `processed = false`
and receives HTTP 429 plus `Retry-After: 60`, so Stripe can retry it. It is not
acknowledged as complete. Replay and result persistence both fail closed if
their required atomic RPCs are absent or error.

The final `draining -> open` RPC locks the singleton control row and checks for
both deferred events and active reservations in the same transaction. Webhook
reservation takes a compatible lock, eliminating the queue-zero/open race: a
new delivery either queues before the final count or observes `open` afterward.
Do not manually set `enabled = false` or `state = open`.

## Required environment

Load these values from the production password manager. Do not paste them into
tickets or command logs.

```bash
export WRITE_PAUSE_BASE_URL='https://3rdplace.io'
export CRON_SECRET='...'
```

Optional script settings:

```bash
export WRITE_PAUSE_POLL_SECONDS=2
export WRITE_PAUSE_TIMEOUT_SECONDS=180
export WRITE_PAUSE_DRAIN_TIMEOUT_SECONDS=900
export WRITE_PAUSE_REPLAY_BATCH_LIMIT=25
```

The application can set `WRITE_PAUSE_DRAIN_SECONDS`; the default is 30 seconds
and the route caps it at 600 seconds.

## Enable and verify

First prove the exact deployed SHA contains the mechanism and that health is
normal. Then run:

```bash
scripts/release/toggle-write-pause.sh status
scripts/release/toggle-write-pause.sh enable \
  'Prompts 1-8 coordinated schema/code window'
```

`enable` performs a compare-and-swap using the current database revision,
blocks new mutations, and polls until the drain interval has elapsed. Do not
apply migrations unless its final JSON contains all of:

```json
{
  "state": "paused",
  "paused": true,
  "blocking": true,
  "safe_to_migrate": true
}
```

Verify the external behavior from a non-privileged session:

```bash
curl --fail --silent --show-error https://3rdplace.io/api/health

curl --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{}' \
  https://3rdplace.io/api/planner/plans
```

The health request must return 200. The write request must return 503 with code
`maintenance_in_progress`; an authentication error means the request did not
reach the pause chokepoint correctly.

Also check for long-running application transactions or functions that began
before the pause. `safe_to_migrate` proves the configured drain elapsed; it
cannot cancel an already-running external provider call or database session.

## Disable, replay, and verify

Only disable after every hosted schema verifier and production smoke that is
safe under maintenance has passed:

```bash
scripts/release/toggle-write-pause.sh disable \
  'Prompts 1-8 hosted verification complete'
```

The command:

1. atomically transitions `paused -> draining`;
2. keeps ordinary writes blocked while it replays deferred Stripe events in
   as many batches as needed (there is no fixed event or attempt cap);
3. waits long enough for the five-minute stale reservation lease, bounded by
   `WRITE_PAUSE_DRAIN_TIMEOUT_SECONDS` (default 900 seconds);
4. atomically opens only when the durable queue and active reservation count
   are both zero;
5. automatically transitions back to `paused` if drain or finalization fails;
6. prints final status.

Required final status:

```json
{
  "state": "open",
  "paused": false,
  "blocking": false,
  "safe_to_migrate": false
}
```

Then repeat health, authenticated planner read, and a non-money planner write
smoke. Do not use a real payment, booking, checkout, or outbound message as the
write smoke.

## Concurrent operator and request behavior

Control changes use the row's monotonically increasing `revision`. Two
operators acting on the same revision cannot both win: one succeeds and the
other receives HTTP 409 `write_pause_revision_conflict`. Middleware does not
cache the flag, so requests entering after the winning update observe the new
state. The control and reservation RPCs additionally serialize the final open
decision with incoming Stripe delivery. Requests admitted just before the
initial pause are why the drain interval and long-running-transaction check are
still mandatory.

## Flag-store outage posture

The application deliberately fails open if Supabase cannot answer the
middleware flag read. This avoids turning a Supabase outage into an indefinite
whole-product freeze. Every such failure logs a loud `[write-pause] fail-open`
error. During a migration window, any flag-store read failure is a stop
condition: do not apply schema changes, and re-enable/verify the pause once the
store is healthy.

Stripe replay fails closed when pause status is unavailable; queued financial
events are never replayed under an unknown maintenance state.

## Recovery

- If enabling returns 409, run `status` again and decide from the current
  revision; do not blindly repeat an old request.
- If status is unavailable, stop the release. No migration should be applied.
- If a migration fails after the pause is active, keep the pause enabled and
  follow the release's forward-fix procedure.
- If webhook replay or atomic finalization fails, the script attempts to
  re-pause automatically. Verify `state: paused`, fix the event, and restart
  the drain. Never claim the window closed from a batch-level `remaining: 0`;
  only the final RPC's `state: open` is authoritative.
- Do not delete the control row, manually decrement its revision, or modify the
  flag directly from the Supabase dashboard during a scripted window.
