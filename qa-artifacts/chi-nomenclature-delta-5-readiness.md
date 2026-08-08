# CHI Nomenclature δ.5 Readiness

Date: 2026-06-18
Branch: `codex/chi-nomenclature-delta-5-cleanup`
Base: `origin/main` at `3764f9ae701d21052a9105213ce86753beb8b813`

## Summary

This draft exists to keep δ.5 visible, but the destructive cleanup should not be merged yet.

The original δ.5 scope deletes:

- `lib/finance/legacySettlementAdapter.ts`
- the δ.3 API compatibility layer
- legacy schema objects, including legacy tables/columns/RPCs
- deprecated type aliases
- compatibility response headers and legacy request keys
- strict tied-house grep violations by making the strict check CI-blocking

Current `main` is not ready for that removal. The compatibility layer and legacy DB objects still have active production callers. Dropping them now would break Stripe webhooks, refund decisions, builder payout summaries, event-report settlement calculation, spend-report settlement calculation, email wrappers, and venue compliance gates.

## Hard Blockers

### 1. The required seven-day no-legacy telemetry window cannot be satisfied yet

δ.3 API compatibility merged on 2026-06-18 in PR #94. δ.5 requires seven days with no `legacy_key_used` telemetry before deleting compatibility request/response keys. That clock has not elapsed.

### 2. Strict tied-house grep still fails on active production code

Validation command:

```bash
npm run security:tied-house:strict
```

Current result: fails with 454 log lines.

Full log:

```text
qa-artifacts/chi-nomenclature-delta-5-strict.initial.log
```

Representative active production paths still flagged:

- `app/api/webhooks/stripe/route.ts`
- `app/api/planner/plans/[planId]/refund-decision/route.ts`
- `app/api/builder/payouts/summary/route.ts`
- `app/api/planner/plans/[planId]/event-report/route.ts`
- `app/api/events/[eventId]/upload-checkins/route.ts`
- `lib/server/community-host-incentive/spend-report.ts`
- `lib/email.ts`
- `lib/planner/venueComplianceGate.ts`
- `lib/ticketing/attendancePoll.ts`
- `lib/finance/eventActuals.ts`

### 3. Legacy payment/history tables are still live

The following legacy-named database surfaces are still read or written by production code:

- `event_kickback_agreements`
- `kickback_payments`
- `kickback_disputes`
- `venue_kickback_configs`
- `calculate_event_kickback`
- `get_event_kickback_summary`

These are not just stale names. They currently carry payment/refund/webhook and reporting history. Dropping them requires a preceding data and caller migration to CHI-native tables.

### 4. `legacySettlementAdapter` still has active callers

Current active callers:

- `app/api/planner/plans/[planId]/event-report/route.ts`
- `app/api/events/[eventId]/upload-checkins/route.ts`

Those routes use the adapter to create/update CHI agreements and settlements from existing event agreement rows. The adapter can be renamed and split, but deleting it before migrating the source tables would break post-event settlement creation.

## Recommended Safe Split

### δ.5a — API compatibility removal

Scope:

- remove `lib/api/legacy-key-compat.ts`
- remove `X-Deprecated-Keys`
- remove dual response keys
- stop accepting legacy request keys
- update tests and snapshots

Precondition:

- seven days of no `legacy_key_used` events after PR #94

### δ.5b — CHI-native settlement caller migration

Scope:

- migrate event report, check-in upload, spend report, refund decision, webhooks, email, and payout summaries to CHI-native tables
- move any remaining bridge code out of `legacySettlementAdapter`
- stop writing `kickback_payments` compatibility rows
- add data backfill/verification queries

Precondition:

- no production route still uses the legacy table names as primary state

### δ.5c — destructive schema drop

Scope:

- drop legacy tables/columns/RPCs with `IF EXISTS`
- include row-count assertions before every destructive table drop
- update generated DB types after migration
- wire `npm run security:tied-house:strict` into CI and pre-commit

Precondition:

- δ.5b merged and deployed
- seven days of clean telemetry
- strict grep passes on `main`

Rollback:

- destructive schema drop rollback requires restore from backup; this is why δ.5c must be last.

## Validation Run For This Draft

```bash
npm run security:tied-house:strict
```

Result: expected failure, recorded in `qa-artifacts/chi-nomenclature-delta-5-strict.initial.log`.

## Decision

Do not merge destructive δ.5 cleanup from the current `main` state. Use this draft as the review anchor and split the implementation into δ.5a, δ.5b, and δ.5c.
