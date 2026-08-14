# 3rdPlace 5k-readiness execution log

> **Historical receipt — release topology superseded 2026-07-11.** The
> implementation evidence below remains valid for its recorded checkpoint, but
> any future-release statement describing PR #204 as a `20260709110000+`
> migration bundle is obsolete. The current contract is recorded in
> `qa-artifacts/pre-phase2-stack-stabilization-prompt-set-2026-07-11.md`: PR
> #205 owns `20260709100000` and `20260709110000`; PR #204 owns exactly 22
> migrations beginning at `20260709114000`.

Baseline: `origin/main` at `461e3da4e569a41d27c6e972fc467ef3ba042d17`.

Source specification:
`qa-artifacts/product-database-function-design-scale-audit-2026-07-09.md`
and the attached 18-prompt wave plan.

## Locked decisions and boundaries

- Prompt 15 uses option B: one event credit is consumed at canonical event
  materialization/booking, not at first approval.
- Hosted database mutations, production deploys, GitHub secret creation, and
  staging load generation require explicit operator execution or authorization.
- The separate `codex/payment-capture-race-hardening` branch owns Stripe capture
  reservation changes. This program must preserve its interfaces and does not
  modify the webhook reservation logic.
- That work is draft PR #203 at `8488a5a`: open, mergeable, and green, with a
  successful Vercel preview. It is not yet in `origin/main`.
- All implementation work is isolated from the dirty canonical checkout.

## Prompt ledger

| Prompt | Scope | Status | Evidence |
|---|---|---|---|
| 1 | Release parity + discovery cron | Implemented locally | Commits `a298a8d`, `aabfe77`, `cd63dce`; hosted migration apply and GitHub secret provisioning remain operator-owned |
| 2 | Six stored functions + lint gate | Implemented locally | Commits `be09d7f`, `78d2826`; clean reset, DB lint, and 22/22 realized function tests passed |
| 3 | Money and percent units | Implemented locally | Commits `670025b`, `c7b2251`; exact-cent UI round trips and 5/5 atomic repair DB tests passed |
| 4 | Database privilege lockdown | Implemented locally | Commit `d93f1e6`; 36 definer functions classified, exact ACLs enforced, and 100/100 realized privilege tests passed |
| 5 | Server-owned trusted execution state | Implemented locally | Commits `6817724`, `d0fe38a`; realized RLS/privilege/control-plane gate passed |
| 6 | Separate editing, authorization, and retry | Implemented locally | Commits `94219d1`, `1386175`, `c4fb65e`; combined 220-test gate and full 1,446-test Jest suite passed |
| 7 | Canonical plan to event identity | Implemented locally | Commits `bdfd345`, `924ac53`, `94ee189`, `b8a03db`, `b75ee19`, `9fcfce9`, `3574f50`; clean reset, realized lifecycle/provenance/compatibility gates passed; Prompt 8 is not started |
| 8 | Three execution modes | Implemented and locally verified | Mode commits through `74ec9b5`; clean reset, realized lifecycle, focused/security, full Jest, lint, type-check, and optimized build gates passed |
| 9–18 | Later dependency waves | Pending | Prompt 9 has not started |

## Prompt 1 verification

- Discovery and migration-parity unit tests: 7 passed.
- Discovery-focused suites: 11 passed.
- Full Jest suite: 1,344 passed, 11 skipped.
- TypeScript: passed.
- Lint: passed with the pre-existing hook warnings.
- Local realized migration parity after Wave 1 integration: 132 expected / 132 applied.
- Post-apply verification SQL passed against the local realized database.
- A transaction using `discovery_change_log.source = 'places_refresh'` passed
  the realized CHECK constraint and was rolled back.
- Vercel was rechecked read-only: production remains on `461e3da`; the cron
  error group still has 78 occurrences and was last seen July 9.

## External release gates

Prompt 1 intentionally does not claim the production incident is closed until:

1. GitHub Actions has `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and
   `SUPABASE_DB_PASSWORD` secrets. Only `CRON_SECRET` was present when checked.
2. An operator runs the dry-run/apply/post-verify sequence in
   `docs/runbooks/20260701090000-plan-supply-intents-release.md`.
3. Corrected application code is deployed and the production refresh cron has
   zero constraint errors.
4. The Sentry issue alert for `discovery_change_log_constraint` is test-paged.

## Prompt 4 verification

- All 36 realized `SECURITY DEFINER` functions are classified: 25 are
  service-only, 11 are authenticated and ownership-scoped, and none are
  anonymous.
- Future default privileges are fail-closed for functions, tables, and
  sequences; three financial views have explicit reader boundaries.
- Realized privilege tests: 100 passed.
- Combined database security tests on the isolated Prompt 4 branch: 109
  passed; RLS suite: 157 passed.
- TypeScript, lint, database audit, hosted-ACL verifier, and the full Jest suite
  passed on the isolated branch. No hosted database was mutated.
- The current local Supabase image crashes when a superuser directly invokes a
  revoked definer function after `SET ROLE`. Tests therefore combine catalog
  privilege assertions for every function with real PostgREST 401/403 checks
  for callable service RPCs.

## Prompt 2 review correction

The initial repaired `consume_builder_event_access` function correctly uses a
planner `plans.id` identity, but the legacy `POST /api/builder/events` route
previously inserted an `events` row and passed that unrelated ID into the
function. The integrated correction adds a service-only, `SECURITY INVOKER`
materialization RPC that atomically creates the minimal plan, legacy event, and
one access consumption. A stable user-intent idempotency key returns the same
materialization on retry; billing failure rolls back every row and counter.
This is the compatibility bridge for Prompt 7 and Prompt 15 option B, not a
substitute for their canonical identity work.

## Prompt 3 review correction

- Newly confirmed venue nightly rates are authoritative. Exact historical
  hourly/daily duplicates from the old triple-write are cleared; differing
  legacy rates are preserved rather than guessed away.
- Event-planning economics now emits and compares margins in percentage points
  end to end.
- Vendor base-rate repair uses a service-only, `SECURITY INVOKER` transaction;
  a failed audit insert rolls back the rate update.
- `$95.50` pricing/service form boundaries round-trip as `9550` cents, and the
  per-head incentive field accepts cent precision.
- `vendor_packages.price` and `vendor_offerings.base_price` are explicitly
  documented legacy dollar-major-unit exceptions with conversion adapters.

## Combined Wave 1 verification

- Clean local migration reset realized all 132 repository migrations through
  `20260709120000` (the Supabase CLI returned its known final-restart 502 after
  applying and seeding; the database/API remained healthy and the ledger was
  verified directly).
- `supabase db lint --fail-on error`: passed with three pre-existing warnings
  and no errors.
- Combined realized database/security/route set: 141 tests passed across stored
  functions, RLS, privilege ACLs, atomic vendor repair, and event
  materialization.
- Migration parity, post-apply supply-intent verification, hosted-ACL verifier,
  schema audit, and all-table RLS-enabled check passed locally.
- TypeScript and lint passed; lint reports the same 16 pre-existing React hook
  warnings.
- Full Jest suite passed on the integrated branch.

### Final cross-prompt review correction

The final privilege/caller review found that discovery invalidation passed the
vendor or admin actor ID as the plan-owner identity to
`apply_plan_revision_atomic`. The hardened RPC correctly rejected that mismatch,
so vendor/admin discovery changes could leave plan revisions stale while the
error was only logged. The caller now always uses the actual plan owner for RPC
authorization and preserves the real vendor/admin actor and source inside the
revision trigger audit payload. A regression test covers actor != owner.

The same review found the live atomic vendor-repair suite was opt-in locally but
not enabled in CI. `RLS Checks / rls` now runs it with
`RUN_VENDOR_RATE_DB_TESTS=1`, so update-plus-audit rollback and RPC ACL behavior
cannot silently skip in pull requests, merge queues, or pushes to `main`.

Atomic materialization also made the legacy event PATCH/DELETE surfaces unsafe:
PATCH changed only `events`, while DELETE collided with the bridge FKs and had
no aggregate cancellation policy. Bridged rows now fail closed with 409 until
Prompt 7 owns a single plan/event revision and cancellation transition. This
prevents plan drift and prevents a superficial event cancellation from leaving
bookings, approvals, outreach, payments, or admin tasks executable.

Option B is not complete at this wave. The legacy venue-booking route and direct
vendor-booking hook still bypass canonical plan identity, approval, access
consumption, and command idempotency. Prompt 10 must remove the venue path and
Prompt 15 must include every remaining booking/import entry point before the
billing policy can be called enforceable.

## Prompt 5 verification

- Browser/session roles are read-only on trusted execution, approval, audit,
  outreach, and financial command state; reviewed server routes use
  owner-scoped session reads followed by service-owned writes.
- Composite action/approval/plan and financial identity constraints reject
  cross-plan state, executable approvals require actor/timestamp/snapshot, and
  contradictory historical rows fail the migration preflight rather than being
  silently rewritten.
- Prompt 5 focused approval/deposit/Gmail/revision/date-change tests: 30 passed.
- Realized RLS/privilege/control-plane tests: 177 passed.
- TypeScript and the source caller branch full Jest suite passed.

## Prompt 6 verification

- Edits create immutable superseding approval rows and leave the new row
  pending. The action and approval-card cache point to the new row atomically;
  edit never authorizes.
- V2 authorization snapshots contain the exact persisted action label,
  counterparty, email, event date, notes, expiry, payload, and integer cents.
  The `$95.50` path persists `9550` through edit, explicit confirmation,
  authorization, and execution.
- Every rendered approval state is derived from one shared mapping. Expired,
  failed, reapproval-required, executing, succeeded, rejected, cancelled, and
  superseded states no longer masquerade as pending.
- Failed Gmail execution has an explicit idempotent retry command. A durable
  per-recipient key and deterministic RFC Message-ID reserve before provider
  send; partial retries skip sent recipients and ambiguous sends reconcile
  before any second provider call.
- Provider success followed by local finalization ambiguity remains HTTP 202
  and keeps the same retry key. It is never rewritten as a failed side effect.
  Terminal known failures rotate to a fresh key; completed actions replay prior
  success even if the approval later expires.
- Clean local migration reset passed through
  `20260709140000_add_approval_version_retry_contract.sql`.
- Realized version/retry database tests: 7 passed.
- Combined Prompt 6 route/component/Gmail/control-plane tests: 220 passed.
- TypeScript and lint passed; lint retained only the existing hook warnings.
- Full integrated Jest: 259 suites / 1,446 tests passed, 7 suites / 213 tests
  skipped, 5 snapshots passed.
- No hosted or production state changed.

## Prompt 7 verification

- `events.plan_id` and `plans.materialized_event_id` now define one deferred,
  reciprocal, owner-consistent canonical identity. Legacy and imported events
  remain null-linked; no probabilistic backfill is attempted.
- All 19 planner archetypes persist losslessly. Exact event schedules store UTC
  instants plus IANA timezone intent, reject incomplete date windows and DST
  gaps/folds, support overnight/non-Los-Angeles events, and serialize concurrent
  materialization retries onto one event.
- The audited lifecycle is centralized as `drafting -> ready -> approved ->
  executing -> booked -> completed -> archived`. Exact compare-and-swap context,
  executable approval, reciprocal event, owner-matched booking, ended-event
  outcome, and explicit archive evidence gate the corresponding transitions.
- Canonical plan/event facts, committed partner identity, quoted price, and terms
  fail closed against direct browser or service drift. Existing lineage and
  outcome commands use narrow scoped contexts; future changes require a
  coordinated reapproval command.
- Template source pointers are commit-time constrained to the same owned,
  completed canonical event with outcome evidence. Noncanonical, incomplete,
  cross-owner, and one-sided provenance are rejected.
- Clean local Supabase resets applied every migration through
  `20260709150000_add_canonical_plan_event_identity.sql`.
- Canonical static/realized contract: 19 tests passed. Legacy materialization and
  booking compatibility: 23 realized stored-function tests passed. Prompt 6
  approval-version plus privilege/RLS/execution regressions: 184 tests passed.
- Database lint passed with the three pre-existing warnings and no errors;
  canonical schema audit and all-table RLS checks passed.
- The Prompt 7 schema lane pre-commit gate passed TypeScript, lint, and its full
  Jest suite: 256 suites / 1,413 tests passed; 8 suites / 225 tests skipped; 5
  snapshots passed.
- The generated Supabase database types were refreshed from the fully realized
  local schema instead of adding more stale-type escapes.
- Post-approval/materialization partner-quote guard: 32 route tests passed. All
  POST/DELETE variants return 409 `PLAN_REAPPROVAL_REQUIRED` before any write for
  materialized or approved-and-later plans; unmaterialized `drafting`/`ready`
  plans remain editable.
- Final opt-in database/security gate: 9 suites / 241 tests passed after a clean
  integration reset.
- Final integrated non-opt-in Jest gate: 272 suites / 1,557 tests passed; 8
  suites / 225 tests skipped; 5 snapshots passed.
- TypeScript passed. Lint passed with the same 16 pre-existing React hook
  warnings. The optimized production build passed with local Supabase build
  variables after the expected variable-free attempt stopped at the repository's
  existing environment guard.
- No hosted Supabase, Vercel, GitHub, Stripe, webhook, or production state was
  changed. Prompt 8 and the separate duplicate-purchase work were not touched.

## Prompt 8 verification

- Integrated mode commits now cover canonical event outcomes, analytics and
  template eligibility, external checkout handoff/host confirmation, controlled
  payment proposal creation, post-approval concierge tasks and vendor drafts,
  operator completion/cancellation, and trusted quote-to-booking execution.
- Commit `74ec9b5` adds centralized cross-mode retryability, authenticated and
  race-safe execution cancellation, current-evidence precedence,
  compare-and-swap status writes, desktop/mobile controls, canonical mobile
  completion, generated database types, and the realized three-mode lifecycle
  suite.
- Opportunity preparation is deliberately not offered a generic retry because
  its multi-write steps do not yet have durable per-step identities. This avoids
  advertising an unsafe command that could duplicate preparation work.
- A clean local reset applied all migrations through `20260709165000`; generated
  types were refreshed from the realized schema. Database lint passed with no
  errors and only the three established older warnings.
- The opt-in realized lifecycle suite passed 1 suite / 5 tests. The focused
  Prompt 8 matrix passed 20 suites / 201 tests, with that opt-in suite run
  separately. The final database security/canonical/approval gate passed 5
  suites / 195 tests.
- Full Jest passed 285 suites / 1,667 tests; 9 suites / 230 tests skipped; 5
  snapshots passed. TypeScript passed. Lint passed with the same 16 existing
  React hook warnings and none in the Prompt 8 changes.
- The optimized production build passed using the local Supabase environment
  with Sentry upload credentials unset. No external service was mutated.
- Controlled-payment provider execution is intentionally deferred to Prompt 9.
- Prompt 8 has no remaining local exit gate. Exact scope and handoff evidence
  are in
  `qa-artifacts/5k-readiness-prompt8-handoff-2026-07-09.md`.
- No hosted or production state changed.

## 2026-07-10 Prompt 7/8 verification correction

This section supersedes only the earlier Prompt 7 and Prompt 8 completion
verdicts. It does not erase the July 9 commits or their test evidence; those
results describe the checkpoint that was audited.

| Prompt | Corrected branch status | Release status |
|---|---|---|
| 7 | The prior identity/lifecycle implementation required further enforcement at booking provenance, claimed-partner binding, canonical term immutability, authoritative event reads, analytics deep links, rebook state, and template eligibility. The corrected candidate passed the clean local gate. | **LOCALLY_VERIFIED**; not in `origin/main` |
| 8 | The prior execution-mode implementation required atomic confirm/decline/bulk/external commands, authoritative partner-claim binding, unknown-price fail-closed behavior, terminal/multi-partner boundaries, authorization/materialization recovery, replay-safe confirmation effects, unresolved-partner task durability, and strict quote re-approval predicates. The corrected candidate passed the clean local gate. | **LOCALLY_VERIFIED**; not in `origin/main` |

The detailed gap matrix and corrected contract are in
`qa-artifacts/5k-readiness-prompts7-8-verification-2026-07-10.md`. Prompt 9 owns
controlled-payment provider execution; Prompt 8 does not call Stripe or move
money.

Final verification receipt (root fills from the final tree):

- Final release commit: **PENDING_ROOT_FINAL_GATE**
- Clean reset / generated types / database lint: **PASS** through migration
  `20260709178000`; zero lint errors and three established warnings
- Realized stored-function, RLS, privilege, canonical identity, Prompt 7,
  Prompt 8, terminal, vendor-claim, re-approval, and decline suites: **PASS**,
  12 suites / 297 tests
- Focused route/component/schema matrix: **PASS**
- Full Jest / lint / type-check / optimized build / browser smoke:
  **PASS**; Jest 301 suites / 1,845 tests, Chromium 26 passed and six
  credential-dependent checks skipped by contract
- Ready PR / GitHub checks / Vercel preview: **PENDING_ROOT_FINAL_GATE**
- Hosted migration apply / merge: **BLOCKED_PENDING_OPERATOR_SEQUENCE**

Release truth observed on 2026-07-10:

- `origin/main` remains `461e3da`; none of the Prompt 1–8 branch commits are on
  main.
- The hosted Supabase ledger was observed only through `20260627000000`, even
  though deployed application behavior already expects the Prompt 1 incident
  migration `20260701090000`.
- Draft PR #203 on `codex/payment-capture-race-hardening` owns the earlier
  `20260709090000_add_payment_intents_capturing_status.sql` migration. It must be
  released first or intentionally renumbered and reverified by its owner before
  this branch's `20260709110000+` migration bundle is applied.
- Applying the schema first can revoke browser write paths still used by old
  code; merging code first can reference absent columns and RPCs. No hosted
  apply or merge should occur without the operator-controlled sequence in
  `docs/runbooks/20260710-prompts-1-8-release.md`.
