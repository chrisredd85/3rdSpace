# 3rdPlace Product, Database, Function, Design, and 5k-User Scale Audit

**Audit date:** July 9, 2026 (America/Los_Angeles)
**Product baseline:** clean detached `origin/main` at `461e3da4e569a41d27c6e972fc467ef3ba042d17`
**Production baseline:** Vercel production deployment `dpl_cu5iufx9tESSAQCV1ixifRx6GtCx`, `READY`, built from the same commit
**Primary user:** recurring Bay Area community hosts
**Review mode:** diagnosis and report only; no application, schema, migration, or production-data changes

## Executive verdict

**3rdPlace is not ready for a general rollout to 5,000 users.** The product has a credible agent-first planning experience, a coherent warm editorial design system, strong test breadth, useful payment/reapproval primitives, a durable job-queue foundation, distributed production rate limiting, and current production observability. Those are real strengths.

The blocking issue is not raw page count or code volume. It is **operational truth**: the application currently cannot guarantee that a plan becomes the same event that gets booked, paid, completed, analyzed, and rebooked. Several UI states claim that work was sent, queued, authorized, or priced correctly when the underlying state either stops at an approval record, points at the wrong aggregate, can be changed directly by a client, or can fail inside a broken database function.

The database audit also found separate authorization and privacy blockers that are broader than the accidental-multiple-purchase work happening in another task:

- 35 of 36 realized `SECURITY DEFINER` functions are executable by both `anon` and `authenticated` locally; many do not validate the caller.
- Financial views are selectable as `anon` in the realized local schema.
- Six stored functions fail database lint against the realized schema.
- Trusted execution records (`agent_actions`, `approvals`, `admin_tasks`, and related audit/derived rows) are directly client-writable under current policies.
- Active tables can have RLS enabled but no policies, so the current RLS check reports green while maintained features fail closed.
- The hosted migration ledger trails `origin/main` by the latest supply-intent migration.

**Recommended business posture:** do not market this as a complete execution replacement or open it to an unbounded 5k-user audience yet. After the P0 items in this report are closed, a controlled design-partner pilot can be appropriate. A 5k-user rollout should require a separate, measured capacity gate because no repository load harness currently proves that level.

## Scope and evidence boundaries

This was a broad trust-surface audit, not a narrow code review. The inspected baseline contains:

- 109 rendered page routes.
- 233 API route handlers.
- 128 checked-in migration versions through `20260701090000`.
- 157 realized local `public` tables.
- 242 passing Jest suites and 1,337 passing tests.

The review covered:

1. Role-specific signup and profile fields.
2. Planner intake, recommendations, approvals, and plan revisions.
3. Venue/vendor sourcing, discovery, outreach, messaging, and quote commitment.
4. Controlled payment, external checkout, and concierge/admin execution modes.
5. Event materialization, ticketing, live-event data, settlement, analytics, templates, and rebooking.
6. RLS, grants, stored functions, views, type generation, constraints, indexes, retention, privacy deletion, and job recovery.
7. Desktop and mobile layout, margins, responsive behavior, information hierarchy, loading/error/empty states, keyboard behavior, form accessibility, and copy truth.
8. `origin/main`, Vercel deployment identity, production environment-variable names, production runtime errors, public health, build, lint, unit/integration tests, DB audit, RLS checks, dependency audit, and eval gates.

### Important limitations

- No real purchase, capture, refund, booking, or outbound email/SMS was sent. Doing so would have created production side effects.
- The purchase-deduplication implementation in the other task was not duplicated here. This report identifies the authorization, aggregate identity, state-transition, and UI dependencies that work must rely on.
- Hosted migration history was verified. Hosted database ACLs and `pg_proc` privileges were not directly queried, so local realized-DB security findings are not labeled production-confirmed. The migrations that create the risky defaults are applied remotely, which is sufficient to require a hosted verification before rollout.
- The live planner was exercised unauthenticated in local-draft mode. There was no configured E2E builder password for a safe authenticated production execution run.
- “5,000 users” is interpreted as registered users, not 5,000 simultaneous users. A concurrency and traffic model still needs to be agreed and tested.

## Readiness scorecard

| Surface | Status | Why |
|---|---|---|
| Product positioning | At risk | Clear recurring-host positioning, but homepage claims exceed current execution outcomes. |
| Planner intake | Promising | Live draft intake worked, but event taxonomy drifted during follow-up and the “no vendors” answer was not respected in gate copy. |
| Approval model | Blocked | Strong primitives exist, but editing can approve, failures cannot retry, and client policies can forge trusted state. |
| Three execution modes | Blocked | Modes are defined, but hold/vendor/external actions do not complete end to end and controlled payment has a bootstrap deadlock. |
| Plan-to-event outcome loop | Blocked | `plans` and `events` are separate aggregates with no formal identity link or normal completion transition. |
| Financial correctness | Blocked | Multiple 100× unit/percentage errors can misstate deposits, vendor prices, and margin. |
| Database authorization | Blocked | Broad function/view privileges and client-writable control-plane rows require immediate remediation. |
| Database quality gates | Blocked | Six stored functions lint as invalid; type and policy checks are incomplete. |
| Desktop design | Generally strong | Warm editorial system is coherent; page gutters and some truthful state/copy issues remain. |
| Mobile design/function parity | Blocked | Below 1024px, multiple routes swap to reduced objects/actions and can show a blank initial render. |
| Accessibility | At risk | Immediate validation errors, unlabeled fields, undersized targets, missing dialog/focus semantics, and fake controls. |
| Operational tooling | At risk | Sentry, Redis, crons, and queues exist; admin counts truncate/suppress failures and a production cron is repeatedly erroring. |
| Capacity for 5k | Unproven | No load harness, capacity model, SLO validation, or representative data volume exists. |

## P0 stop-ship gaps

These should be closed before inviting a general user population or describing the platform as a reliable end-to-end execution system.

### P0.1 — Lock down database function and view privileges

The baseline sets broad default privileges on future functions and tables/views. In the realized local database:

- 36 functions are `SECURITY DEFINER`.
- 35 are executable by both `anon` and `authenticated`.
- 26 of those 35 contain no `auth.uid()`, `auth.role()`, or `auth.jwt()` validation.

Verified caller-unaware functions include job claiming, billing-access consumption, settlement transitions, Stripe webhook reservation/result tracking, account payment blocking/unblocking, and invitation creation. `apply_plan_revision_atomic` validates ownership of one plan but accepts arbitrary recommendation, approval, and outreach IDs without proving those records belong to that plan.

The same baseline grants broad future table/view privileges. Under local `SET ROLE anon`, the following succeeded:

- `organizer_baselines`
- `event_ticket_sales_rollups`
- `vendor_analytics` (50 rows in the local fixture DB)

These expose organizer performance/profit baselines, event ticket/refund/revenue rollups, and per-vendor revenue/booking metrics.

**Risk:** anonymous or unrelated authenticated callers may claim jobs, mutate settlement/webhook/billing state, create invitations for another organizer, or read financial analytics if the hosted ACLs match the realized migration behavior.

**Evidence:**

- `supabase/migrations/20260420000000_remote_baseline.sql:3763-3776`
- `supabase/migrations/20260429120000_add_builder_ticketing_connections.sql:205-237`
- `supabase/migrations/20260623000000_update_builder_pro_monthly_to_79.sql:76-261`
- `supabase/migrations/20260624013000_block_stripe_account_settlements.sql:70-274`
- `supabase/migrations/20260624015000_add_settlement_audit_log.sql:55-271`
- `supabase/migrations/20260624016000_add_stripe_webhook_reservations.sql:29-261`
- `supabase/migrations/20260624010000_add_projection_baselines.sql:9-62`
- `supabase/migrations/20260624000000_fix_ticket_sales_rollup_refund_math.sql:8-79`
- `supabase/migrations/20260428172000_add_vendor_analytics.sql:14-82`

**Exit gate:**

1. Hosted and local `has_function_privilege` return false for `anon`/`authenticated` on every service-only function.
2. User-callable RPCs derive identity from `auth.uid()` and scope every affected ID to the owned aggregate.
3. Default broad table/view/function privileges are revoked.
4. Views explicitly grant only intended roles and use `security_invoker=true` where source RLS should apply.
5. Cross-tenant and anonymous negative tests run in CI against a realized database.

### P0.2 — Repair the six broken stored functions and make DB lint a release gate

`supabase db lint` reports six realized function errors:

| Function | Failure | User impact |
|---|---|---|
| `apply_plan_revision_atomic` | text/date `COALESCE` mismatch | Revision application can fail to supersede stale approvals. |
| `block_inflight_stripe_account_payments` | writes nonexistent `kickback_payments.updated_at` | Account restriction handling can abort/roll back. |
| `transition_settlement_charge_status` | ambiguous `failure_reason` | Settlement charge transitions can fail. |
| `consume_builder_event_access` | writes nonexistent `builder_event_usage.updated_at` | First paid/free event activation can fail. |
| `create_vendor_invite` | ambiguous `vendor_id` | Repeat invitation creation can fail. |
| `create_venue_invite` | ambiguous `venue_id` | Repeat invitation creation can fail. |

These are especially important because several unit/schema tests pass while the realized function bodies remain invalid.

**Evidence:**

- `supabase/migrations/20260626002000_add_atomic_plan_revision_and_derived_state.sql:149-150`
- `supabase/migrations/20260624013000_block_stripe_account_settlements.sql:138-146`
- `supabase/migrations/20260624015000_add_settlement_audit_log.sql:201-220`
- `supabase/migrations/20260623000000_update_builder_pro_monthly_to_79.sql:207-240`

**Exit gate:** a clean database reset passes `supabase db lint --fail-on error`, followed by live transactional success, stale-state, and unauthorized-caller tests for each function.

### P0.3 — Make the execution control plane server-owned

Plan owners can directly insert/update `agent_actions`, `approvals`, and internal `admin_tasks`, including task status and internal notes. Related authorization/profit derived-state rows and audit concepts also allow client mutation. The database does not enforce core impossible-state rules such as:

- one approval per action;
- approval/action plan consistency;
- authorized amount no greater than requested amount;
- an authorized state requiring actor, timestamp, snapshot, and non-expired approval;
- trusted audit/cache provenance.

This is a direct dependency for the accidental-multiple-purchase work in the other task. Idempotency and uniqueness cannot protect the platform if a browser role can forge the state that authorizes execution.

**Evidence:**

- `supabase/migrations/20260504000002_agent_planner_schema.sql:661-691,773-797`
- `supabase/migrations/20260626002000_add_atomic_plan_revision_and_derived_state.sql:54-93`

**Exit gate:** browser/session roles are read-only on trusted execution state; all transitions go through caller-validating RPCs or service-owned routes; database constraints reject impossible combinations; direct PostgREST mutation tests fail.

### P0.4 — Establish one canonical plan → action → booking/event → outcome identity

The product currently operates two event aggregates:

- `plans`: flexible event types, date windows, chat, recommendations, approvals, and agent actions.
- `events`: exact date/start/end, a seven-value legacy event-type constraint, ticketing, sales, attendance, settlement, and analytics.

There is no FK in either direction. Approving actions does not normally advance plan status. Quote commits update plan metadata but create no booking. The legacy venue-booking route creates a separate generic event. Desktop analytics reads `events`, so planner-only events can disappear from reporting and rebooking.

Many supported planner archetypes cannot be materialized into the seven legacy event types without an undocumented mapping.

**Evidence:**

- `supabase/migrations/20260504000002_agent_planner_schema.sql:9-49`
- `supabase/migrations/20260420000000_remote_baseline.sql:722-755`
- `app/api/planner/plans/[planId]/route.ts:520`
- `app/api/planner/plans/[planId]/commit-venue/route.ts:35`
- `app/api/builder/venue-bookings/route.ts:64-183`
- `lib/hooks/useEvents.ts:38`

**Exit gate:** document and implement a canonical event identity with an explicit materialization transition, taxonomy mapping, timezone-aware exact schedule, and E2E proof from chat through booking/payment, live event, outcome report, template, and rebook.

### P0.5 — Complete all three execution modes after approval

Exactly three execution modes are defined, which is correct. Their current product outcomes are incomplete:

| Host action | Current observed/implemented outcome |
|---|---|
| Request venue hold | Creates an approval. After authorization it remains approved/pending; no hold request or admin task is sent. |
| Contact vendor | Creates an approval and displays queue/sent-style success copy, but no admin task or outbound action is created. |
| Approve external checkout | Records approval, but no link is rendered/opened afterward. The UI stores `url`; execution reads `external_url`/`checkout_url`. |
| Controlled payment | Lower-level routes are tested, but the general planner cannot create a `payment` action. The venue-rental UI cannot bootstrap the approval ID checkout requires. |
| Concierge/admin | Some tasks are created before approval; simple recommendation CTAs create none. Admin completion does not update the host plan/action/booking. |
| Accept a quote | Updates plan metadata/economics only; it does not create a booking or the promised next approval. |
| Finish an event | No normal flow consistently advances `ready → approved → executing → complete`; post-event analytics/templates remain disconnected. |

The recommendation action schema excludes `payment` and `concierge_queue`. After approval, only Gmail/outreach preparation has a real executor; other actions short-circuit.

**Evidence:**

- `app/api/planner/plans/[planId]/agent-actions/route.ts:56-90,258-360`
- `lib/planner/execution/executeApprovedAction.ts:57-116`
- `app/api/planner/plans/[planId]/approvals/route.ts:586-634`
- `components/planner/planner-page/PlannerConversation.tsx:1147-1213,1252-1381,2231`
- `lib/server/admin-tasks.ts:146-230`

**Exit gate:** each mode has one E2E test proving proposed → explicitly approved → executed/handoff queued → externally confirmed or operator-completed → visible host state, including retry and cancellation.

### P0.6 — Separate editing from authorization and preserve approval fields

The approval card exposes editable amount, date, and notes. “Save changes” sends only amount, rounds cents to whole dollars in some paths, and immediately authorizes/approves the action. Date and notes are discarded.

Expired, failed, and reapproval-required states can render as actionable “pending,” while later payment code rejects them. Failed Gmail/outreach execution is terminal and cannot be retried because a second authorization request hits an “unchanged” early return.

**Risk:** a host can believe they edited a proposal for review when they actually authorized a different payload; a `$95.50` amount can become `$96`; an expired/failed action can appear actionable without a recoverable executor.

**Evidence:**

- `components/planner/planner-page/PlannerConversation.tsx:1857-1865,1949-1965,2023-2063,2103-2147,2542-2550`
- `app/api/planner/plans/[planId]/approvals/route.ts:186-230,614-634`
- `lib/planner/execution/approvalState.ts:75-102`
- `lib/planner/execution/paymentApproval.ts:98-132`

**Exit gate:** editing creates a persisted superseding version and never approves; authorization is a separate confirmation showing the exact snapshot; all fields round-trip; failed execution has an explicit, idempotent retry command.

### P0.7 — Resolve controlled-payment bootstrap and booking identity

The booked-partner workspace passes `transaction?.approval_id ?? null` to checkout. Checkout requires a UUID. The transaction containing that approval ID is only inserted inside checkout after the approval is validated. The public action API cannot create the seeded `payment` state used by lower-level tests.

Partnership loading also finds the newest confirmed booking by organizer and venue, not by plan/event. Checkout proves plan ownership and booking ownership independently but does not prove they represent the same event. Repeated events at the same venue are therefore vulnerable to attaching the wrong booking.

This finding is adjacent to the other task’s duplicate-purchase work and should be treated as a required upstream identity/interface fix, not a replacement for that work.

**Evidence:**

- `components/planner/BookedPartnersWorkspace.tsx:653-669`
- `app/api/planner/plans/[planId]/venue-payment/checkout/route.ts:32-36,145-183,442-470`
- `lib/planner/partnershipWorkspaces.ts:460-499`
- `__tests__/integration/planner-deposit-execution-routes.test.ts:185`

**Exit gate:** the canonical approved payment action creates/owns the transaction; booking, approval, plan, event, counterparty, amount, and terms are joined by enforced keys; cross-event mismatch tests fail before Stripe is called.

### P0.8 — Fix all monetary-unit and percentage-unit contradictions

Three separate 100× errors were found:

1. `vendor_profiles.base_rate` is written as cents during signup and read as cents by ranking, but the maintained vendor pricing/services screens label it as dollars and persist the raw number. Entering `$1,500` can become `1,500` cents (`$15`) in planner economics.
2. Venue detail computes a 4-hour booking cost in cents. One deposit component receives dollars; the duplicate component inside the request form receives raw cents even though its contract expects dollars. A `$400` deposit can render as `$40,000`.
3. Recommendation logic produces margin as a `0–1` ratio, while workspace logic compares it against `20`. Normal events are labeled below 20% margin.

**Evidence:**

- `lib/server/account-setup.ts:494-508`
- `lib/vendors/vendorGates.ts:137-143`
- `lib/vendors/vendorRanker.ts:305-320`
- `app/(dashboard)/vendor/pricing/page.tsx:162-175,281-291`
- `app/(dashboard)/vendor/services/page.tsx:695-696`
- `lib/venues/venue-adapter.ts:122-143`
- `app/(planner)/planner/venues/[venueId]/page.tsx:23-57,168-186`
- `components/forms/BookingRequestForm.tsx:255-265`
- `components/builder/DepositDisplay.tsx:27-39,62-74,149-193`
- `app/api/planner/plans/[planId]/recommend/route.ts:2043`
- `lib/planner/planAgentSummaries.ts:322`

**Exit gate:** canonical integer-cent DB fields, named `*Cents` types, canonical margin-percent representation, one conversion at UI boundaries, and round-trip tests for every signup/settings/ranking/payment surface.

### P0.9 — Route all venue requests through approval and fail closed on rules

The planner venue detail page can directly POST to the legacy venue-booking route. That route creates an `events` row and a `venue_bookings` row without a planner approval or active-plan relationship. It can generate invalid `25:00` end times and client validation rejects legitimate overnight events.

Venue rules also fail open: while loading or on error, the rule list is empty, `isAccepted` becomes true, and Submit can enable. The same surface states that payment collection is not active yet.

**Evidence:**

- `app/(planner)/planner/venues/[venueId]/page.tsx:64-94`
- `app/api/builder/venue-bookings/route.ts:40-72,128-183`
- `components/forms/BookingRequestForm.tsx:32-52,121-145,255-299`
- `components/builder/VenueRulesDisplay.tsx:116-142`
- `components/builder/DepositDisplay.tsx:184-190`

**Exit gate:** request creates an approval-backed action tied to the active plan; booking creation occurs only after authorization; rules must load and their version/hash be accepted; timezone-aware datetimes support next-day end times.

### P0.10 — Restore release/schema parity and stop the live discovery error loop

The latest production deployment is on `461e3da`, but the linked hosted migration history is applied only through `20260627000000`; it is missing `20260701090000_add_plan_supply_intents.sql`, which `origin/main` expects.

Vercel runtime aggregation found 78 occurrences across four affected users of:

`[discovery.refresh] change_log_insert_failed`

The production cron is trying to write `source` data that violates `discovery_change_source_check` on `discovery_change_log`. The error occurred from June 28 through July 9 and is present on the latest deployment.

**Risk:** production code and schema are not the same release, special/activity supply intents may not persist, and scheduled discovery refresh loses its change log while continuing to run.

**Exit gate:** deployment commit and hosted migration ledger match exactly; hosted post-deploy schema/ACL/function checks pass; discovery refresh produces zero constraint errors and an alert fires on the first recurrence.

## Data-field and database coverage review

### Field-domain inventory

| Domain | Fields/structures with good coverage | Gaps or contradictions |
|---|---|---|
| Identity and roles | User/profile IDs, role-specific builder/venue/vendor profiles, terms acceptance, billing counters, deletion requests | Venue booking-contact email/role and vendor contact email are not consistently persisted; many completeness rules live only in application code. |
| Creator onboarding | Name/email/password; org name/type/social/website/bio; event types; average attendance; preferred amenities; optional ticketing/templates/Gmail/collaborators | Later Settings exposes only display name, company, email, and phone; most onboarding preferences cannot be corrected self-service. |
| Venue onboarding | Contact/role/email/phone; venue identity/type/address/loading/capacity/prep; amenities/photo guidance/rules; pricing/deposit/cancellation; availability/calendar concepts | One `price_per_night` input is written to hourly, daily, and nightly cent columns; booking-contact fields are incomplete; maintained availability/amenity/photo tables can have no RLS policies. |
| Vendor onboarding | Person/business/contact; service categories/area/portfolio/bio; base price/package/deposit/lead/cancellation; availability/emergency/uplift | `base_rate` has contradictory dollar/cents writers; contact email can be absent; packages are on an active zero-policy table. |
| Planner | Plan lifecycle, messages, recommendations, approvals, versions, revisions, derived state, supply intents, budget, timeline metadata | No event FK; polymorphic/JSON metadata; full versions are not created on every approval; client can write trusted state; revision RPC is broken. |
| Supply/discovery | Source IDs, freshness, capacity/rate confidence, Google fields, response snapshots, search indexes | Contact/enrichment fields are broadly visible; committed vendors are a JSON array; remote lacks latest supply-intent migration; change-log cron constraint mismatch. |
| Execution/payment | Integer cents and state checks in newer ledgers, Stripe idempotency concepts, reapproval hashes, partial unique indexes | Public function grants, broken functions, approval impossible states, mixed legacy decimal/dollar fields, wrong aggregate linkage, and incomplete executors. |
| Outreach | Threads/messages/drafts, Gmail identifiers, policy audit/trust history, schedule/poll indexes | Owner-selectable credential ciphertext columns, client-mutable history, unenforced retention, and terminal execution retry gap. |
| Ticketing/live event | Platform/order uniqueness, ticket/refund cents, attendance and projection baselines | Keys attach to `events`, not planner `plans`; anonymous financial view access; exact schedule lacks a canonical timezone bridge. |
| Analytics | Revenue, costs, attendance, elasticity, scorecards, Community Host Incentive settlement data | Missing costs default to zero; all-or-nothing loaders; broken event-to-plan detail links; planner-only events absent; margin unit mismatch. |
| Operations | Durable `app_jobs`, `SKIP LOCKED`, retries/dead state, admin tasks, audit logs | Anonymous job claim privilege, no crash lease recovery, truncated/false admin counts, client-writable tasks/audits, insufficient archival. |
| Privacy | Admin-reviewed deletion workflow, some token removal/anonymization, multiple audit tables | Deletion misses PII across plan messages, approvals, support, attendees, notifications, and before/after payloads; no full 157-table retention matrix. |

### Schema and type drift

- 157 live public tables versus 133 generated table types.
- 24 tables are missing from `lib/types/database-generated.ts`.
- 50 fields are missing on tables that are represented.
- Missing domains include settlement, plan revisions/derived state/supply intents, support, deletion requests, discovery vendor/change-log tables, approval supersession fields, and committed-plan fields.
- There are 465 `as any` and 174 `as never` occurrences under `app/`, `components/`, and `lib/`.
- `npm run type-check` passes, showing that casts hide schema drift rather than proving schema correctness.
- `lib/types/database.ts` still models legacy venue fields such as `name`, `capacity`, `is_active`, and `is_verified`.

**Required change:** generate types from a clean realized schema in CI, compare to the committed file, fail on drift, and maintain an explicit exception list for any remaining schema casts.

### RLS coverage is falsely green

All 157 public tables have RLS enabled, so `npm run security:rls` passes. Sixteen tables have zero policies. Maintained reachable examples include:

- `availability_blocks`
- `vendor_packages`
- `venue_amenities`
- `venue_photos`
- `venue_requirements`

Browser/session paths directly CRUD several of them, so those features deny every row/write despite the green check.

**Evidence:**

- `scripts/security/check-rls.ts:99-144`
- `app/api/venue/blocks/route.ts:61-73,182-199`
- `app/api/venue/amenities/route.ts:102-128,195-243`
- `lib/hooks/useVenuePhotos.ts:14-30,60-99`
- `lib/hooks/useVendorPackages.ts:14-29,33-56`

**Required change:** the security gate must test policy existence, intended operations, owner access, unrelated-user denial, and anon denial for every reachable table.

### Index, JSON, and retention scale risks

- 323 foreign keys exist; 89 lack a left-prefix supporting index. Prioritize frequent joins/cascades including `plans.committed_venue_id`, `events.venue_id`, `message_threads.event_id`, sales/integration keys, and outreach audit keys.
- `plans.committed_vendors` is a JSON array. Discovery invalidation reads up to 500 plans with any non-null value and filters in Node. The default is `[]`, so the query trends toward scanning every plan and silently truncates after 500.
- Full-plan GET returns every message, recommendation, and approval with no pagination.
- Job claiming correctly uses `FOR UPDATE SKIP LOCKED`, but a worker crash can leave a job in `running` indefinitely because there is no lease/heartbeat/stale reclaim.
- Terminal jobs, webhook payloads, plan messages, error logs, and most audit tables have no clear pruning/archival policy.
- `outreach_policy_audit_logs.retention_expires_at` has neither an expiry index nor a cleanup consumer.

## Functional event-lifecycle review

### The intended loop

The stated product loop is strong and appropriate:

1. Host describes event.
2. Agent drafts plan and economics.
3. Host approves each action.
4. System executes the approved mode.
5. Host reviews outcome and rebooks.

### The actual loop today

```text
Draft plan
  → recommendations
  → approval record
  → [mostly stops here]

Separate legacy path
  → generic events row
  → venue booking / ticketing / analytics

No enforced identity connects the two loops.
```

The central product gap is therefore not “missing another feature.” It is that the product has multiple partially overlapping paths without one authoritative state machine.

### Live unauthenticated planner observation

A synthetic production draft was entered for a 30-person private founder dinner in the Mission on August 20, 2026 with a $5,000 budget.

Observed outcome:

1. The planner correctly extracted date, headcount, neighborhood, budget, privacy, cuisine, and room preferences.
2. It asked a sensible food/bar-responsibility question.
3. After the reply, the plan title drifted from `Founder/operator dinner plan` to `Private dinner / celebration plan` despite the initial archetype.
4. After the explicit answer “no external vendors,” the final gate still said it had enough to match “venues and vendors.”
5. It stopped at “Create a planner account” and correctly stated the draft was local; no real recommendation, approval, booking, or payment was created.
6. A stale browser refresh token generated a console `Invalid Refresh Token` error, although draft mode recovered and remained usable.

The draft gate is a good safety boundary. The taxonomy/vendor-need drift means the information carried into the saved plan cannot yet be treated as fully reliable.

### Billing truth mismatch

Marketing says “Pay only when you ship” and describes one event credit as covering one shipped event. Product access is actually consumed on the first approval, outreach start, or date-change start.

**Evidence:**

- `app/(marketing)/pricing/page.tsx:15-16`
- `app/(marketing)/page.tsx:434-445`
- `lib/planner/productAccess.ts:37-75`

This needs a product decision and copy/implementation alignment. An organizer should know exactly when a free event or paid credit is consumed, and retries/cancelled plans should have explicit rules.

### Additional lifecycle gaps

- Opportunity/concierge tasks can be inserted before the host approves; cancelling approval does not consistently cancel the task.
- Admin task completion updates only the task/audit record and does not create a booking, update the action/approval, or message the host.
- Multi-table action/approval/message/invite/task writes are sequential rather than atomic; late failures leave partial state.
- Planner message writes have no client request ID; recommendation retry inserts new active rows and some failures return HTTP 200 with an empty result.
- Accepted venue/vendor partners can disappear while their invite status changes to Stripe-setup states that the booked-partner workspace does not query.
- Quote-commit routes trust arbitrary client-supplied venue/vendor IDs and terms after checking only plan ownership.
- Post-event reporting appears only for a subset of Community Host Incentive cases and does not complete a general plan.
- Templates can snapshot unfinished plans; rebooking can append new-plan messages to prior-plan in-memory messages.
- Approval Queue considers only one newest active plan from the latest ten plans.

## Design, spacing, responsive, and accessibility review

### What is working

- Cream/clay/forest tokens and Fraunces/Inter/JetBrains Mono hierarchy are coherent.
- The marketing homepage communicates the recurring-host ICP clearly.
- Desktop sections have generous editorial whitespace and no horizontal overflow at 1440px.
- The homepage at 390px also had no horizontal overflow.
- Most primary surfaces include some loading, empty, and error treatment.
- Experiences uses the right operating-record mental model.
- Analytics tables use horizontal overflow where appropriate.

### Measured marketing layout

At a 1440×1000 viewport:

- Header height: 75px.
- Header horizontal edge: 32px.
- Hero input: 647×78px at x=56.
- No body horizontal overflow.
- Main content is a nested 926px-tall scroll container with 10,258px scroll height and mandatory vertical snap.

At a 390×844 viewport:

- Header edge: 20px.
- Hero input: 302×78px at x=44.
- Main content is a nested 770px-tall scroll container with 12,938px scroll height and mandatory vertical snap.
- Menu and Send controls are 40px tall.
- Quick-prompt buttons are only 26px tall.
- Several footer links have a 17px rendered target height.

The visual margins are mostly balanced, but mandatory snap on a long nested scroller increases navigation friction. The scroller removes its focus outline and intercepts navigation keys. The marketing mock “Authorize $1,800” control is keyboard-focusable but does nothing, which teaches a false interaction.

**Evidence:**

- `components/marketing/HomepageSnapScroller.tsx:13-82`
- `app/(marketing)/page.tsx:123-145`

### Inconsistent planner gutters

The planner shell does not provide a shared content gutter. Some pages add `px-4 sm:px-6 lg:px-8`; others—Settings, Billing, Support, and venue/vendor detail—can render flush to the shell content edge.

**Required change:** a shared `PlannerPageShell` with 16/24/32px responsive gutters, a deliberate max-width policy, and a single compact/full-bleed opt-out.

**Evidence:**

- `components/planner/PlannerShell.tsx:123`
- `app/(planner)/planner/settings/page.tsx:13`
- `app/(planner)/planner/billing/page.tsx:197`
- `app/(planner)/planner/support/page.tsx:24`

### Mobile function parity is the larger design problem

Below 1024px, several routes swap from their desktop product to a simplified `MobilePlanner` projection:

- Payments becomes only approvals.
- Messages becomes eight plan messages rather than the partner inbox.
- Venues/vendors become active-plan recommendation summaries rather than catalogs/booked-partner workspaces.
- Settings is read-only and “Edit” routes back to the same simplified view.
- Billing shows status without full plan management.

The mobile branch mounts only after `useEffect`, while CSS hides desktop content, producing a blank initial render until JavaScript hydrates. The route-promotion check uses exact path matching, so nested experiences, venue/vendor detail, integrations, delete-account, import, and live-event routes can retain desktop chrome or render double headers on mobile.

**Evidence:**

- `components/planner/mobile/PlannerResponsiveLayout.tsx:12-53`
- `components/planner/mobile/MobilePlanner.tsx:1039-1071,2232-2315,2561-2595,2716-2744`
- `components/planner/PlannerShell.tsx:22-34,52-69,95-127`

**Exit gate:** define object/action parity per route and test 390, 768, 900, 1023, and 1024px, including nested routes and no-blank-first-paint assertions.

### Form and interaction accessibility

The live creator signup showed required errors immediately before fields were touched. The organization-type combobox had no accessible name. Static review found labels are often visual rather than programmatically connected; chip groups lack `aria-pressed`; disabled Continue prevents an attempted submit from focusing/announcing the first invalid field.

Other interaction gaps:

- Mobile/marketing overlays lack dialog semantics, Escape behavior, focus trapping/return, and body-scroll management.
- `⌘K` is displayed without a shortcut implementation.
- Notifications has no handler.
- The resize separator is keyboard-focusable but pointer-only.
- Planner tabs do not expose tab semantics.
- Dark-theme remnants (`text-yellow-100/200`, `text-red-200`) create poor contrast on the cream theme.

**Evidence:**

- `components/auth/SignupExperience.tsx:180-320,616-660,1073,1417`
- `components/marketing/Header.tsx:66-104`
- `components/planner/mobile/MobilePlanner.tsx:1269`
- `components/planner/PlannerTopBar.tsx:83`
- `components/planner/PlannerShell.tsx:133`
- `components/planner/planner-page/PlannerWorkspace.tsx:1634`
- `components/builder/VenueRulesDisplay.tsx:158`
- `components/builder/DepositDisplay.tsx:155`

## 5k-user capacity and operational review

### Foundations that can scale

- Production is configured with Upstash/Redis names and the rate limiter fails closed in Vercel production when credentials are absent or Redis fails.
- `WORKER_SECRET`, `CRON_SECRET`, Stripe, OpenAI, Supabase service, Gmail/Google, Eventbrite, Sentry, and the main Redis variable names are present for production in Vercel metadata (values were not decrypted).
- `app_jobs` uses `FOR UPDATE SKIP LOCKED` for multi-worker claiming.
- Newer payment paths contain useful uniqueness/idempotency and reapproval checks.
- Sentry is integrated for server, edge, and client paths.
- Vercel production is on the audited `origin/main` commit and `/api/health` returns `{"status":"ok"}`.
- Production build succeeds on Next.js 15.5.18.

### Why 5k remains unproven

1. There is no k6, Artillery, autocannon, or equivalent load harness.
2. Local fixture volume is not representative: 130 auth users, 30 builders, 75 events, 50 venues, 50 vendors, but zero plans, plan messages, outreach threads, event-sales rows, or jobs.
3. Venue catalog loads only the first 20 and ignores `hasMore`; vendor catalog caps at 60.
4. Experiences loads 50 plans and 75 events, truncates the merged set to 20, then shows only four with no “view all.”
5. Admin task UI hard-caps at 250. Admin ops samples 30 per source and can calculate “totals” from those samples.
6. Query failures in admin/analytics often become empty arrays, making outages look like zero work.
7. Full-plan payloads are unpaginated and grow with message/recommendation retries.
8. Pending approvals inspect only the latest ten plans and show one newest active plan.
9. JSON commitment lookup filters in Node and truncates at 500 plans.
10. No stale-job lease recovery, broad retention policy, or representative restore/load exercise was found.
11. The public intake request is synchronous with OpenAI; other recommendation work has long request-bound paths rather than a uniformly durable asynchronous workflow.
12. The health endpoint is intentionally shallow and proves only that the app process answers, not DB/provider/worker health.

### Truncated or misleading product surfaces

| Surface | Current cap/behavior | Scale consequence |
|---|---|---|
| Venue catalog | Default first 20; `hasMore` ignored | Search, stats, and “catalog” represent only page one. |
| Vendor catalog | Maximum 60 | Inventory disappears silently as supply grows. |
| Experiences | 50 plans + 75 events → 20 merged → 4 shown | Recurring hosts cannot find older events. |
| Approval queue | Latest ten plans; one newest active plan | Pending authorization can become invisible. |
| Admin tasks | Latest 250, client filtering | Open operator work can disappear. |
| Admin ops | 30-row samples; errors become empty | Counts and SLA health can be materially false. |
| Plan detail | All messages/recommendations/approvals | Payload/DOM grows without bound per active plan. |
| Templates | Every template is a full expanded form | Page becomes unusable as template count grows. |

### Proposed capacity gate

First define expected peak concurrency, event frequency, planner turns, catalog size, webhook burst, and operator staffing. Then test at **2× the agreed peak**, not simply “5,000 accounts.” A reasonable first test matrix for this product should include:

- catalog/search and Experiences reads;
- concurrent planner messages with provider delay/failure injection;
- approval/reapproval conflicts;
- payment/webhook bursts without duplicated side effects;
- outreach queue and worker crash recovery;
- admin queue pagination beyond 250 open tasks;
- plans with thousands of messages/approvals/recommendations;
- hosted Postgres connection pressure and slow-query analysis.

Suggested release SLOs to agree before the test:

- non-AI API p95 ≤ 1 second and p99 ≤ 2 seconds at the target load;
- durable planner command acknowledgement ≤ 1 second, with provider work visible as queued/running rather than a hanging request;
- error rate < 0.5% excluding intentional 4xx responses;
- zero cross-tenant reads/writes;
- zero duplicate irreversible effects;
- zero lost/hidden open approvals or admin tasks;
- stale jobs recovered within the defined lease window;
- alerts for repeated cron/function/webhook failures.

## P1 backlog — required before a broad 5k rollout

1. **Retryable, atomic commands:** add client request IDs; atomically write action/approval/message/task state; explicit execution-attempt records; retry failed executors safely.
2. **Hosted schema truth:** apply and verify the missing migration; run hosted ACL, policy, function-lint, and generated-type diff checks after deploy.
3. **RLS behavior tests:** policy existence plus positive/negative role tests for every reachable table and RPC.
4. **Type regeneration:** eliminate the 24 missing tables and 50 missing columns; gate drift in CI.
5. **Contact privacy:** expose a safe public catalog projection and keep emails, phones, extracted contact forms, and enrichment details plan/admin-scoped.
6. **Privacy deletion/retention matrix:** cover all 157 tables, metadata payloads, storage objects, audits, attendees, support, and legal-retention exceptions.
7. **Job leases and retention:** heartbeat/stale reclaim, terminal-job pruning, expiry indexes, cleanup metrics, and operator replay tools.
8. **Server pagination and truthful totals:** catalogs, Experiences, approvals, admin tasks/ops, plan histories, templates, and analytics.
9. **Mobile parity:** one route manifest, shared data objects/actions, useful SSR state, and nested-route visual regression tests.
10. **Independent section errors:** payments, analytics, and ops should preserve healthy/stale-good sections rather than clear everything after one endpoint failure.
11. **Truthful success language:** use “Approval created” or “Queued for review” until actual outbound/checkout/operator completion evidence exists.
12. **Outcome loop:** general event completion, actual costs/revenue, lessons, template eligibility, and rebook all tied to the canonical event identity.
13. **Signup/settings parity:** let users maintain the profile/preference fields that ranking and outreach depend on.
14. **Billing truth:** define when a free/paid event is consumed, how cancellation/retry works, and align marketing, terms, UI, and RPC behavior.
15. **Compliance nomenclature:** scoped tied-house check passes, but strict check still fails across legacy routes/fields; finish the adapter/sunset plan.

## P2 design and hardening backlog

- Introduce consistent planner page gutters and max widths.
- Raise primary and quick-action touch targets to at least 44×44px where practical.
- Replace mandatory nested homepage snap with an accessible progressive-scroll behavior or make snap optional and focus-visible.
- Remove decorative interactive controls that have no action.
- Add dialog semantics, Escape, focus trap/return, and scroll lock to overlays.
- Add programmatic labels, autocomplete, `aria-invalid`, `aria-describedby`, touched/submit-gated errors, and focusable error summaries to signup.
- Add tab and keyboard-resize semantics to planner navigation.
- Replace dark-theme color remnants with semantic warm-editorial tokens that pass WCAG AA.
- Update Bay Area onboarding examples that still reference Brooklyn/NY/NYC.
- Update technical docs: the runtime is Next.js 15.5.18, not Next.js 14 as older project notes state.
- Add performance budgets: shared first-load JS is 181kB; venue detail is about 290kB first load and venue listing about 295kB.
- Upgrade the seven low/moderate production dependency advisories through reviewed package updates rather than `npm audit fix --force`.

## Verification evidence

| Check | Result | Interpretation |
|---|---|---|
| Fresh `origin/main` | `461e3da` | Clean mainline audit baseline. |
| Vercel production deployment | `READY`, same `461e3da` | Production code matches audited commit. |
| Production `/api/health` | `200`, `{"status":"ok"}` | Shallow process health only. |
| Production env-name audit | 65 entries; core Redis/worker/provider names present | Presence only; value validity/provider behavior not proven. |
| Production runtime errors | 78 discovery change-log constraint failures | Active operational defect on latest production. |
| `npm run type-check` | Pass | TypeScript compiles; does not expose hidden schema casts. |
| `npm run lint` | Pass with 16 hook-dependency warnings | Several planner/data effects remain risky. |
| `npm run build` | Pass | Production build completed; compilation took about 3.8 minutes before page generation. |
| Full Jest | 242 suites passed, 2 skipped; 1,337 tests passed, 11 skipped | Strong isolated coverage; journey gaps are not represented by one E2E state machine. |
| Focused execution suites | 12 suites, 74 tests passed | Payment/approval primitives work in isolation. |
| `npm run db:audit` | Pass | Checks only a narrow canonical/legacy column list. |
| `npm run security:rls` | Pass | Confirms RLS flag only; misses zero-policy tables and policy behavior. |
| DB-backed RLS suite | 9/9 pass | Useful coverage for selected domains, not the full schema. |
| `supabase db lint` | Fail: 6 function errors | Stop-ship. |
| Scoped tied-house check | Pass | Scoped CHI/outreach targets comply. |
| Strict tied-house check | Fail | Legacy nomenclature remains broadly. |
| `npm audit --omit=dev` | 7 vulnerabilities: 2 low, 5 moderate | Package hardening needed; no high/critical result. |
| Outreach eval | Pass in fixture mode | Harness/fixtures pass; not live-provider autonomy proof. |
| Intake eval | Default command could not see `OPENAI_API_KEY` | Not rerun with injected credentials to avoid additional provider calls; live browser intake was observed separately. |
| Load harness | None found | 5k capacity is unproven. |

### Audit-side-effect disclosure

The first local production build inherited an existing Sentry auth token from `.env.local` and uploaded source-map artifacts for the already-existing `461e3da` release before it was stopped. The build was rerun successfully with Sentry upload credentials explicitly disabled. No code, database data, deployment, or user-facing state changed, but the source-map upload was an unintended external diagnostic side effect and is disclosed here.

## Recommended build order

### Phase 0 — hosted trust boundary and release parity

1. Revoke default/broad function and view privileges.
2. Repair all six database-lint errors.
3. Make execution/admin/audit rows service-owned.
4. Add full hosted ACL/RLS/RPC negative tests.
5. Apply/verify the missing hosted migration.
6. Stop the discovery change-log constraint error and alert on recurrence.

### Phase 1 — canonical execution aggregate

1. Establish canonical plan/event identity and taxonomy/time mapping.
2. Define a command/state machine for all three execution modes.
3. Separate editing, approval, execution attempt, external confirmation, and operator completion.
4. Make commands atomic, idempotent, retryable, and auditable.
5. Join booking/payment to the exact event/plan/action/approval.
6. Coordinate these interfaces with the separate accidental-purchase prevention work.

### Phase 2 — financial and product truth

1. Standardize cents and percent units.
2. Fix venue request/rules/deposit behavior.
3. Align billing-consumption rules and copy.
4. Replace “Sent”/“queued” claims with evidence-based states.
5. Complete post-event outcome, analytics, template, and rebook transitions.

### Phase 3 — usability and operating scale

1. Mobile functional parity and shared route manifest.
2. Server pagination, true totals/facets, and independent error states.
3. Admin SLA/queue accuracy and worker lease recovery.
4. Settings/onboarding field maintenance.
5. Privacy retention/deletion completion.
6. Shared spacing, accessibility, contrast, and interaction semantics.

### Phase 4 — staged capacity proof

1. Define the 5k workload model and SLOs.
2. Build load, webhook-burst, provider-failure, and worker-crash tests.
3. Run hosted query/index/connection analysis at representative data volume.
4. Pilot with a small recurring-host cohort and explicit manual escalation.
5. Expand only after error, latency, queue-depth, and outcome-integrity gates remain green.

## Definition of ready for a 5k-user rollout

Do not call the product ready until all of the following are evidenced:

- [ ] Hosted release commit and migration ledger match.
- [ ] Zero unintended anon/auth function or financial-view access.
- [ ] Zero reachable RLS tables without intentional policies.
- [ ] Database lint passes after clean reset and against hosted schema.
- [ ] Generated types have zero unexplained table/column drift.
- [ ] One canonical plan/event identity reaches booking/payment/outcome.
- [ ] Controlled payment, external checkout, and concierge each pass full E2E flows.
- [ ] Approval editing never authorizes and all terms round-trip exactly.
- [ ] Failed execution is recoverable without duplicate irreversible effects.
- [ ] Every money and percentage field passes unit-boundary tests.
- [ ] Mobile and desktop expose the same essential objects/actions.
- [ ] Catalogs, Experiences, approvals, templates, and admin queues paginate with true totals.
- [ ] Privacy deletion and retention cover the complete PII graph.
- [ ] Stale jobs recover; terminal/audit/webhook data has a measured retention policy.
- [ ] Production discovery/cron/runtime error alerts are green.
- [ ] Load tests at 2× expected peak satisfy agreed SLOs.
- [ ] A controlled pilot completes real events from plan through outcome without manual database repair.

## Final product recommendation

The right thing to build is still the stated product: an approval-gated event operating system for recurring hosts, not a marketplace. The immediate work should not be more surface area. It should be **one trustworthy operating spine**:

`plan → exact event → proposed action → approved snapshot → execution attempt → confirmed outcome → learned template`

Once that spine is authoritative, the existing planner, outreach, payments, ticketing, analytics, and editorial UI become valuable parts of one product rather than adjacent systems that can disagree. That is the shortest path from the current promising pilot to a system that can responsibly serve more than 5,000 users.
