# 3rdPlace 5k-readiness execution log

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
| 5–18 | Later dependency waves | Pending | Start only after predecessor gates pass |

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
