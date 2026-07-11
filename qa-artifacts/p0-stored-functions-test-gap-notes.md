# P0 stored-function test-gap notes

This note accompanies `20260709110000_repair_p0_stored_functions.sql`. It explains why the pre-existing suite was green while six realized PostgreSQL functions were not executable.

| Function | Why the previous tests missed the realized failure | New coverage |
|---|---|---|
| `apply_plan_revision_atomic` | `__tests__/schema/atomic-plan-revision-migration.test.ts` only searched migration text for expected statements. `lib/planner/__tests__/planRevisions.test.ts` supplied an in-memory RPC result and never compiled or executed PL/pgSQL, so PostgreSQL never type-checked the text/date `COALESCE`. | Executes a real date revision, asserts the plan/recommendation/approval state, replays a stale approval, and checks a non-owner denial. |
| `block_inflight_stripe_account_payments` | Stripe webhook tests used a JavaScript `MemoryDb` implementation of the RPC, while the KYC test only asserted that the RPC name and arguments were requested. Neither path ran the `kickback_payments` update against its actual columns. | Executes the real function with kickback, settlement-run, and settlement-charge rows; asserts replay safety. The anonymous-denial test is an expected failure until the P0.1 service-only ACL migration lands. |
| `transition_settlement_charge_status` | The schema test only asserted that the function text and optimistic-lock marker existed. State-machine tests used `SettlementMemoryDb`, which exercised the TypeScript fallback instead of the PostgreSQL RPC, so the output-column/column-name ambiguity was invisible. | Executes success and stale transitions against a real charge, checks the audit row, and asserts the qualified `failure_reason`. The anonymous-denial test is an expected failure until P0.1 ACLs land. |
| `consume_builder_event_access` | Billing, concurrency, launch-contract, outreach, and vendor-payment tests all supplied JavaScript RPC doubles. Their fake usage rows even contained `updated_at`, masking that the realized `builder_event_usage` table does not. | Executes free-event consumption, verifies realized usage columns, replays the same plan ledger key, and checks caller ownership plus canonical authenticated price inputs. |
| `create_vendor_invite` | The server-action test mocked `createServiceRoleClient().rpc()` and returned a canned row. It checked arguments and token generation but never executed the duplicate relationship lookup where `vendor_id` was ambiguous. | Executes initial and repeated invites, checks the relationship/rate row counts, and denies organizer/event ownership mismatches. |
| `create_venue_invite` | The server-action test likewise returned a canned RPC row. It verified cents conversion and planner attachment but never executed the duplicate relationship lookup where `venue_id` was ambiguous. | Executes initial and repeated invites, checks cents-based terms and row counts, and denies organizer/event ownership mismatches. |

## CI correction

The RLS workflow previously ran `supabase db reset`, then jumped directly to Jest and the RLS-enabled metadata checker. It now runs `supabase db lint --fail-on error` immediately after the reset and runs the realized stored-function suite before the existing RLS suite. This order makes PostgreSQL compile the final function bodies produced by the full migration chain.

## P0.1 integration boundary

This branch adds caller-derived identity checks to the three authenticated RPCs (`consume_builder_event_access`, `create_vendor_invite`, and `create_venue_invite`). The P0.1 privilege branch owns service-only ACLs for blocking/settlement functions and cross-plan identifier scoping in `apply_plan_revision_atomic`. Once that branch lands, convert the two `TODO(P0.1)` expected-failure tests to ordinary passing denial tests.
