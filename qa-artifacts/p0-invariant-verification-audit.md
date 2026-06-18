# P0 Invariant Verification Audit

Audit branch: `codex/p0-invariant-verification-audit`

Base inspected: `origin/main` at `3764f9a fix(finance): include venue consumption incentive in event profit (#99)`

P0 source PR inspected: PR #85, merged as `85af572da346ae8ccb90e6e6074ba4f9d9a86316`.

Audit date: 2026-06-18

Scope: audit only. No production behavior, schema, route, component, or test logic was changed.

## Summary

| Area | Invariant | Verdict | Notes |
| --- | --- | --- | --- |
| P0-A | Exactly one concurrent approval transition may win and trigger side effects. | CLOSED | The PATCH route uses a status-qualified optimistic update before billing consumption or execution. Targeted test proves one 200 and one `approval_stale` 409. |
| P0-B | Concurrent deposit authorization for one approval must produce one active DB row and one effective Stripe authorization. | PARTIAL | Same-approval/same-amount race is closed by partial unique index plus Stripe idempotency. Different-amount races can still create a Stripe PaymentIntent before DB insert fails or amount guard throws. |
| P0-C | Captured deposits that miss payout insertion must be automatically healed. | PARTIAL | Reconciler route and Vercel cron exist and targeted tests pass. Reconciler insertion is not itself idempotent under concurrent route executions because `payouts.payment_intent_id` is indexed but not unique. |
| P0-D | Builder event access consumption must be once per event and must not overconsume final free/paid credits under concurrent requests. | OPEN | Current main only guards same builder + same event. It does not atomically arbitrate different event IDs competing for one remaining free event or paid credit. Draft PR #101 contains the needed RPC-style fix and tests. |

## Verification Standards

For this audit, a P0 fix is considered `CLOSED` only when all of these are true:

1. The implementation has a database-backed or route-level concurrency primitive that serializes the contested state, not only an in-memory check.
2. Side effects happen only after the contested state transition is won.
3. Losing concurrent requests return a deterministic safe response and do not perform side effects.
4. Tests exercise the actual invariant under concurrent or duplicate invocation, not merely sequential idempotency.
5. The structural reasoning still holds if two Vercel function instances execute the code at the same time.

`PARTIAL` means the shipped fix closes the exact happy-path or same-input race tested in PR #85, but leaves a credible adjacent race or orphan side effect.

`OPEN` means the invariant can still be violated on current `origin/main`.

## Sources Inspected

- `AGENTS.md` product/engineering constraints, including approval invariant and no auto-execution.
- `app/api/planner/plans/[planId]/approvals/route.ts:184-292` PATCH handler.
- `app/api/planner/plans/[planId]/approvals/route.ts:491-542` best-effort rollback after access-gate failure.
- `lib/planner/depositPayments.ts:52-112` deposit authorization.
- `lib/planner/depositPayments.ts:215-243` active-intent lookup and different-amount guard.
- `lib/planner/depositPayments.ts:264-300` Stripe PaymentIntent creation and idempotency key.
- `supabase/migrations/20260617000000_add_p0_concurrency_guards.sql:9-14` active payment intent partial unique index.
- `app/api/admin/reconcile/captured-deposits/route.ts:43-95` capture reconciler route.
- `app/api/admin/reconcile/captured-deposits/route.ts:101-139` captured-without-payout query and payout insert.
- `vercel.json:2-10` scheduled capture reconciler cron.
- `supabase/migrations/20260504000016_add_planner_deposit_payments.sql:32-67` `payouts` table and non-unique `payment_intent_id` index.
- `lib/billing/builder-billing.ts:572-654` builder event access consumption.
- `supabase/migrations/20260617000000_add_p0_concurrency_guards.sql:16-68` builder event access consumption table and same-event unique index.
- `__tests__/integration/p0-concurrency.test.ts:340-381` approval race test.
- `__tests__/integration/vendor-payment-end-to-end.test.ts:587-610` vendor deposit authorization race test.
- `__tests__/integration/capture-reconciler.test.ts:160-243` reconciler auth and happy-path insert tests.
- `__tests__/billing/builder-billing-idempotent.test.ts:156-202` same-event billing idempotency tests.
- PR #101, draft: `https://github.com/chrisredd85/3rdSpace/pull/101`, branch `codex/two-free-events-idempotency-and-banner`, commit `2f6e4d6`.

## P0-A — Approval PATCH Race

### 1. Stated Invariant

For one approval row, two concurrent PATCH requests must not both win. Only one request may update the approval status, consume builder access, sync the agent action, prepare/send execution artifacts, or update approval message metadata. The losing request must return a deterministic stale conflict and do no side effects.

### 2. Surface Check

The route now loads the approval, validates the transition, checks staleness, then performs an optimistic update qualified by the approval's previous status:

- `app/api/planner/plans/[planId]/approvals/route.ts:203-229` loads and validates the current approval.
- `app/api/planner/plans/[planId]/approvals/route.ts:230-237` updates with `.eq('status', existingApproval.status)` and `.maybeSingle()`.
- `app/api/planner/plans/[planId]/approvals/route.ts:244-251` returns `409` with code `approval_stale` when the update returns no row.
- `app/api/planner/plans/[planId]/approvals/route.ts:255-267` calls `ensurePlannerProductAccess` only after the optimistic update succeeds.
- `app/api/planner/plans/[planId]/approvals/route.ts:269-286` syncs action state, executes approved action, and syncs message metadata only after winning.

Rollback for the post-update billing-access edge exists:

- `app/api/planner/plans/[planId]/approvals/route.ts:255-264` invokes rollback if `ensurePlannerProductAccess` fails.
- `app/api/planner/plans/[planId]/approvals/route.ts:491-542` attempts status rollback and Sentry logs `approval_rollback_failed` if the rollback predicate misses.

### 3. Behavioral Evidence

Targeted command:

```bash
npm test -- __tests__/integration/p0-concurrency.test.ts -t approval
```

Result: passed. Log: `qa-artifacts/p0-audit-p0a-approval-race.log`.

Relevant test snippet:

```ts
// __tests__/integration/p0-concurrency.test.ts:340-381
it('allows only one concurrent approval PATCH to win side effects', async () => {
  const db = seedDb()

  const [first, second] = await Promise.all([
    updateApproval(
      request(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }),
      { params: { planId: PLAN_ID } }
    ),
    updateApproval(
      request(`/api/planner/plans/${PLAN_ID}/approvals`, {
        approvalId: APPROVAL_ID,
        action: 'authorize',
      }),
      { params: { planId: PLAN_ID } }
    ),
  ])

  const statuses = [first.status, second.status].sort()
  const stale = first.status === 409 ? first : second
  const staleBody = await readJson(stale)

  expect(statuses).toEqual([200, 409])
  expect(staleBody).toEqual({
    error: 'Approval was updated by another request. Refresh and try again.',
    code: 'approval_stale',
  })
  expect(db.rows.approvals[0].status).toBe('authorized')
  expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
  expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
  expect(db.rows.venue_opportunity_briefs).toHaveLength(1)
  expect(db.rows.venue_opportunity_invites).toHaveLength(2)
  expect(db.rows.agent_actions[0].status).toBe('complete')
  expect(db.rows.agent_action_audit_log).toHaveLength(3)
})
```

### 4. Structural Correctness

Step-by-step under two concurrent requests:

1. Both requests may read the same original approval status.
2. Both compute the same transition.
3. The first request to reach the DB update changes the row from the original status to the target status.
4. The second request attempts the same update but includes `.eq('status', existingApproval.status)`, so it matches zero rows.
5. The second request returns the explicit `approval_stale` 409 before billing access or execution calls.
6. Only the winner calls `ensurePlannerProductAccess`, `syncAgentActionStatusForApproval`, `executeApprovedAction`, and `syncApprovalMessageMetadata`.

This holds across Vercel instances because the arbitration is in the Postgres update predicate, not in process-local memory.

### 5. Verdict

CLOSED.

### 6. Follow-up Recommendation

Add one focused test for the post-update billing failure rollback path. The core race invariant is closed, but the rollback path is load-bearing and currently verified structurally rather than behaviorally in the targeted P0 test file.

## P0-B — Payment Intent Unique Active Constraint

### 1. Stated Invariant

For one approval, concurrent deposit authorization requests must not create multiple active local `payment_intents` rows or multiple effective Stripe authorizations. If a duplicate insert loses the race, it should return the winner safely.

### 2. Surface Check

Implementation pieces:

- `supabase/migrations/20260617000000_add_p0_concurrency_guards.sql:9-14` creates partial unique index `payment_intents_one_active_per_approval` on `approval_id` where status is `requested`, `authorized`, or `captured`.
- `lib/planner/depositPayments.ts:69-70` loads an existing active intent before creating a new one.
- `lib/planner/depositPayments.ts:73-82` creates the Stripe PaymentIntent before the DB insert.
- `lib/planner/depositPayments.ts:86-102` inserts the local `payment_intents` row.
- `lib/planner/depositPayments.ts:104-110` catches unique violations, reloads the winner, and returns it.
- `lib/planner/depositPayments.ts:229-243` throws if the active winner was created in the last 60 seconds with a different amount.
- `lib/planner/depositPayments.ts:278-300` uses Stripe idempotency key `planner_deposit_${approval.id}_${amountCents}`.

### 3. Behavioral Evidence

Targeted command:

```bash
npm test -- __tests__/integration/vendor-payment-end-to-end.test.ts -t "authorization requests race"
```

Result: passed. Log: `qa-artifacts/p0-audit-p0b-deposit-race.log`.

Relevant test snippet:

```ts
// __tests__/integration/vendor-payment-end-to-end.test.ts:587-610
it('returns one active vendor payment intent when authorization requests race', async () => {
  const db = seedDb({ approvalStatus: 'authorized', actionStatus: 'approved' })

  const [first, second] = await Promise.all([
    authorizeVendorDeposit(),
    authorizeVendorDeposit(),
  ])
  const firstBody = await readJson(first)
  const secondBody = await readJson(second)

  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect(db.rows.payment_intents).toHaveLength(1)
  expect(firstBody.paymentIntent.id).toBe(secondBody.paymentIntent.id)
  expect(firstBody.paymentIntent).toEqual(expect.objectContaining({
    partner_kind: 'vendor',
    amount_cents: AMOUNT_CENTS,
    status: 'authorized',
  }))
  expect(mockStripePaymentIntentsCreate.mock.calls.map((call) => call[1])).toEqual([
    { idempotencyKey: `planner_deposit_${APPROVAL_ID}_${AMOUNT_CENTS}` },
    { idempotencyKey: `planner_deposit_${APPROVAL_ID}_${AMOUNT_CENTS}` },
  ])
})
```

### 4. Structural Correctness

Same-approval, same-amount race:

1. Both requests can pass the initial `loadExistingActivePaymentIntent` check.
2. Both call Stripe with the same idempotency key because the key includes the same approval ID and amount.
3. Stripe should coalesce those requests into one effective PaymentIntent.
4. Both then attempt local insert.
5. The partial unique index allows only one active row.
6. The loser catches `23505`, reloads the winner, and returns it.

This closes the same-amount duplicate authorization path.

Different-amount race:

1. Two requests for the same approval but different amounts use different Stripe idempotency keys.
2. Both can create or attempt distinct Stripe PaymentIntents before either local insert wins.
3. The DB still allows only one active local row.
4. The loser catches the unique violation and then the 60-second different-amount guard throws.
5. That protects local state from silently returning a stale amount, but it does not prove the losing Stripe PaymentIntent is cancelled or never created.

### 5. Verdict

PARTIAL.

The same-input invariant is closed. The stronger money invariant, "no orphan Stripe authorization even under same approval + different amount race," is not fully closed because Stripe is called before the DB lock/unique-index insert.

### 6. Follow-up Recommendation

Move local reservation ahead of Stripe creation, or add an approval-scoped DB advisory lock/RPC that wins the amount before any Stripe API call. If keeping the current order, add explicit cancellation/release handling for a losing different-amount Stripe authorization and add a test for that path.

## P0-C — Captured Deposit Payout Reconciler

### 1. Stated Invariant

If explicit Stripe capture succeeds but the subsequent payout row insert fails or is skipped, the system must automatically discover the captured deposit with no payout and insert the missing payout later.

### 2. Surface Check

Capture is still split across separate side effects:

- `lib/planner/depositPayments.ts:117-162` captures Stripe, updates the local payment intent, then inserts a `payouts` row in separate statements.

The reconciler exists:

- `app/api/admin/reconcile/captured-deposits/route.ts:43-95` authorizes worker/admin callers and processes candidates.
- `app/api/admin/reconcile/captured-deposits/route.ts:101-119` loads `payment_intents` with status `captured` where no joined `payouts.id` exists.
- `app/api/admin/reconcile/captured-deposits/route.ts:122-139` inserts the missing payout.
- `vercel.json:7-10` schedules `/api/admin/reconcile/captured-deposits` daily at `15 14 * * *`.

Important structural gap:

- `supabase/migrations/20260504000016_add_planner_deposit_payments.sql:64-65` creates a plain index on `payouts(payment_intent_id)`, not a unique index.

### 3. Behavioral Evidence

Targeted command:

```bash
npm test -- __tests__/integration/capture-reconciler.test.ts
```

Result: passed. Log: `qa-artifacts/p0-audit-p0c-capture-reconciler.log`.

Relevant test snippet:

```ts
// __tests__/integration/capture-reconciler.test.ts:175-243
it('inserts a missing payout for captured planner deposits and logs Sentry evidence', async () => {
  mockGetWorkerOrAdminContext.mockResolvedValue({
    authorized: true,
    user: { id: 'admin-1', email: 'admin@example.com' },
  })
  const db = new MemoryDb()
  db.rows.payment_intents.push({
    id: 'payment-intent-1',
    plan_id: 'plan-1',
    partner_kind: 'venue',
    partner_id: 'venue-1',
    amount_cents: 25_000,
    platform_fee_cents: 1_000,
    currency: 'usd',
    status: 'captured',
    captured_at: new Date().toISOString(),
  }, {
    id: 'payment-intent-with-payout',
    plan_id: 'plan-2',
    partner_kind: 'venue',
    partner_id: 'venue-2',
    amount_cents: 50_000,
    platform_fee_cents: 0,
    currency: 'usd',
    status: 'captured',
    captured_at: new Date().toISOString(),
  })
  db.rows.payouts.push({
    id: 'existing-payout-1',
    payment_intent_id: 'payment-intent-with-payout',
    partner_kind: 'venue',
    partner_id: 'venue-2',
    amount_cents: 50_000,
    currency: 'usd',
    status: 'pending',
  })
  mockCreateServiceRoleClient.mockReturnValue(db)

  const response = await GET(request())
  const body = await readJson(response)

  expect(response.status).toBe(200)
  expect(body).toEqual({ reconciled: 1, errors: [] })
  expect(db.rows.payouts).toEqual([
    expect.objectContaining({
      payment_intent_id: 'payment-intent-with-payout',
    }),
    expect.objectContaining({
      payment_intent_id: 'payment-intent-1',
      partner_kind: 'venue',
      partner_id: 'venue-1',
      amount_cents: 24_000,
      currency: 'usd',
      status: 'pending',
    }),
  ])
})
```

### 4. Structural Correctness

Single reconciler execution:

1. Route authorizes via `getWorkerOrAdminContext`.
2. It reads captured payment intents with no payout.
3. It inserts missing payout for each candidate.
4. It logs success/failure evidence to Sentry and returns a safe JSON response.

This closes the "orphan eventually gets healed" path when the route runs alone.

Concurrent reconciler execution:

1. Two route invocations can read the same captured payment intent before either insert commits.
2. Both see no joined payout.
3. Both call `insertMissingPayout`.
4. The `payouts.payment_intent_id` schema has only a non-unique index, so the DB does not reject duplicate payout rows.

This does not reopen the original capture orphan, but it leaves a duplicate-payout-row risk if cron/manual calls overlap.

### 5. Verdict

PARTIAL.

The automatic healing mechanism exists and is scheduled, but the reconciler itself is not fully idempotent under concurrent execution.

### 6. Follow-up Recommendation

Add a unique index on `public.payouts(payment_intent_id)` or a partial unique index if multiple payout rows are intentionally supported by future statuses. Then update `insertMissingPayout` to use an idempotent insert/upsert behavior and add a test with two concurrent reconciler calls.

## P0-D — Builder Event Access Idempotency

### 1. Stated Invariant

Builder event access must be consumed once per event. It must also never overconsume a final free event or final paid event credit when two different event IDs are created or approved concurrently from a stale builder profile snapshot.

### 2. Surface Check

Current `origin/main` implementation:

- `supabase/migrations/20260617000000_add_p0_concurrency_guards.sql:16-32` creates `builder_event_access_consumptions` with unique `(builder_id, event_id)`.
- `lib/billing/builder-billing.ts:577-587` returns existing consumption for the same builder/event.
- `lib/billing/builder-billing.ts:589-597` computes the source from the caller-provided builder profile and inserts the ledger row.
- `lib/billing/builder-billing.ts:606-650` updates `builder_profiles.free_events_used` or `paid_event_credits` after inserting the ledger row.
- `lib/billing/builder-billing.ts:616-623` sets `free_events_used` to `summary.freeEventsUsed + 1` without a compare-and-swap predicate.
- `lib/billing/builder-billing.ts:634-642` sets `paid_event_credits` to `summary.paidEventCredits - 1` without a compare-and-swap predicate.

The same-event idempotency ledger exists, but final-credit arbitration does not.

Draft remediation already exists:

- PR #101: `https://github.com/chrisredd85/3rdSpace/pull/101`
- Branch: `codex/two-free-events-idempotency-and-banner`
- Commit: `2f6e4d6c3f61780cc784f7d746bfa115ba52b423`
- The draft PR adds RPC-oriented consumption and tests named `does not overconsume free events when two different events race for one remaining free event` and `does not overconsume paid event credits when two different events race for one credit`.

### 3. Behavioral Evidence

Targeted command:

```bash
npm test -- __tests__/billing/builder-billing-idempotent.test.ts
```

Result: passed. Log: `qa-artifacts/p0-audit-p0d-billing-idempotent.log`.

Relevant current-main test snippet:

```ts
// __tests__/billing/builder-billing-idempotent.test.ts:179-202
it('consumes a free event once for concurrent calls with the same event id', async () => {
  const db = setupBillingDb()

  const [first, second] = await Promise.all([
    consumeBuilderEventAccess({
      admin: db,
      builder,
      eventId: 'event-1',
    }),
    consumeBuilderEventAccess({
      admin: db,
      builder,
      eventId: 'event-1',
    }),
  ])

  expect(first).toEqual({ source: 'free_trial', amount: 0 })
  expect(second).toEqual(first)
  expect(db.rows.builder_event_access_consumptions).toHaveLength(1)
  expect(db.rows.builder_profiles[0].free_events_used).toBe(1)
  expect(db.rows.builder_event_usage).toHaveLength(1)
  expect(db.rows.builder_event_usage[0].events_booked).toBe(1)
})
```

This proves same-event idempotency only. It does not test two different `eventId` values racing for one remaining free event or paid credit.

### 4. Structural Correctness

Same-event race:

1. Both requests attempt the same builder/event pair.
2. The unique `(builder_id, event_id)` ledger key allows one insert.
3. The loser reloads the existing ledger row.
4. Only one free event is consumed.

Different-event final-credit race:

1. Two requests can receive the same stale `builder` object with `free_events_used = 1`, `free_events_granted = 2`, or `paid_event_credits = 1`.
2. They use different event IDs, so the `(builder_id, event_id)` unique index does not arbitrate between them.
3. Both compute `resolveBuilderEventAccessConsumption` from stale summary state.
4. Both insert distinct ledger rows successfully.
5. Both then write the same absolute counter value: `free_events_used = summary.freeEventsUsed + 1` or `paid_event_credits = summary.paidEventCredits - 1`.
6. The DB counters may appear non-negative, but two events can receive access while only one final credit existed.

### 5. Verdict

OPEN.

The PR #85 change closed same-event duplicate consumption, but did not close the broader P0-D invariant around final-credit race conditions across different event IDs.

### 6. Follow-up Recommendation

Merge or continue PR #101 after review. The correct fix shape is a database RPC or transaction that locks/updates the builder profile and inserts the consumption ledger as one atomic operation, with tests for:

- same event duplicate call,
- different events racing for one remaining free event,
- different events racing for one remaining paid event credit,
- no ledger row when billing access is rejected.

## Validation

Install:

```bash
npm install
```

Result: succeeded. npm reported 43 audit vulnerabilities (4 low, 27 moderate, 11 high, 1 critical). No dependency changes were made because this PR is audit-only.

Targeted tests:

| Command | Result | Log |
| --- | --- | --- |
| `npm test -- __tests__/integration/p0-concurrency.test.ts -t approval` | Passed | `qa-artifacts/p0-audit-p0a-approval-race.log` |
| `npm test -- __tests__/integration/vendor-payment-end-to-end.test.ts -t "authorization requests race"` | Passed | `qa-artifacts/p0-audit-p0b-deposit-race.log` |
| `npm test -- __tests__/integration/capture-reconciler.test.ts` | Passed | `qa-artifacts/p0-audit-p0c-capture-reconciler.log` |
| `npm test -- __tests__/billing/builder-billing-idempotent.test.ts` | Passed | `qa-artifacts/p0-audit-p0d-billing-idempotent.log` |

Standard validation:

| Command | Result | Log |
| --- | --- | --- |
| `npm run type-check` | Passed | `qa-artifacts/p0-audit-type-check.log` |
| `npm run lint` | Passed with existing React hook warnings | `qa-artifacts/p0-audit-lint.log` |
| `npm test` | Parallel run showed 2 flaky/interference failures | `qa-artifacts/p0-audit-full-test.log` |
| `npm test -- --runInBand` | Passed: 165 suites passed, 1 skipped; 849 tests passed, 9 skipped | `qa-artifacts/p0-audit-full-test-runinband.log` |

Parallel full-suite failures observed:

- `components/auth/__tests__/SignupExperience.test.tsx`: timeout in `shows creator as a 5-step flow and gates each signup step`.
- `__tests__/integration/venue-payouts-rental-ui.test.tsx`: timeout in refund decision modal test.
- `__tests__/integration/venue-payouts-rental-ui.test.tsx`: POS proof upload assertion did not observe the expected POST.

These failures are outside this audit-only diff and did not reproduce when Jest ran serially through the pre-commit hook and the explicit `npm test -- --runInBand` command. The targeted P0 invariant tests listed above passed.

## Final Recommendation

Do not treat PR #85 as fully closing all four P0 invariants.

Recommended next order:

1. Merge/review PR #101 to close P0-D.
2. Add the `payouts(payment_intent_id)` uniqueness/idempotent insert follow-up for P0-C.
3. Add a P0-B follow-up for different-amount races before Stripe authorization.
4. Add one P0-A rollback test, but do not block on it; the core approval race is structurally closed.
