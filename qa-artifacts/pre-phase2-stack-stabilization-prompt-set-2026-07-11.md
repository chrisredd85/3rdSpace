# Pre-Phase-2 stack stabilization prompt set — 2026-07-11

## Superseding release-contract revision

This tracked revision supersedes the untracked historical copy preserved in
`/private/tmp/3rdplace-5k-readiness-integration`. That source worktree must not
be cleaned or modified. Historical SHAs and completed receipts in the original
remain historical evidence; the release instructions below are authoritative
for all future stack, rehearsal, parity, dry-run, and coordinated-window work.

No instruction in this file authorizes a push, merge, deployment, hosted
database mutation, write-pause transition, webhook replay, Stripe operation,
booking, checkout, or outbound message. Each such action retains its own human
STOP approval.

## Corrected dependency contract

The three release stages are:

1. PR #203: `20260709090000_add_payment_intents_capturing_status.sql` and the
   reviewed payment-capture application release.
2. PR #205: both
   `20260709100000_add_write_pause_control.sql` and
   `20260709110000_repair_p0_stored_functions.sql`, plus the reviewed
   write-pause application release.
3. PR #204: the coordinated 22-migration bundle beginning at
   `20260709114000_atomic_vendor_base_rate_repair.sql` and ending at
   `20260709178000_make_canonical_venue_confirmation_effects_replayable.sql`.

The exact reviewed `20260709110000` bytes are pinned to SHA-256:

```text
8ba0e1d6832bb6ada35fdceb7677b878b3d56cea8ed4fd4c14151e2ca0299417
```

Do not move `20260709114000` or `20260709115000` into PR #205. Do not retain a
PR #204-owned duplicate of `20260709110000`; PR #204 inherits it from PR #205.

## Corrections to Prompt 1 — PR #205 reconstruction and proof

Replace the stale single-migration invariant with all of the following:

- PR #205 owns exactly `20260709100000` and `20260709110000` above PR #203.
- `20260709110000` must match the pinned SHA-256 exactly.
- A clean local reset must reach `20260709110000`.
- `supabase db lint --local --fail-on error` must report zero errors.
- The realized six-function suite must execute with zero skips.
- The scoped tied-house gate must pass.
- The strict delta gate must report every reviewed new occurrence explicitly.
  The honest strict total is 467: 461 inherited, one protected legacy table
  identifier in `100000`, and five byte-pinned legacy identifiers/comments in
  `110000`. Never rewrite or hide the pinned migration to force the obsolete
  462 estimate.

Any earlier statement that PR #205 has only `20260709100000`, resets only
through `100000`, or should total 462 strict matches is superseded.

## Corrections to Prompt 2 — provisional PR #204 candidate

The provisional candidate must:

- inherit the exact reconstructed PR #205 head;
- replay only PR #204-owned work;
- preserve Prompt E/F organizer-owned PaymentMethod, resumable SCA, and
  separate explicit capture behavior;
- preserve PR #204 `displayApproval` and `currentApprovalId` replacement-ID
  behavior;
- contain exactly 22 PR #204-owned migration files, ordered as follows:

```text
20260709114000, 20260709115000, 20260709120000, 20260709130000,
20260709140000, 20260709150000, 20260709160000, 20260709162000,
20260709163000, 20260709164000, 20260709165000, 20260709166000,
20260709167000, 20260709168000, 20260709169000, 20260709170000,
20260709171000, 20260709174000, 20260709175000, 20260709176000,
20260709177000, 20260709178000
```

The candidate is local and provisional until an independently authorized push.
It is never a final `RELEASE_SHA` or `TOOLS_SHA`.

## Corrections to Prompts 4 and 5 — readiness and PR #205 release

The Phase-2 readiness decision must require proof that PR #205 contains both
`100000` and the pinned `110000`, with clean-reset, zero-lint-error, realized
six-function, write-pause, payment, webhook, security, build, and browser
evidence tied to its exact head.

After PR #203 is released, PR #205's final diff against `main` must contain the
reviewed write-pause/P0-function prerequisite work and both migrations. Its
schema-first production phase must apply and verify both versions before the
PR #205 application tree is merged and deployed.

## Corrections to Prompt 6 — final PR #204 release capture

The final pre-window hosted ledger must already contain four prerequisite
versions:

```text
20260701090000
20260709090000
20260709100000
20260709110000
```

The frozen PR #204 manifest and parity `--expect-missing` input must contain
exactly the 22 versions listed above. The dry run must list exactly those 22
files, beginning with `20260709114000`, in order, and nothing else.

The two production-derived clone rehearsals use baseline
`20260709110000`. The deliberate transaction failure remains targeted at
`20260709166000`; after removing `110000` from the bundle it is ordinal 12, so
use `--fail-at 12` and require the ledger to remain at ordinal 11,
`20260709165000`.

Any future Phase-4/STOP-4.B prompt must display and require the same 22-file
dry-run output before asking for apply approval. A stale 23-file or
`110000`-starting dry run is a STOP, not an apply condition.

## Actions secrets and release SHA truth

Secret names alone are not value proof. Hosted operator preflight can validate
the operator credentials read-only before the window. GitHub Actions secret
values are proved only by a real workflow run from the default branch under
the runbook's deployment-SHA rules.

Final `RELEASE_SHA` and `TOOLS_SHA` are captured live only after PR #203 and PR
#205 have completed their separately approved production releases and PR #204
has been rebased and fully reverified against the resulting `main`. Historical
`add2241e`, `e008116`, and `0c578d0` values are not final release inputs.

## STOP

This revision records local reconstruction inputs only. Stop before any push,
merge, deployment, hosted database operation, write-pause mutation, or other
remote action.
