# Rev-Share Settlement Schema Split Plan

Date: 2026-06-03
Source branch: `codex/rev-share-settlement-schema`
Source commits inspected:

- `15c5f2a feat(db): kickback settlement schema migration with plan link, refund fields, unique-index swap`
- `744b4e4 docs: add rev share settlement QA report`
- `1be2ed8 test: add extraction QA fixtures`

Target: future focused follow-up PRs. This PR is markdown-only.

## Verdict

Do not cherry-pick this branch.

The branch has three categories of work:

1. A rev-share/kickback settlement schema migration.
2. Branch-local QA and reconciliation docs.
3. Extraction fixture assets for future document extraction tests.

Current `main` already carries the settlement schema foundation under
`supabase/migrations/20260527000002_kickback_settlement.sql`. That migration is
newer than the source branch's `20260527000000_kickback_settlement_schema.sql`
and contains the current schema posture. The source migration should not be
ported or reintroduced under its old timestamp.

The branch-local QA docs are historical and should not be merged as-is. The
useful remaining candidate is the extraction fixture pack, but it is not wired
to tests or runtime code on the source branch. It should either land with the
document-extraction implementation slice or as a focused fixture/eval PR that
adds the missing tests at the same time.

## Source Branch Contents

### Schema migration

File:

- `supabase/migrations/20260527000000_kickback_settlement_schema.sql`

Status:

- Superseded by current-main migration
  `supabase/migrations/20260527000002_kickback_settlement.sql`.
- Do not port as-is.

Why:

- The old timestamp would put it before already-landed migrations in an unsafe
  way.
- Current main already has the plan-linked settlement fields, invoice/refund
  fields, compliance invite status, storage buckets, indexes, and updated
  `calculate_event_kickback` function in the newer migration.
- Reintroducing the old migration would create duplicate DDL and constraint
  churn instead of a clean forward migration.

If new schema work is still needed later, write a new forward migration from
current main after a fresh schema diff, rather than copying this file.

### Historical docs

Files:

- `QA_REPORT.md`
- `RECONCILIATION.md`

Status:

- Do not port as-is.

Why:

- These docs describe the state of the source branch on 2026-05-26 and
  2026-05-27.
- Several findings are now stale because later PRs added event economics,
  phase-5 schema, health/Sentry hygiene, and other planner payment surfaces.
- Useful notes from these files should be mined into future implementation PR
  bodies only when still true against current main.

### Extraction fixture pack

Files added by `1be2ed8`:

- `__tests__/fixtures/extraction/README.md`
- `__tests__/fixtures/extraction/clover-summary.png`
- `__tests__/fixtures/extraction/empty.csv`
- `__tests__/fixtures/extraction/encrypted.pdf`
- `__tests__/fixtures/extraction/eventbrite-attendees.csv`
- `__tests__/fixtures/extraction/eventbrite-checked-in-58.png`
- `__tests__/fixtures/extraction/eventbrite-only-rsvps.png`
- `__tests__/fixtures/extraction/handwritten-tab.jpg`
- `__tests__/fixtures/extraction/luma-going-87.png`
- `__tests__/fixtures/extraction/partiful-going.png`
- `__tests__/fixtures/extraction/pos-report.pdf`
- `__tests__/fixtures/extraction/scanned-receipt.pdf`
- `__tests__/fixtures/extraction/square-net-4280.png`
- `__tests__/fixtures/extraction/toast-net-3140.png`
- `__tests__/fixtures/extraction/toast-revenue.xlsx`

Status:

- Candidate future work, not a direct port.

What inspection showed:

- The source branch only references the new fixture names from its fixture
  README.
- No source-branch tests or runtime code consume the new fixture names.
- Current main already has some extraction fixture files with overlapping
  names, including `eventbrite-attendees.csv`, `handwritten-tab.jpg`, and
  `partiful-going.png`.

Recommended treatment:

- Do not overwrite same-name current-main fixtures without a file-by-file
  comparison.
- Prefer landing the uniquely named fixture files with the document extraction
  test slice that consumes them.
- If fixtures are split into their own PR, add at least a manifest test that
  asserts each expected file exists and basic parse expectations hold for CSV
  and XLSX fixtures. Avoid committing large binary-only fixtures with no test
  reference.

## Recommended Follow-Up PRs

### 1. Document extraction fixture/eval PR

Scope:

- Add only the still-useful fixture assets from `1be2ed8`.
- Keep current-main fixture files unless a deliberate comparison proves the
  branch copy is better.
- Add a manifest-style test for fixture existence and deterministic metadata.
- Document expected values in a repo-local README or test table.

Validation:

- `npm run type-check`
- `npm test -- __tests__/fixtures/extraction --runInBand` or the specific new
  fixture manifest test
- `npm test`
- `npm run lint`
- `npm run build`

### 2. Runtime settlement implementation PRs

The old QA report listed missing runtime pieces that still need current-main
reverification before implementation:

- Document extraction agent.
- Planner event-report upload route.
- Venue spend-report upload route.
- Invoice settlement branch.
- Refund request and refund-decision routes.
- Venue overdue/compliance gate.
- Eventbrite/Luma post-event polling helpers.
- Planner payments ledger UI.

Each should be a current-main implementation PR with approval-gated payment
semantics preserved. Do not use this old branch as the source of truth for
runtime code.

### 3. Schema deltas only if current main needs them

If a future implementation discovers missing schema, add a new forward migration
after comparing against `20260527000002_kickback_settlement.sql` and the latest
generated database types. Do not revive the old `20260527000000` migration.

## Product And Safety Posture

This branch is about revenue-share settlement support and evidence extraction.
Future implementation must keep the canonical approval model intact:

- The agent may propose settlement actions.
- Hosts and/or operators approve required payment/refund actions.
- The system never auto-executes a booking, payment, refund, or outbound message
  without the appropriate approval record or explicitly configured policy.

All new monetary values must remain integer cents.

## Recommendation

Close out this branch as "do not cherry-pick." Mine it only for:

- Fixture assets, if tied to tests.
- Still-current QA concerns, if verified against current main.

Everything else should be rewritten from current main.
