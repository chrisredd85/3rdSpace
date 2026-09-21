# 3rdPlace 5k-readiness Prompt 7 handoff

Prompt 7 is implemented locally on the isolated integration branch. This handoff
does not claim a hosted database migration, production deployment, merge to
`origin/main`, or completion of Prompt 8.

## Outcome

3rdPlace now has one explicit planner identity spine from a plan to its exact
canonical event. A host confirms the event archetype, local date, start time,
duration, and IANA time zone in the Planner before the service materializes the
event. Materialization is idempotent, preserves all 19 planner archetypes without
lossy fallback, writes exact timezone-aware instants, links the plan and event
reciprocally, annotates existing quote snapshots with lineage, and advances the
audited lifecycle from `approved` to `executing`.

The lifecycle is centralized as:

`drafting -> ready -> approved -> executing -> booked -> completed -> archived`

Every transition uses an exact compare-and-swap helper, relational evidence, and
an owner-readable audit row. Approval authorization, canonical materialization,
owner-matched confirmed booking, and structured post-event outcome evidence are
the only facts that advance the corresponding states.

## Integrated implementation

- `bdfd345` — connect planner reads, analytics, templates, quote lineage, and
  canonical materialization interfaces
- `924ac53` — centralize plan lifecycle commands and remove direct status writes
- `94ee189` — stop guessing event identity in readers and fail closed on
  canonical builder-event mutation
- `b8a03db` — freeze approved/materialized plan facts in planner routes
- `b75ee19` — make exact materialization explicitly reachable in the warm
  editorial Planner UI and enforce canonical template eligibility
- `9fcfce9` — add the canonical schema, evidence-driven lifecycle, provenance
  constraints, fail-closed field guards, realized database tests, and CI gate
- `3574f50` — return explicit reapproval-required outcomes before any late
  partner-quote mutation or service write

The generated Supabase types were refreshed from the realized local database so
newer planner, outreach, discovery, lifecycle, event, and RPC types no longer
require stale generated-type workarounds.

## Database contract

- `events.plan_id` and `plans.materialized_event_id` form a deferred reciprocal
  one-to-one identity. Legacy/imported events remain null-linked; no backfill is
  guessed from title, owner, date, metadata, or approximate time.
- `planner_event_taxonomy` stores the exact 19 planner archetype keys. The event
  constraint accepts those keys in addition to existing legacy values.
- `materialize_plan_event` requires an approved plan, exact host-confirmed
  schedule, a complete plan date window, a valid IANA zone, and an unambiguous
  local wall time. Nonexistent and ambiguous DST times fail closed.
- `transition_plan_status` row-locks the plan, requires the exact expected state,
  makes only an exact same-context retry a no-op, validates transition evidence,
  and records `plan_status_transitions`.
- Canonical event identity, descriptions, attendance, budget, venue, schedule,
  lifecycle, and outcome fields cannot drift through browser or direct service
  writes. Approved plan venue/vendor identity, quote price, and terms likewise
  require a future coordinated revision and reapproval command.
- Outcome notes must be JSON strings. Completion also requires an ended event
  and structured attendance, economic, or substantive-note evidence.
- Template provenance is enforced at commit: when source pointers are present,
  they must name the same owner-controlled, completed canonical plan/event pair
  with recorded outcome evidence.

## Product behavior

- The Planner shows one explicit schedule confirmation card before
  materialization; it does not silently invent a duration or timezone.
- Materialization errors are mapped to actionable host-facing outcomes, including
  stale lifecycle, incomplete window, invalid timezone, DST gap/fold, and retry
  conflict states.
- Analytics reads the normal canonical `events` row, while legacy and imported
  rows remain display-only compatibility data and never become execution or
  purchase authority.
- Templates require a completed canonical event with outcome evidence and retain
  `source_event_id` through rebook preparation.
- Quote snapshots accepted before materialization receive canonical event lineage
  during materialization. Quote/vendor/price/terms changes after approval or
  materialization require reapproval; the canonical id alone never authorizes
  booking or payment.

## Verification evidence

- Clean local Supabase reset applied all migrations through
  `20260709150000_add_canonical_plan_event_identity.sql`.
- Canonical schema and realized lifecycle suites passed, including all 19
  taxonomy values, exact/non-Los-Angeles/overnight schedules, DST gap and fold
  rejection, concurrent idempotent materialization, exact CAS retries, owner and
  RPC ACLs, field freezes, template provenance, owner-matched booking evidence,
  outcome typing, and coordinated deletion.
- The legacy Prompt 6 builder-event materialization and ready-plan booking
  compatibility path passed its realized stored-function regression.
- Prompt 6 approval-version plus database privilege, RLS, and execution-control
  regressions passed after the Prompt 7 migration.
- Database lint passed with only the three pre-existing warnings; canonical
  schema audit and all-table RLS checks passed.
- Final combined branch counts are recorded in
  `qa-artifacts/5k-readiness-execution-log-2026-07-09.md`.
- Final opt-in database/security gate: 9 suites / 241 tests passed.
- Final integrated non-opt-in Jest gate: 272 suites / 1,557 tests passed; 8
  suites / 225 tests skipped; 5 snapshots passed.
- Partner quote mutation matrix: 32 tests passed across venue/vendor POST and
  DELETE, mutable and frozen states, and zero-write rejection behavior.
- TypeScript and the optimized production build passed. Lint passed with the 16
  pre-existing React hook warnings only.

## Explicit deferrals and boundaries

- Prompt 8 owns complete controlled-payment, external-checkout, and
  concierge/admin execution behavior. It was not started.
- Prompt 8 also owns the full product route for post-event outcome entry; Prompt
  7 provides and proves the database contract only.
- Prompt 9 owns controlled-payment depth and payment E2E.
- Prompt 10 owns legacy booking/import route consolidation. The compatibility
  bridge remains narrow and tested.
- Prompt 15 remains locked to Option B, but is unimplemented: one event credit is
  consumed at canonical materialization/booking, not first approval.
- Eventbrite and planner history imports remain `plan_id IS NULL`, analytics-only,
  and never purchase authority.
- The separate duplicate-purchase/capture-hardening task was not modified.
- No hosted Supabase, Vercel, GitHub, Stripe, webhook, or production state was
  changed.

## Resume point

The local integration branch is `codex/5k-readiness-integration` in
`/private/tmp/3rdplace-5k-readiness-integration`. Prompt 6 and Prompt 7 are the
completed boundary. Begin Prompt 8 only in a later, explicitly resumed run.

## 2026-07-10 verification correction

This addendum preserves the July 9 handoff as the original Prompt 7 checkpoint,
but supersedes its claim that Prompt 7 was a completed boundary. The later
Prompt 7/8 audit found that the identity spine was not yet enforced at every
operational edge:

- a booking without the exact canonical action/approval provenance could
  advance the plan;
- canonical bookings and actions could be rebound, unlinked, or materially
  changed through service-owned writes after approval;
- the approved discovery target was not proven to be the claimed physical
  venue/vendor on the booking;
- legacy `plans.metadata.event_id` could still influence an operational read;
- an exact analytics deep link could miss an older event outside the default
  feed; and
- rebook and template flows could retain the prior thread or accept the legacy
  `complete` value instead of the canonical `completed` outcome contract.

The current worktree adds exact reciprocal event, action, current approval,
V2-snapshot, amount, target, claimed-partner, and booking-term enforcement; it
also corrects the canonical analytics, rebook, and template readers. The
realized proof and final release evidence must come from the root-owned clean
gate documented in
`qa-artifacts/5k-readiness-prompts7-8-verification-2026-07-10.md`.

Corrected release receipt:

- Final release commit: **PENDING_ROOT_FINAL_GATE**
- Clean-reset Prompt 7 realized proof: **PASS** in the 12-suite / 297-test
  realized database matrix
- Full regression/build/browser evidence: **PASS**; 1,845 ordinary Jest tests,
  type-check, lint, production build, and 26 targeted Chromium tests; six
  credential-dependent browser checks skipped by contract
- Hosted apply and merge: **BLOCKED_PENDING_OPERATOR_SEQUENCE**

Prompt 8 has since been implemented and corrected in the same worktree, while
Prompt 9 still owns controlled-payment provider execution. Prompts 1–8 are not
in `origin/main` at observed SHA `461e3da`; no hosted database mutation or merge
is authorized by this correction.
