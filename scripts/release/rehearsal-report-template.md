# Prompt 1-8 migration bundle rehearsal

This report is for a disposable, production-derived clone only. It is not an
authorization to connect to or mutate production. Never paste a database URL,
password, access token, JWT, or service key into this file.

## Release identities

| Field | Value |
| --- | --- |
| Rehearsal run ID | `PENDING` |
| Candidate commit | `PENDING` |
| Old production source SHA probed | `PENDING_REHEARSAL_OLD_PRODUCTION_SHA` |
| Clone ID | `PENDING` |
| Clone connection fingerprint | `PENDING` |
| Clone source snapshot | `PENDING` |
| Expected baseline migration | `PENDING` |
| Observed baseline migration | `PENDING` |
| Started (UTC) | `PENDING` |
| Finished (UTC) | `PENDING` |
| Final status | `PENDING` |

## Non-production guard receipt

- [ ] The provider/operator created this database as a disposable clone.
- [ ] `REHEARSAL_TARGET_CLASS=clone` was supplied.
- [ ] The declared production URL identity or project ref did not match the
      clone connection.
- [ ] `rehearsal_meta.environment_guard` returned `environment=clone`,
      `allow_bundle_rehearsal=true`, and the exact expected clone ID.
- [ ] Guard and baseline queries ran with `default_transaction_read_only=on`.
- [ ] The database connection URL was not written to any artifact.

Any unchecked item is a stop condition.

## Baseline and reviewed inventory

The runner must observe all four separately approved prerequisites in the
clone ledger: `20260701090000`, PR #203's `20260709090000`, PR #205's
write-pause prerequisite `20260709100000`, and the pulled-forward
`20260709110000`. PR #204's candidate SHA must be captured live only after it
is rebased onto the `main` containing the prerequisite releases. The exact last
committed baseline must be `20260709110000`. None of the 22 bundle versions may
already be present.

The bundle is exactly 22 migrations, applied serially in the committed order:

1. `20260709114000_atomic_vendor_base_rate_repair.sql`
2. `20260709115000_add_atomic_builder_event_materialization.sql`
3. `20260709120000_lock_down_function_and_view_privileges.sql`
4. `20260709130000_server_owned_execution_control_plane.sql`
5. `20260709140000_add_approval_version_retry_contract.sql`
6. `20260709150000_add_canonical_plan_event_identity.sql`
7. `20260709160000_complete_concierge_execution.sql`
8. `20260709162000_add_canonical_quote_booking_execution.sql`
9. `20260709163000_complete_canonical_event_outcome_command.sql`
10. `20260709164000_extend_approved_action_handoff_retry.sql`
11. `20260709165000_cancel_external_checkout_handoff.sql`
12. `20260709166000_harden_canonical_booking_provenance.sql`
13. `20260709167000_confirm_external_checkout_handoff.sql`
14. `20260709168000_confirm_canonical_venue_bookings_batch.sql`
15. `20260709169000_allow_waiting_quote_reapproval.sql`
16. `20260709170000_require_canonical_quote_booking_reapproval.sql`
17. `20260709171000_decline_canonical_bookings.sql`
18. `20260709174000_claim_canonical_quote_booking_resume.sql`
19. `20260709175000_harden_prompt8_confirmation_side_effects.sql`
20. `20260709176000_harden_canonical_vendor_claim_binding.sql`
21. `20260709177000_harden_terminal_plan_execution_boundary.sql`
22. `20260709178000_make_canonical_venue_confirmation_effects_replayable.sql`

`migration-manifest.tsv` is the machine-generated source of filename and SHA-256
truth for a specific run. An extra, missing, reordered, dirty, or untracked
migration is a stop condition.

## Preflight gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Server-owned execution preflight before migration 1 | `PENDING` | `logs/preflight-before.log` |
| Server-owned execution preflight after migration 22 | `PENDING` | `logs/preflight-after.log` |

Both executions use
`scripts/security/preflight-server-owned-execution.sql`. The second run proves
the historical data remains internally consistent after the complete bundle.

## Per-migration timings and commit boundary

The runner appends an automated table here. Each file and its corresponding
`supabase_migrations.schema_migrations` row are committed in one database
transaction. `last-committed-version.txt` is rewritten after every successful
migration and again on any failure.

| Ordinal | Version | Filename | Duration (ms) | Result | Last committed version |
| ---: | --- | --- | ---: | --- | --- |
| `PENDING` |  |  |  |  |  |

Total migration apply duration (sum of the 22 measured transaction durations):
`PENDING_MS`. This is the window estimate; preflight and verifier time is
recorded separately by the run start/finish timestamps.

## Deliberate failure proof

Use `--fail-at N` on a fresh clone to execute migration `N` inside the same
single-transaction boundary as its ledger insert, then inject a guaranteed SQL
exception before that ledger insert. The runner must exit with code 42 only
after observing the exact injected exception, querying the database ledger, and
proving that migration `N` rolled back and the last committed version is
migration `N-1` (or the declared baseline when `N=1`). A migration-body failure
before the injected exception is a failed rehearsal, never a successful drill.

| Field | Value |
| --- | --- |
| Requested failure ordinal | `NOT_RUN` |
| Injected exception observed | `NOT_RUN` |
| Expected last committed version | `NOT_RUN` |
| Observed last committed version | `NOT_RUN` |
| Proof result | `NOT_RUN` |
| Evidence | `deliberate-failure-proof.txt` |

Run the complete rehearsal and the deliberate-failure rehearsal on separate
fresh clones. A partially migrated failure-test clone is evidence, not a
candidate for production promotion.

## Post-apply verifiers

All three verifiers are read-only and required:

| Verifier | Result | Evidence |
| --- | --- | --- |
| `scripts/release/verify-plan-supply-intents.sql` | `PENDING` | `logs/verify-plan-supply-intents.log` |
| `scripts/security/verify-hosted-acls.sql` | `PENDING` | `logs/verify-hosted-acls.log` |
| `scripts/security/verify-hosted-control-plane.sql` | `PENDING` | `logs/verify-hosted-control-plane.log` |

The ACL verifier fails closed unless all 48 realized `SECURITY DEFINER`
functions are classified exactly: 37 service-only and 11 authenticated-scoped,
with zero anonymous privileged functions.

## Old-production-code compatibility against the new schema

The rehearsal maps representative write operations from the operator-provided,
full `REHEARSAL_OLD_PRODUCTION_SHA` (`REVIEWED_BASE_SHA`) to the browser/service
database roles used by those routes, validates that each mapped route and helper
exists at that exact commit and still references the probed table or RPC, records
their Git blob SHAs, then evaluates the required privileges on the migrated
clone. It does not send email, navigate an external checkout, or execute a
payment.

Expected high-risk compatibility boundary: migration `20260709130000` removes
authenticated browser DML from trusted execution tables. Old routes that still
write those tables with the authenticated client must be listed as broken;
service-role payment routes and the allowlisted revision RPC should remain
compatible. The generated evidence is:

- `old-production-compatibility-probes.tsv` — every route/operation probe.
- `old-production-route-probe-manifest.tsv` — reviewed representative route,
  helper, role, object, and privilege mapping.
- `old-production-source-inventory.tsv` — exact route/helper blob SHA evidence
  from `REVIEWED_BASE_SHA`.
- `old-production-route-breakage-list.md` — grouped broken and compatible
  routes with the observed privilege reason.

This is representative ACL compatibility, not a replacement for authenticated
HTTP smoke testing during the coordinated schema/code window.

## Operator observations

- Lock waits or long-running transactions:
- Slowest migration and duration:
- Database warnings/notices:
- Old-code routes confirmed broken:
- Old-code routes confirmed compatible:
- Unexpected data changes:
- Follow-up owner and deadline:

## Decision

- [ ] **PASS** — exact inventory, both preflights, all migrations, all three
      verifiers, ledger boundary, and compatibility evidence passed.
- [ ] **EXPECTED FAILURE PROOF** — failure at `N` proved `N-1`; do not promote
      this clone.
- [ ] **FAIL / STOP** — investigate before any hosted production apply.

Decision rationale:

`PENDING`

## Automated receipt

`rehearse-bundle.sh` appends a run-specific receipt below this heading. The
template text above remains as the human review checklist.
