# Prompts A–D continuation handoff — 2026-07-10

## Historical receipt and supersession note

The original untracked handoff remains preserved, unchanged, at:

```text
/private/tmp/3rdplace-5k-readiness-integration/qa-artifacts/prompts-a-d-handoff-2026-07-10.md
```

Its implementation, test, GitHub, Vercel, and SHA statements are historical
receipts from July 10. They must not be rewritten as if they described the
current reconstructed stack. In particular, its 23-migration rehearsal and
`20260709110000..20260709178000` future-release instructions are superseded by
this addendum.

Nothing in this addendum authorizes a push, merge, deployment, hosted database
mutation, write-pause transition, webhook replay, Stripe operation, booking,
checkout, or outbound message.

## Current future release contract

The dependency and schema ownership for all future work is:

1. PR #203 owns the reviewed payment-capture release and migration
   `20260709090000`.
2. PR #205 owns the write-pause/P0-function prerequisite release and migrations
   `20260709100000` and `20260709110000`.
3. PR #204 inherits those prerequisites and owns exactly 22 coordinated
   migrations, beginning at `20260709114000` and ending at
   `20260709178000`.

The exact reviewed `20260709110000_repair_p0_stored_functions.sql` SHA-256 is:

```text
8ba0e1d6832bb6ada35fdceb7677b878b3d56cea8ed4fd4c14151e2ca0299417
```

PR #205 must prove a clean reset through `110000`, zero database-lint errors,
and the realized six-function suite. PR #204 must not contain an owned duplicate
of `110000`, and `114000`/`115000` remain in PR #204.

## Corrected rehearsal and hosted-window sequence

After separately approved PR #203 and PR #205 schema-first releases and exact
deployment proof:

1. Rebase/finalize PR #204 against the resulting `main` and capture its live
   reviewed `RELEASE_SHA`, base SHA, and `TOOLS_SHA`.
2. Require hosted ledger prerequisites `20260701090000`, `20260709090000`,
   `20260709100000`, and `20260709110000`.
3. Run two fresh production-derived clone rehearsals from baseline
   `20260709110000` using the exact 22-file manifest.
4. The deliberate transaction-failure drill remains targeted at
   `20260709166000`; its new ordinal is 12, so `--fail-at 12` must leave the
   ledger at ordinal 11, `20260709165000`.
5. Hosted parity must report exactly the 22 PR #204 versions missing.
6. The production dry run must list exactly those 22 files, beginning at
   `20260709114000`, in order, and nothing else.
7. Only after the applicable human STOP approval may the coordinated schema
   window begin.

Any future prompt or runbook that expects 23 files, starts the PR #204 bundle at
`110000`, uses baseline `100000`, or injects the `166000` failure at ordinal 13
is stale and must stop before mutation.

## Historical facts intentionally retained

The original handoff remains the evidence source for what was true at its
recorded heads: the old A/B/C/D implementation summaries, old test receipts,
old Vercel state, and the explicit statement that no hosted migration, merge,
deployment, payment, booking, webhook replay, or outbound message had occurred
at that time. This addendum changes only the future release topology after the
reviewed `110000` migration was pulled forward into PR #205.
