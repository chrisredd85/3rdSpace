# Prompts 7–8 verification and correction report

> **Historical receipt — release topology superseded 2026-07-11.** The
> implementation evidence below remains valid for its recorded checkpoint, but
> any future-release statement describing PR #204 as a `20260709110000+`
> migration bundle or inventory is obsolete. The current contract is recorded
> in `qa-artifacts/pre-phase2-stack-stabilization-prompt-set-2026-07-11.md`: PR
> #205 owns `20260709100000` and `20260709110000`; PR #204 owns exactly 22
> migrations beginning at `20260709114000`.

Date: 2026-07-10
Worktree: `/private/tmp/3rdplace-5k-readiness-integration`
Branch: `codex/5k-readiness-integration`

## Executive verdict

The `74ec9b5` / `908a00b` Prompt 8 checkpoint was substantial, but it was not
properly or totally implemented against the original Prompt 7–8 acceptance
criteria. Its happy-path suites passed while several cross-aggregate,
concurrency, retry, partner-response, and read-model seams remained open.

This review corrected those seams in the current worktree. Final release status
must be based on the clean-reset and full-suite evidence recorded below, not on
the older handoff's test counts. Controlled-payment provider execution remains
deliberately outside Prompt 8 and belongs to Prompt 9.

## Original acceptance boundary

Prompt 7 requires one authoritative spine:

```text
plan -> exact event -> action -> approval -> booking/payment -> outcome
```

It also requires explicit materialization, all 19 planner taxonomies,
timezone-aware schedules, one audited status machine, analytics visibility,
canonical template/rebook provenance, and a realized lifecycle proof.

Prompt 8 requires every approved execution mode to produce truthful durable
evidence through the sole `executeApprovedAction` dispatcher:

- controlled payment proposal contract;
- external checkout handoff;
- concierge/admin queue, including venue hold and vendor contact;
- accepted quote to canonical booking; and
- outcome completion into analytics/template eligibility.

No path may auto-send, auto-open checkout, auto-book, or auto-pay.

## Gaps found in the prior checkpoint

| Area | Prior gap | Corrected contract |
|---|---|---|
| Booking authority | A same-owner booking without the exact action/approval provenance could advance a plan | Booking evidence now proves the reciprocal plan/event, action, current approval, V2 snapshot, amount, organizer, approved discovery target, and claimed physical partner |
| Provenance downgrade | A canonical booking could be rebound to a legacy event while clearing its provenance fields | Once canonical, event/partner/plan/action/approval/quote/snapshot identity cannot be downgraded or rebound |
| Action authority | A canonical action could clear `approval_id`, then mutate approved provider/target/amount/payload as if it were staging | Initial approval linking and successor linking are both exact; unlinking or in-place material drift fails in PostgreSQL |
| Material terms | Partner routes and direct service writes could change schedule, headcount, quote/final/subtotal, package, deposit, requirements, or terms | Canonical booking commercial/event terms are frozen to the exact event and approved quote; payment-state fields remain owned by payment commands |
| Partner target | A claimed venue/vendor booking was not proven to be the physical partner behind the approved discovery target | Discovery target to claimed partner binding is mandatory |
| Vendor claim authority | `vendor_profiles.discovery_vendor_id` was writable through paths that could rebind an approved discovery vendor to a different physical vendor | A service-only, idempotent claim command owns one authoritative discovery-to-physical mapping; ambiguous legacy links fail closed, browser/service direct writes are denied, and each canonical booking freezes the resolved partner binding |
| Unknown quote price | A quote without reliable price evidence could be interpreted as a zero-dollar booking | Unknown price now blocks execution; only an explicit zero-upfront venue model is accepted, and CHI/consumption-share language is normalized without inventing a cash price |
| Browser booking writes | RLS-filtered trigger lookups could misclassify a canonical event as legacy, letting an authenticated partner bypass the atomic command | Definer validators resolve canonical identity independently of caller RLS; browser insert/update policies are legacy/provenance-null only, while canonical writes require the service command |
| Ready bridge tenancy | The temporary ready-plan compatibility bridge did not prove the booking organizer owned that exact plan and could permit identity rebinding | The bridge requires organizer = plan owner and freezes event, organizer, and partner identity; wrong-tenant and rebind attempts fail |
| Legacy venue response | Legacy venue routes used authenticated updates without a venue-booking UPDATE policy | Venue owners can update only their own provenance-null legacy bookings; canonical rows remain service-command-only |
| Venue auto-approval | Legacy bulk auto-approval could auto-confirm a canonical quote booking | Canonical bookings always wait for the explicit service-owned partner confirmation command |
| Partner confirmation | Detail and bulk routes could update booking status without atomically completing action/audit/message state; the first command version trusted a separately checked actor | Canonical confirmation verifies the exact venue owner/vendor user inside the locked transaction; canonical bulk confirmation locks deterministically and rolls back invalid batches |
| Partner decline | Decline routes changed only the booking, leaving the action retryable/executing and host evidence inconsistent | Venue/vendor decline is one atomic service command: booking `declined`, action terminal `cancelled`, immutable approval preserved, one audit, one host message, exact replay |
| Bulk decline | Mixed or failing batches could partially mutate canonical rows | Canonical batches are atomic; mixed canonical/legacy batches fail with 409 before mutation |
| Partner-response concurrency | Confirmation, decline, and host cancellation acquired plan/action/booking locks in inverse orders | Commands use one plan -> event -> action -> approval -> partner -> booking order; residual PostgreSQL deadlocks map to retryable 409 instead of false 500s |
| Confirmation side effects | A worker could commit a canonical confirmation and die before creating the host notification, audit receipt, or automatic vendor invoice; retries could duplicate those effects | Confirmation effects have deterministic per-booking keys and locked reconciliation commands; exact and concurrent replay creates one notification/audit receipt and, for vendors, one automatically generated invoice while preserving explicit manual invoice regeneration |
| External checkout | Host confirmation updated action, audit, and message in separate writes | Confirmation is one atomic command with exact snapshot binding and idempotent replay |
| Materialization recovery | Waiting quote actions could select an older approval, overwrite terminal evidence, swallow resume failure, omit failed actions, or separate the resume status write from its audit | Recovery binds the exact current approval; one RPC atomically claims resume plus audit; failed/terminal/concurrent truth is preserved; unresolved partners queue idempotent operator work |
| Authorization crash window | A process could commit authorization and die before changing the linked pending/proposed action to approved, leaving retry unable to resume | Exact authorization replay repairs only that earliest safe window, reloads authoritative rows, and dispatches idempotently; wrong actors, changed snapshots, later-stage work, and payment handlers remain fail closed |
| Terminal-plan recovery | A completed plan could move an approved handoff back to `executing`, then fail booking creation | Only `executing`/`booked` plans can claim resume; completed/archived plans return non-mutating blocked-review evidence and never advertise retry |
| Terminal-plan mutation | Generic action creation/edit/authorization and first-time confirmation could revive work after completion; negative cleanup also needed to remain possible | Database and route guards block new positive execution on `complete`/`completed`/`archived`, allow exact terminal replay, and retain decline/cancel cleanup for already-pending canonical work |
| Multi-partner execution | A booked plan could not reliably stage a later vendor/venue slot; the SQL/helper allowed it while both public commit routes rejected it, and same-slot duplicates could slip through after a prior action reached a terminal status | Booked plans may stage or cancel a different slot through both venue/vendor APIs; an existing booking/action for the same slot remains authoritative even when its action is complete or failed |
| Re-approval | Expired/stale pre-execution quotes had no safe recovery; the initial recovery predicate could ignore financial, retry-in-progress, or handoff evidence | A narrow service command proves no booking/admin/outreach/payment/settlement work exists before marking re-approval; the supersession predicate is equally strict |
| Re-approval concurrency | Approval supersession locked approval -> action while resume/reapproval locked plan -> action -> approval | Supersession now locks plan -> action -> approval, revalidates identity and owner, and maps residual deadlocks to 409 |
| Approval money | A generic superseding version could change requested/action amount while retaining stale `price_cents` and payload evidence | Noncanonical edits keep approval price/requested amount, action amount, payload cents, and V2 snapshot exact; canonical quote repricing/date change requires a fresh trusted quote |
| Analytics deep link | `eventId` was ignored, then an initial fix still failed when the event was older than the default 50-row feed | Analytics performs an exact owner-scoped event lookup and selects a valid requested event without trusting arbitrary IDs |
| Rebook UI state | Creating a rebook plan could append its messages to the previous plan thread | A new rebook replaces the prior conversation with the new plan's messages |
| Event identity reader | Legacy `plans.metadata.event_id` could become operational authority | Only `plans.materialized_event_id` is canonical; metadata is lineage/display only |
| Template eligibility | UI/API accepted legacy `complete` where the canonical database contract requires `completed` plus outcome evidence | New canonical template creation uses `completed`; legacy templates remain readable without inventing canonical provenance |

## Prompt 7 corrected status

| Requirement | Current implementation evidence |
|---|---|
| Reciprocal identity | Unique nullable `events.plan_id` and `plans.materialized_event_id`, owner-consistent and deferred |
| Explicit materialization | Service-only, row-locked, idempotent `materialize_plan_event` |
| Taxonomy | Lossless 19-archetype reference/mapping |
| Exact schedule | UTC instants plus IANA timezone intent; DST gap/fold and incomplete-window rejection |
| Lifecycle | Audited compare-and-swap transitions through `completed` and `archived` |
| Booking edge | Exact execution provenance and immutable material terms |
| Analytics | Materialized event is a normal owned event; exact `eventId` deep link is owner-checked |
| Template/rebook | Completed canonical source event is constrained; rebook carries source lineage into a fresh plan |
| Realized proof | Database-backed test walks chat/message -> authorization -> exact event -> analytics query -> template -> fresh rebook -> booking -> outcome |

The proof is a realized database/route/component integration chain, not a claim
that a single signed-in Playwright test exercises every provider and UI click.
Browser smoke evidence is recorded separately in the final gate section.

## Prompt 8 corrected status

| Lane | Truthful current outcome |
|---|---|
| Venue hold | Authorization creates one service-owned admin task and executing action; operator completion projects hold evidence to plan/event and tells the host; cancellation cancels pending work without rewriting authorization |
| Contact vendor | Authorization creates an unsent outreach draft for a verified address or one operator task when contact data is missing; it never claims a send |
| External checkout | One canonical HTTPS `external_url` is unlocked only after approval; the host opens it manually and explicitly confirms completion; confirm/cancel are atomic and replayable |
| Controlled payment | The public planner can stage a validated integer-cent `payment` proposal with required terms; Stripe execution, transaction bootstrap, capture, reconciliation, and payment cancellation remain Prompt 9 |
| Concierge/admin | Durable work is created only after executable approval; operator completion/cancellation updates action and host-visible state |
| Accepted quote | A trusted, price-evidenced response creates a frozen approval and, after authorization/materialization, an exact canonical booking or a durable operator task for unclaimed supply; unknown prices fail closed and explicit CHI/consumption-share zero-upfront terms remain representable |
| Partner identity | Discovery venue/vendor claims resolve through authoritative immutable mappings, and the booking freezes the exact discovery target, physical partner, action, approval, and snapshot hash before a response can execute |
| Partner response | Confirmation and decline are actor-bound atomic commands with a common lock order; canonical bulk commands cannot partially apply their canonical set, and deterministic reconciliation makes confirmation receipts/invoices crash-safe and replayable |
| Event completion | Server-stamped outcome after the exact event end moves the plan to `completed`, enabling analytics and canonical templates |
| Retry/re-approval | Only handlers with durable identities advertise retry; authorization replay and claim-plus-audit recovery are exact and atomic; started/terminal work is never rewound; ineligible plans show review-only evidence; untouched expired/stale work can enter the locked superseding-approval flow |
| Terminal/multi-partner boundary | Completed/archived plans cannot stage or authorize new positive work; exact replay and negative cleanup remain available, while both public partner APIs let a booked plan add/cancel a different partner slot but never duplicate an already-authoritative slot |

## Boundaries that remain intentional

- Prompt 9 owns controlled-payment execution and canonical transaction
  bootstrap. Prompt 8 must not call Stripe.
- Prompt 10 owns removal/consolidation of the legacy direct booking route.
- The separate purchase-race branch owns capture reservation and duplicate
  Stripe-attempt protection. This work preserves that interface and does not
  absorb it.
- Prompt 15 remains Option B: event access is consumed at canonical
  materialization/booking. It is not implemented by Prompt 7 or 8.
- Prompt 16 owns the generalized cross-provider execution-attempt ledger and
  worker recovery framework. Prompt 8 nevertheless recovers the concrete
  authorization, handoff, confirmation, and queue crash windows introduced by
  its own handlers; this report does not claim universal provider crash safety.
- Prompts 9–18 remain pending, so merging Prompts 1–8 does not by itself make
  the product 5,000-user ready. Pagination, RLS truth coverage, privacy,
  mobile parity, job leases, design/accessibility, and load/capacity gates are
  later work.

## Final local release gate

The corrected candidate passed the root-owned clean local gate on 2026-07-10:

- `supabase db reset` applied and seeded every migration through
  `20260709178000_make_canonical_venue_confirmation_effects_replayable.sql`
  from an empty local database.
- `npm run db:types` regenerated the Supabase types from that realized schema.
- `supabase db lint --local --fail-on error` passed with no errors and the three
  established warnings in older functions (`calculate_platform_fee`,
  `increment_event_usage`, and `consume_webhook_rate_limit`).
- The final opt-in realized database/security matrix passed 12 suites and
  297/297 assertions against the rebuilt database: stored functions,
  canonical identity/provenance, all Prompt 8 lifecycles, terminal-plan
  execution, authoritative vendor-claim binding, partner confirmation/decline,
  quote re-approval, vendor-rate repair, RLS/privileges/control-plane, and
  approval-version retry behavior. The ordinary suite separately covers every
  Prompt 7/8 static migration, route, helper, and component contract.
- The exact Prompt 8 workflow lane passed six suites and 25/25 assertions,
  including confirmation-effect, batch-confirmation, external-confirmation,
  resume-claim, and realized lifecycle coverage.
- A final independent read-only audit found one route/helper mismatch for a
  second partner after the plan reached `booked`; both venue/vendor POST and
  DELETE guards were corrected, and the resulting public-route lifecycle
  matrix passed 40/40 assertions.
- `npm run security:rls` confirmed that every realized public table has RLS
  enabled.
- The ordinary Jest regression passed 301 suites and 1,845 tests; 13 opt-in
  database suites (299 assertions) were intentionally skipped there and the
  release-critical subset was executed explicitly in the realized matrix
  above. Five snapshots passed.
- TypeScript passed. Lint passed with the same 16 pre-existing React hook
  warnings. `npm run security:deps` passed at the configured high-severity
  threshold; 2 low and 5 moderate transitive findings remain for later
  dependency upgrades.
- The optimized production build passed and generated all 39 static pages.
- Fixture outreach autonomy evals passed: reply-classifier accuracy/review/pause
  recall were 100%; all four active outreach scenarios required approval and
  produced zero forbidden commitment failures.
- Targeted Chromium verification ran 32 tests across preflight, warm-editorial
  design, signup validation, planner chat, launch contracts, and the
  authenticated live-event surface: 26 passed and six credential-dependent
  flows skipped by contract. No Next error overlay, server exception, or
  unexpected page error was observed. Prompt 8 route/component coverage also
  passed inside the full Jest suite.
- `git diff --check` passed.

No real payment, booking, checkout, or outbound message was executed. A live
OpenAI intake eval was also not run because no API key is configured; the
Prompt 7/8 release proof instead uses deterministic browser/component tests and
realized database/route integration. Final commit, pull-request, CI, and Vercel
preview evidence is recorded in the release receipt after publication.

- Final release commit: **PENDING_ROOT_FINAL_GATE**
- Clean reset / generated types / database lint: **PASS** through
  `20260709178000`, zero lint errors
- Realized database and security suites: **PASS**, 12 suites / 297 tests
- Focused Prompt 7/8 route, component, and schema suites:
  **PASS**
- Full Jest / lint / type-check / optimized build: **PASS**, 301 suites /
  1,845 tests plus all 39 static pages built
- Browser smoke and console result: **PASS**, 26 targeted Chromium tests; six
  credential-dependent tests skipped by contract
- Ready PR / GitHub checks / Vercel preview: **PENDING_ROOT_FINAL_GATE**

## Main/production status and merge blocker

Prompts 1–8 are branch-only; they are not in `origin/main` at the observed SHA
`461e3da`. Merging `main` automatically deploys the application. Hosted
Supabase's ledger was observed only through `20260627000000`, even though the
deployed application already expects the missing Prompt 1 incident migration
`20260701090000`; the host is also missing every Prompt 1–8 branch migration.
Code-first is incompatible with the old schema; schema-first also needs
coordination because the server-owned control-plane migration removes browser
write paths that the new code replaces.

Draft PR #203 on `codex/payment-capture-race-hardening` owns
`20260709090000_add_payment_intents_capturing_status.sql`, an earlier timestamp
than this branch's `20260709110000+` release inventory. Its release order must
be decided before the Prompt 1–8 migration bundle is applied: release it first,
or have its owner intentionally renumber and reverify it. Do not copy or rewrite
that separate migration here. Follow
`docs/runbooks/20260710-prompts-1-8-release.md`; do not merge until the hosted
dry run, historical preflight, coordinated schema/code window, and required CI
checks are complete. No hosted apply or merge is authorized by this report.
