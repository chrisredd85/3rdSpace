# 3rdPlace 5k-readiness pause handoff — after Prompt 5, during Prompt 6

Paused at the user's request because the current task was near its usage limit.
Do not start Prompt 7 or any later prompt when resuming; finish and verify Prompt 6 first.

## Stable integration branch

- Worktree: `/private/tmp/3rdplace-5k-readiness-integration`
- Branch: `codex/5k-readiness-integration`
- HEAD: `d0fe38a` (`fix(security): route trusted state through service writers`)
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

## Prompt 6 work in progress — not committed, not verified

All three agents were interrupted and their worktrees were intentionally left
unchanged. None of these branches is ready to cherry-pick yet.

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

## Resume order

1. Resume the three interrupted agents/worktrees above; do not recreate them.
2. Finish schema lane and realized DB tests; commit it.
3. Cherry-pick the schema commit into backend and UI worktrees, resolve imports,
   then finish their tests and commits.
4. Cherry-pick schema, backend, and UI commits into
   `codex/5k-readiness-integration` in that order.
5. Run clean Supabase reset, DB lint, all realized security/function suites,
   Prompt 6 route/component/Gmail tests, typecheck, lint, full Jest, and build.
6. Update `qa-artifacts/5k-readiness-execution-log-2026-07-09.md` and stop.
   Do not start Prompt 7 until the user explicitly resumes.

## Locked future decision

Prompt 15 remains pre-decided as Option B: consume one event credit only at
canonical event materialization/booking, not at first approval. It has not been
implemented. Prompts 7–18 remain unstarted in this program.
