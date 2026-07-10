# Canonical plan and event identity

3rdPlace has one event identity spine for planner-native work:

```text
plan -> exact event -> agent action -> approval -> booking/payment -> outcome
```

The planner plan remains the proposal and approval aggregate. The event is the
exact, scheduled operational record used by bookings, analytics, outcomes, and
rebooking. A plan does not become an event merely because a host started a chat
or supplied a date window.

## Identity decision

`plans.materialized_event_id` and `events.plan_id` are nullable, unique,
reciprocal foreign keys. One plan can materialize at most one canonical event,
and one canonical event can belong to at most one plan. Deferred constraint
triggers require both pointers to agree before commit and require the event's
builder profile to belong to the plan owner.

Both reciprocal foreign keys use `ON DELETE NO ACTION DEFERRABLE INITIALLY
DEFERRED`:

- deleting only the plan or only the canonical event fails closed;
- an intentional privacy deletion may delete both records in the same deferred
  transaction; and
- deleting an event sets `templates.source_event_id` to null so a reusable
  template is not made undeletable by provenance metadata.

Legacy event rows remain valid with `events.plan_id IS NULL`. This migration
does not infer links from titles, dates, owners, metadata, or approximate times.
Guessing would turn correlation into identity and contaminate analytics.

Those null-linked rows include legacy builder events, Eventbrite and other
ticketing imports, event-history records, and planner event imports. They remain
non-canonical analytics compatibility records. Their existence is never
sufficient authorization for a booking, payment, or other execution. Upcoming
planner-native execution must start from `materialize_plan_event` and use the
resulting reciprocal identity pair.

## Lossless event taxonomy

`planner_event_taxonomy` is a 19-row reference table. Browser roles may read it
but cannot mutate it. `event_type` equals `archetype_key`; there is no lossy
fallback category and no invented default duration. The existing seven values
remain accepted for legacy events, while the `events.valid_event_type`
constraint also accepts all 19 canonical keys.

| Planner archetype | Canonical `events.event_type` | Display name |
| --- | --- | --- |
| `networking_mixer` | `networking_mixer` | Networking mixer |
| `founder_operator_dinner` | `founder_operator_dinner` | Founder/operator dinner |
| `brand_product_launch` | `brand_product_launch` | Brand/product launch |
| `pop_up_activation` | `pop_up_activation` | Pop-up / activation |
| `workshop_class` | `workshop_class` | Workshop / class |
| `panel_fireside` | `panel_fireside` | Panel / fireside |
| `demo_day_pitch_night` | `demo_day_pitch_night` | Demo day / pitch night |
| `hackathon` | `hackathon` | Hackathon |
| `community_meetup` | `community_meetup` | Community meetup |
| `fundraiser_gala` | `fundraiser_gala` | Fundraiser / gala |
| `private_dinner_celebration` | `private_dinner_celebration` | Private dinner / celebration |
| `day_party_brunch_party` | `day_party_brunch_party` | Day party / brunch party |
| `nightlife_club_night` | `nightlife_club_night` | Nightlife / club night |
| `listening_party_showcase` | `listening_party_showcase` | Listening party / showcase |
| `watch_party_screening` | `watch_party_screening` | Watch party / screening |
| `fitness_wellness_run_club` | `fitness_wellness_run_club` | Fitness / wellness / run club |
| `game_sports_outing` | `game_sports_outing` | Game / sports outing |
| `holiday_reception` | `holiday_reception` | Holiday reception |
| `retreat_offsite` | `retreat_offsite` | Retreat / offsite |

## Exact materialization

The only planner-native creation boundary is the service-role RPC:

```sql
materialize_plan_event(
  p_plan_id uuid,
  p_actor_id uuid,
  p_archetype_key text,
  p_event_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_time_zone text
)
```

It returns `event_id`, `existing`, `event_record`, and `plan_status`.

The RPC takes a row lock on the plan and verifies the host and builder identity.
When present, `metadata.event_archetype_lock.key` is the authoritative exact
archetype. Older unlocked plans are accepted only when `plans.event_type`
exactly equals either the taxonomy key or its display name; fuzzy labels are
rejected. The RPC also verifies the selected date is inside the complete plan
date window and accepts durations from 1 to 1,440 minutes. A missing or blank
zone defaults to
`America/Los_Angeles`; otherwise the value must be a known IANA zone.

The local start is round-tripped through PostgreSQL's time-zone database.
Nonexistent spring-forward wall times and ambiguous fall-back wall times are
rejected instead of silently normalized. Canonical events store all three
exact schedule facts:

- `starts_at` as a UTC instant;
- `ends_at` as a UTC instant, no more than 24 hours after start; and
- `time_zone` as the local scheduling intent.

Legacy `event_date`, `start_time`, `end_time`, and `duration_hours` are populated
for compatibility, but exact comparisons use the timestamp and zone columns.

An exact retry returns the existing event. Reusing the plan with a different
archetype, builder, title/description, attendance, budget, date, start, duration,
or zone fails with an idempotency conflict. The plan row lock plus unique
reciprocal keys makes concurrent calls converge on one event.

## Audited status machine

All status changes use this service-only compare-and-swap helper:

```sql
transition_plan_status(
  p_plan_id uuid,
  p_expected_status text,
  p_to_status text,
  p_trigger text,
  p_actor_id uuid,
  p_context jsonb
) returns plans
```

The caller must name the expected current state. A retry is a no-op only when
the latest audit row matches the same expected state, target, trigger, actor,
and context. Every real change writes `plan_status_transitions`; direct browser
or service updates to `plans.status` are rejected by a trigger.

| From | To | Exact trigger label | Required database evidence |
| --- | --- | --- | --- |
| `drafting` | `ready` | `intake_completed` | Service says the structured intake is complete |
| `ready` | `drafting` | `intake_invalidated` | Service invalidates the prior intake result |
| `ready` | `approved` | `approval_authorized` | Non-expired executable approval with actor, authorization time, and snapshot hash |
| `approved` | `executing` | `event_materialized` | Reciprocal canonical plan/event pair exists |
| `executing` | `booked` | `booking_created` | Confirmed venue or vendor booking references the canonical event and is owned by the plan owner |
| `booked` | `completed` | `outcome_recorded` | Event ended, event status is completed, and server-timestamped structured outcome evidence exists |
| Any non-archived state | `archived` | `plan_archived` | Explicit service transition |

The historical enum value `complete` remains readable and may transition to
`archived`, but no new canonical flow transitions into `complete`. New flows use
`booked` and `completed` so a reservation and a measured event outcome are not
conflated.

New rows may start only in `drafting` or `ready`; later states cannot be inserted
directly by browser or service roles. Once a plan is approved (or has already
materialized), title, notes, archetype lock/type, attendance, budget, date window,
neighborhood, ticketing/terms, committed venue/vendor identity, quoted price and
terms, and profit inputs are frozen for every role. Canonical event identity,
descriptions, attendance, budget, venue, and schedule fields are likewise frozen
against direct browser or service writes. A
future dedicated revision command must coordinate reapproval and exact-event
changes under a scoped database context; P7 intentionally provides no bypassing
command.

Approval and booking triggers supply the transition evidence automatically.
`record_plan_event_outcome` accepts a non-empty JSON object after `ends_at`,
requires measured attendance/economic fields or substantive notes, stamps the
recording time on the server, rejects non-string note values, sets
`events.status = 'completed'`, and then runs
the `booked -> completed` transition. There is no caller-provided completion
boolean.

## Downstream contract

- `plans.materialized_event_id` is the authoritative canonical event id for
  planner execution. Callers must not select a same-owner or same-date event as
  a substitute. `plans.metadata.event_id` is legacy display/import lineage only
  and must not be used to authorize invitations, bookings, payments, analytics
  deep links, or other planner execution.
- Analytics continues to read `events`; planner-native materialization now
  writes a normal builder-owned event, so it is visible without a second
  planner-only projection. Analytics may still display null-linked legacy and
  imported records, but that visibility does not make them executable.
- Venue and vendor bookings must reference `plans.materialized_event_id` and
  carry the exact reciprocal `plan_id`, `agent_action_id`, and `approval_id`.
  A canonical booking is execution evidence only when its approved V2 snapshot,
  integer-cent quote, organizer, event, action target, discovery target, and
  claimed physical partner all agree. A same-owner or same-date booking without
  that provenance cannot advance a plan. Confirmed canonical bookings advance
  the plan only through evidence-driven triggers.
- Templates may store `source_event_id` alongside `source_plan_id`; a deferred
  database constraint requires both pointers to identify the same owned,
  completed canonical event with outcome evidence. Both may become null for
  provenance-free templates or coordinated privacy deletion. This makes the
  measured event, rather than only a proposal snapshot, the provenance for rebooking.
- Actions and approvals remain plan-owned. Payment and booking work in Prompts
  8 and 9 should take the canonical event id from the plan, never create a
  parallel event.

A quote snapshot may carry `canonical_event_id` only as immutable lineage. It
does not override `plans.materialized_event_id`. Quote commitments are
planning-only and may precede materialization; they do not materialize a plan on
demand. When `materialize_plan_event` later creates the exact event, it
atomically annotates any existing same-plan `metadata.committed_venue`,
`metadata.accepted_quote_state.venue/vendors`, metadata committed-vendor array,
and `plans.committed_vendors` entries with that exact id. Quote changes after
approval or materialization are rejected until a future dedicated revision flow
coordinates reapproval; merely copying the canonical id cannot authorize new
vendor, price, or terms. Historical unrelated rows are not backfilled by
title/date/owner matching. Booking-time code must always read
`plans.materialized_event_id`, even when older cached quote metadata has no
lineage field.

A payment must prove the complete relational chain: canonical event from the
plan, booking on that event, approved agent action, executable approval and its
exact immutable snapshot, and the resulting payment transaction. A quote row,
an imported event, or `canonical_event_id` copied outside that lineage is not
payment authority.

## Canonical booking execution boundary

Planner-native quote bookings are created only after the exact approval is
authorized and the canonical event exists. Legacy venue auto-approval settings
do not auto-confirm these rows: a claimed venue or vendor must confirm through
the service-owned canonical confirmation command. The command atomically
updates the booking and action, records audit evidence, publishes a host-visible
plan message, and advances the plan when the confirmed evidence is sufficient.
It verifies the exact venue owner or vendor user inside the same locked
transaction, including on replay. Confirmation, decline, cancellation, and
canonical batch commands use the same plan, event, action, approval, partner,
booking lock order. Exact retries return the prior result rather than creating
a second transition; a residual database deadlock is a retryable conflict, not
a false success or an unclassified server error.

Once an approval is linked, the action's execution-sensitive provider,
currency, target, amount, type, and payload cannot be edited in place. Booking
schedule, headcount, approved price, package/offering selection, deposit,
requirements, services, special requests, and confirmation schedule likewise
remain tied to the event and approved snapshot. Payment-state fields are left
to their dedicated approval-gated payment commands; changing commercial or
event terms requires a superseding approval version.

Partner decline is also a service-owned terminal outcome, not an ordinary row
patch. It atomically marks the pending booking declined, terminates the action
without making it generically retryable, preserves the immutable approval,
writes audit evidence, and tells the host. Canonical bulk confirmation and
decline commands lock complete aggregates in deterministic order so an invalid
member cannot leave a partially applied canonical batch. Browser insert/update
policies admit provenance-null legacy bookings only. Definer validation still
resolves the event/plan edge through caller RLS, so a browser cannot disguise a
canonical row as legacy. The temporary ready-plan bridge additionally requires
the booking organizer to own the linked plan and freezes event, organizer, and
partner identity. Legacy bookings continue to use their existing partner
routes without claiming canonical provenance.

If an authorized quote is waiting only for event materialization and expires or
becomes stale before any booking, admin task, outreach, or financial side effect
exists, a narrow service command can mark it for re-approval. That command does
not erase the original authorization. It proves the absence of work, preserves
the old approval as history, and permits the normal superseding-version flow.
Once durable work exists, expiry never rewinds or duplicates it.

Post-materialization quote recovery claims `approved -> executing` and writes
its transition audit in one service-only database command. A failed audit rolls
the claim back. Exact replay validates the same marker and one audit row;
concurrent executing or terminal truth wins without being overwritten. Already
failed actions are returned as review evidence and are never silently omitted.
Only `executing` or `booked` plans can claim recovery. Completed, archived, or
otherwise ineligible plans return non-mutating blocked-handoff evidence so the
UI offers review rather than a retry that cannot succeed.

The approval supersession command uses the same aggregate-root lock discipline:
plan, then action, then approval. It revalidates the unlocked identity hint and
locked plan owner before creating a successor. This keeps stale-quote recovery
from deadlocking against resume/reapproval commands or applying a successor to
the wrong aggregate.

Future calls to the existing `materialize_builder_event_with_access` RPC are
linked by a compatibility trigger after its current atomic billing operation.
The trigger fills both identity pointers and exact Los Angeles schedule fields.
It does not change credit consumption, prices, billing counters, or Stripe
behavior. That legacy path creates a `ready` plan and therefore does not invent
approval or advance to `executing`; Prompt 10 owns its route consolidation. If a
future bridge row references an already approved plan, the compatibility trigger
uses the same audited `event_materialized` helper to advance it to `executing`.

Temporary non-canonical compatibility exceptions are limited to planner event
imports and Eventbrite/history synchronization, plus the legacy venue-booking
route until Prompt 10. They may write/read legacy event rows for their current
purpose, but planner execution must not use those rows as canonical identity.

## Security and scale notes

- Canonical event identity, description, attendance, budget, venue, exact
  schedule, lifecycle state, and outcome fields cannot be changed directly by
  browser or service roles. Existing dedicated materialization and outcome
  commands use narrowly scoped database contexts. After approval or
  materialization, event-sensitive plan and quote inputs also fail closed for
  service-role updates until a future dedicated canonical revision command
  coordinates reapproval plus plan and event changes atomically.
- Taxonomy and lifecycle audit tables have RLS; clients receive read-only access
  scoped to their own plan where applicable.
- Materialization, status transition, and outcome functions are
  `SECURITY INVOKER` and executable only by `service_role`.
- Row locks and unique keys serialize the few writes that define identity while
  ordinary event and analytics reads remain index-backed. This design does not
  require a global lock as the user base grows beyond 5,000.

This migration deliberately does not modify Stripe, webhooks, purchase
idempotency, controlled-payment behavior, or the legacy booking route. Those
surfaces are coordinated through the canonical IDs but remain owned by the
separate duplicate-purchase work and Prompts 8 through 10.

Prompt 15's Option-B billing interface is also unchanged: the existing atomic
event-access materializer still consumes exactly where it did before, and this
identity migration only attaches its future plan/event records after that
operation succeeds.
