# 3rdPlace 5k-readiness Prompt 6 handoff — resumed and completed

This file began as the usage-limit pause handoff after Prompt 5. Prompt 6 has
now been resumed, integrated, and verified. Prompt 7 was subsequently completed;
Prompt 8 and later remain unstarted and out of scope for this run.

## Prompt 6 completion state

- Integration worktree: `/private/tmp/3rdplace-5k-readiness-integration`
- Branch: `codex/5k-readiness-integration`
- Prompt 6 integration commits:
  - `94219d1` — immutable approval versions, V2 snapshots, retry coordination,
    durable Gmail dispatch identity, and shared truthful UI state
  - `1386175` — edit-versus-authorize UI, exact-cent confirmation, truthful
    Payments/mobile states, and canonical approval-card navigation
  - `c4fb65e` — server commands, exact persisted hashes, retry route, and
    one-send Gmail reconciliation
- The dirty canonical checkout was not modified.

Prompt 6 verification on the combined integration branch:

- Clean local Supabase reset applied every migration through
  `20260709140000_add_approval_version_retry_contract.sql`.
- Realized approval version/retry contract: 7/7 passed, including concurrent
  superseding, hash-conflict rollback, exact 9,550-cent persistence, reciprocal
  action/message repointing, aggregate deletion, ACL checks, retry concurrency,
  prior-success replay, and fresh-key recovery after a failed attempt.
- Combined Prompt 6 + realized control-plane gate: 220 tests passed.
- Full integrated Jest suite: 259 suites / 1,446 tests passed; 7 suites / 213
  tests skipped; 5 snapshots passed.
- TypeScript passed.
- Lint passed with the existing React hook warnings only.
- No hosted database, deployment, GitHub configuration, Stripe webhook, or
  production state was changed.

## Stable integration branch

- Worktree: `/private/tmp/3rdplace-5k-readiness-integration`
- Branch: `codex/5k-readiness-integration`
- Prompt 7 code integration point: `3574f50`
- Baseline: `origin/main` at `461e3da4e569a41d27c6e972fc467ef3ba042d17`
- Canonical checkout remains dirty and was not modified by this program.

Prompts 1–5 are implemented locally. Prompt 5 is integrated as:

- `6817724` — database/RLS/constraint control-plane lockdown
- `d0fe38a` — session-read/service-write caller conversion

Prompt 5 integration verification completed before the pause:

- TypeScript passed.
- Focused approval/deposit/Gmail/revision/date-change tests: 30 passed.
- Realized RLS/privilege/control-plane tests: 177 passed.
- The source caller branch had already passed the full Jest suite: 253 suites,
  1,383 tests, with 5 suites/138 tests skipped.

No hosted database, deployment, GitHub configuration, Stripe webhook, or
production state was changed.

## Historical pause snapshot — resolved

The sections below preserve the exact unfinished state at the original pause.
Every listed item was subsequently completed and verified as recorded above.

### Schema and shared-state lane

- Worktree: `/private/tmp/3rdplace-p0-approval-version-schema`
- Branch: `codex/p0-approval-version-schema`
- Base: `6817724`
- Owner files currently modified/untracked:
  - `supabase/migrations/20260709140000_add_approval_version_retry_contract.sql`
  - `lib/planner/execution/reapproval.ts`
  - `lib/planner/approvalUiState.ts`
  - `lib/planner/dbSelects.ts`
  - `lib/types/planner.ts`
  - `lib/types/database-generated.ts`
  - snapshot/UI-state/static migration tests

Implemented direction: immutable new-row approval versions; full v2 snapshot;
service-only atomic supersede RPC; narrow retry claim/finalize RPCs; durable
Gmail dispatch columns; shared truthful UI state.

Review corrections already applied in the migration:

- self-FKs use deferred `NO ACTION`, not `RESTRICT`;
- approval message metadata is repointed in the supersede transaction;
- `legacy-missing` can safely upgrade a null legacy snapshot through the
  service-only supersede path;
- an already-complete action returns prior success even if the approval later
  expired.

Still required before this lane is complete:

- add realized transactional DB tests, not only static SQL-text assertions;
- prove supersede lineage, exact 9,550-cent round trip, message/action repoint,
  mismatch rollback, browser RPC denial, retry concurrency/idempotency,
  aggregate plan deletion, and dispatch uniqueness;
- clean reset, DB lint, typecheck, lint, and commit.

### Backend/executor/Gmail lane

- Worktree: `/private/tmp/3rdplace-p0-approval-backend`
- Branch: `codex/p0-approval-backend`
- Base: `d0fe38a`
- Current scope: approvals command route, retry route, all approval-creation
  V2 snapshots, attention queue, Gmail deterministic Message-ID/reconciliation.

Known review corrections that must be completed before testing/commit:

1. Every approval creation path must hash the exact persisted fields. Current
   in-progress diffs still have mismatches where `expires_at`, `action_label`,
   delivery email, or requested amount are added after the snapshot is built.
   Recomputed v2 hash from the persisted approval/action must equal stored hash.
2. Request-reapproval/edit must create a fresh future expiry; never inherit an
   already-expired timestamp.
3. Legacy v1/null snapshots need a safe request-reapproval upgrade path;
   authorization itself remains v2-only and exact-hash-only.
4. Retry POST must parse and validate body `expectedSnapshotHash` against both
   stored and freshly computed hashes.
5. Same-key in-progress retry must be safely resumable/reconcilable; provider
   success followed by finalize failure must not be converted into a failed
   side effect or remain permanently stuck.
6. Claim conflicts should map to 409; in-progress behavior should be explicit.
7. Widen the owner-scoped attention read model beyond only `pending` so failed,
   expired, and reapproval-required rows reach Payments/mobile truthfully.
8. Add route/Gmail tests: edit never authorizes; 9,550 cents survives edit →
   authorize → execute; mismatch 409; failure → retry → success; duplicate and
   concurrent retries yield one provider side effect; partial multi-recipient
   Gmail retry skips already-sent recipients; persisted v2 hash recomputes for
   every creation path.

### UI lane

- Worktree: `/private/tmp/3rdplace-p0-approval-ui`
- Branch: `codex/p0-approval-ui`
- Base: `6817724`
- Current scope: shared presentation, Planner approval card, Workspace ID
  replacement, live-plan handoff, Payments, mobile, focused component tests.

Implemented direction includes exact `$95.50` formatting, Save-as-edit only,
separate confirmation, truthful lifecycle labels, retry action, new approval ID
replacement, and removal of hashless authorization from the live-plan panel.

Still required before this lane is complete:

- apply structured non-2xx backend view models (notably execution-failed 502)
  before showing the error;
- retry body must carry `expectedSnapshotHash`;
- rotate the idempotency key after a known terminal retry failure while keeping
  it stable for transport ambiguity;
- finish/fix mobile attention-state filtering and run typecheck;
- run component tests, lint, and commit only after importing the final shared
  schema helper contract.

## Historical resume order — completed

1. Resume the three interrupted agents/worktrees above; do not recreate them.
2. Finish schema lane and realized DB tests; commit it.
3. Cherry-pick the schema commit into backend and UI worktrees, resolve imports,
   then finish their tests and commits.
4. Cherry-pick schema, backend, and UI commits into
   `codex/5k-readiness-integration` in that order.
5. Run clean Supabase reset, DB lint, all realized security/function suites,
   Prompt 6 route/component/Gmail tests, typecheck, lint, full Jest, and build.
6. Update `qa-artifacts/5k-readiness-execution-log-2026-07-09.md`.

The user explicitly resumed Prompt 7 after Prompt 6 completed.

## Locked future decision

Prompt 15 remains pre-decided as Option B: consume one event credit only at
canonical event materialization/booking, not at first approval. It has not been
implemented. Prompt 7 is complete; Prompts 8–18 remain unstarted in this program.
