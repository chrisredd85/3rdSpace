# Builder event materialization bridge

## Current contract

`POST /api/builder/events` is a legacy event-creation surface, but billing access is keyed to `plans.id`. The route must never insert an `events` row and then attempt billing as a second write.

The route now calls the service-only `materialize_builder_event_with_access` RPC. One PostgreSQL transaction:

1. reserves `(user_id, Idempotency-Key)` with the normalized payload hash;
2. creates a minimal `plans` row;
3. creates the legacy `events` row;
4. consumes access using the new plan ID;
5. records the plan/event/consumption identities in `builder_event_materializations`; and
6. returns the created event.

If billing is unavailable or any later write fails, PostgreSQL rolls back the reservation, plan, event, consumption, and counter updates together. A retry with the same key and payload returns the original identities without consuming again. Reusing a key for a different payload is a `409` conflict.

The RPC is `SECURITY INVOKER`, executable only by `service_role`, and called only after the route authenticates the community builder. Anonymous and authenticated database roles cannot execute it directly.

### Client retry-key ownership

`useCreateEvent` requires an `idempotencyKey`; it does not generate one inside the mutation function. The nearest UI/user-intent boundary must generate the key once when the user starts a create command and retain it across lost-response, manual retry, and double-submit paths. A new intentional event gets a new key.

At the time this bridge was added, repository search found no production component calling `useCreateEvent`; the builder wizard imports only `useUpdateEvent`. This makes the required-key type change non-breaking today and prevents a future caller from accidentally getting a new key on each mutation invocation. Direct HTTP clients must send the same value in `Idempotency-Key` (or `client_request_id`) for every retry of one intent.

## Prompt 7 canonical identity handoff

Prompt 7 remains responsible for adding direct `events.plan_id` and `plans.materialized_event_id` foreign keys and the full planner materialization state machine. Its deterministic bridge backfill is:

- only rows where `builder_event_materializations.status = 'materialized'`;
- `events.plan_id = builder_event_materializations.plan_id`; and
- `plans.materialized_event_id = builder_event_materializations.event_id`.

Do not infer links for unrelated legacy events. After the direct foreign keys land, keep `(user_id, idempotency_key)` as the command-level retry identity or migrate it into the canonical materialization command without losing its unique constraint. The `plans.metadata.identity_bridge` and legacy `metadata.event_id` fields are compatibility projections, not the future source of truth.

## Prompt 15 Option B billing handoff

The selected billing policy is Option B: consume access at successful event materialization or booking, not at approval drafting.

For this legacy route, the point of no return is the successful commit of `materialize_builder_event_with_access`. Before that commit, failures consume nothing and leave no event. A same-key retry is not a second materialization. Cancellation after the materialization commit does not silently restore a credit; any future refund must be an explicit, audited compensating action with its own idempotency key.

The legacy PATCH and DELETE surfaces reject bridged events until Prompt 7 owns
one aggregate revision/cancellation path. Updating only `events` would split
date, headcount, budget, and status from the linked plan and bypass re-approval;
soft-cancelling only the event would leave bookings, approvals, outreach,
payments, and admin tasks executable. Legacy, unbridged events retain their
existing behavior during this compatibility window.

This bridge does not complete Prompt 15 by itself. Prompt 15 must still move planner-native consumption out of approval/outreach/date-change triggers in `lib/planner/productAccess.ts` and into Prompt 7's canonical materialization/booking transition. It can identify bridge consumption through `plans.metadata.product_gate.event_access_reason = 'event_materialized'` and `point_of_no_return = 'event_materialization'` until the canonical columns land.

## Required release gate

`.github/workflows/rls-checks.yml` runs for pull requests, merge queues, and pushes to `main`. Repository operators must configure branch protection or the ruleset to require the `RLS Checks / rls` job. The workflow file cannot enforce that external GitHub setting by itself.
