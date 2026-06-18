# Two Free Events Idempotency + Banner Status

Branch: `codex/two-free-events-idempotency-and-banner`
Base: `origin/main` at `3764f9a`

## Findings

- The two-event mechanic already existed on `builder_profiles` via `free_events_granted` and `free_events_used`.
- The existing idempotency ledger already existed as `builder_event_access_consumptions`.
- The real gap was not missing state. It was non-transactional event access consumption under concurrent approval/event creation paths.

## Implementation

- Reused `builder_event_access_consumptions`; no duplicate `free_events_remaining` column or second ledger table was added.
- Added `source_metadata` to the existing ledger for diagnostics.
- Added `public.consume_builder_event_access(...)`, a transactional Postgres RPC that:
  - locks the builder profile row,
  - returns an existing ledger row for same-event retries,
  - consumes exactly one free event or paid credit for new events,
  - updates monthly builder usage in the same transaction.
- Updated `consumeBuilderEventAccess` to call the RPC instead of doing multi-statement app-level mutations.
- Added planner UI around the existing billing summary:
  - persistent planner banner for remaining free events / upgrade state,
  - inline approval notice before event-access-consuming actions.
- Standardized marketing copy to "First 2 events free".

## Validation

- `npm test` baseline before changes: passed, 165 suites passed, 1 skipped; 849 tests passed, 9 skipped.
- Focused billing/UI tests: passed, 3 suites / 12 tests.
- Related approval/payment integration suites: passed, 2 suites / 9 tests.
- `npm run type-check -- --pretty false`: passed.
- `npm run lint`: passed with existing React hook dependency warnings outside this change.
- `npm run security:tied-house`: passed.
- `npm run build`: passed. Local webpack cache emitted a non-fatal `ENOSPC` warning because the machine had ~2.2 GiB free, but compilation, page generation, and build output completed.
- `npm test`: passed after fixture updates, 166 suites passed, 1 skipped; 855 tests passed, 9 skipped.
- `npm test -- __tests__/launch-copy.test.ts --runInBand`: passed after final marketing copy alignment.
- `supabase db reset`: could not complete locally because two `supabase db reset` processes hung before emitting any output. Both were stopped.
- Targeted migration smoke: passed in a temporary local Postgres database. The new migration compiled, the RPC consumed one free event, monthly usage updated, and a same-event retry returned the ledger row without incrementing `free_events_used` again.

## Notes

- The API still returns the existing `amount` dollar field for compatibility, while the transactional function stores and computes with `amount_cents`.
- The banner dismissal uses `sessionStorage`, matching the intended per-browser-session dismissal behavior.
