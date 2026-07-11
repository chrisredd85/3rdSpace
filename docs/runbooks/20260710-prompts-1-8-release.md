# Prompts 1–8 coordinated release

## Release contract

Prompts 1–8 change application code and the database control plane together.
This is a two-phase schema-first-then-deploy release, not a merge-and-wait
release:

1. with durable write pause active, apply and verify the reviewed database
   bundle;
2. merge the frozen reviewed application head and wait for Vercel to deploy the
   resulting `main` merge commit; and
3. reopen writes only after hosted parity, database verification, exact-tree
   proof, health/read smoke, and maintenance-boundary smoke all pass, then run
   the controlled non-money write smoke immediately.

The Vercel project automatically deploys `main`. A GitHub merge commit has a
different SHA from the PR head even when their trees are identical. This
runbook records both SHAs, proves that the reviewed head is an ancestor of the
deployed commit, and requires a zero tree diff.

Prompt 9 owns controlled-payment provider execution, canonical transaction
bootstrap, Stripe capture, reconciliation, and payment cancellation. This
release exposes only an approval-gated integer-cent payment proposal. It must
not call Stripe, move money, automatically open checkout, or automatically send
outreach.

## Mandatory prerequisite releases

Do not create the release worktree until all three prerequisite migrations are
hosted and the separately deployable prerequisite code releases are complete:

1. `20260701090000_add_plan_supply_intents.sql`, using
   `20260701090000-plan-supply-intents-release.md`;
2. PR #203's `20260709090000_add_payment_intents_capturing_status.sql`, after
   its stale-capture crash recovery is complete and verified; and
3. `20260709100000_add_write_pause_control.sql` plus the write-pause API, as a
   separate schema-first prerequisite release.

The write-pause table and API cannot first ship inside the same deployment that
needs them to protect this bundle. They must already be live, durable across
serverless instances, and proven with the five tests in
`docs/runbooks/write-pause.md`. If the write-pause implementation exists only on
the Prompts 1–8 branch, split it into a separately reviewed prerequisite release
before continuing.

The production-clone rehearsal is also mandatory. Record its backup/PITR
provenance, per-migration timing, last-committed-version failure drill, all
verifier results, and old-code/new-schema breakage list in the release ticket.
There is no approved real window until that receipt has a go decision.

## Stop conditions

Stop before mutation if any of these is true:

- any prerequisite version is absent from the hosted ledger;
- the release dry run lists a migration outside the 23-file reviewed inventory;
- production-clone rehearsal is missing or failed;
- the control-plane preflight reports any contradictory approval, action,
  payment, or settlement row;
- the frozen release SHA or reviewed base SHA changes;
- local, GitHub, or Vercel preview gates are not successful;
- `main` is not protected with the reviewed test, RLS, E2E, and Vercel checks;
- the write-pause script cannot prove `safe_to_migrate=true`;
- no database recovery point and forward-fix owner are recorded; or
- the operator cannot keep writes paused until all post-deploy proof passes.

Never use `--include-all` to hide an ordering or parity mismatch.

## Operator environment and roles

Use one shell for the entire procedure. Values come from the production
password manager and must not be printed or committed.

```bash
export GITHUB_REPOSITORY='chrisredd85/3rdSpace'
export RELEASE_PR='204'
export VERCEL_SCOPE='website-for-services-projects'
export PRODUCTION_ORIGIN='https://3rdplace.io'
export WRITE_PAUSE_BASE_URL="$PRODUCTION_ORIGIN"

: "${SUPABASE_ACCESS_TOKEN:?missing SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?missing SUPABASE_PROJECT_REF}"
: "${SUPABASE_DB_PASSWORD:?missing SUPABASE_DB_PASSWORD}"
: "${SUPABASE_DB_URL:?missing SUPABASE_DB_URL}"
: "${WRITE_PAUSE_BASE_URL:?missing WRITE_PAUSE_BASE_URL}"
: "${CRON_SECRET:?missing CRON_SECRET}"
```

The release commander freezes SHAs and owns stop/go. The production database
operator runs preflight, apply, and SQL verification. The GitHub/Vercel operator
merges and proves the deployment. The product verifier runs non-money smoke.
One person may hold multiple roles, but the release receipt must name the actor
and timestamp for each phase.

## Freeze one exact release candidate

PR #203 and the write-pause prerequisite change `main`; therefore do not reuse
the historical `add2241e…` SHA. Capture the final PR head and base only after
rebasing and rerunning every gate.

```bash
export REPO_ROOT="$(git rev-parse --show-toplevel)"
git -C "$REPO_ROOT" fetch origin --prune

export RELEASE_SHA="$(
  gh pr view "$RELEASE_PR" --repo "$GITHUB_REPOSITORY" \
    --json headRefOid --jq .headRefOid
)"
export REVIEWED_BASE_SHA="$(
  gh pr view "$RELEASE_PR" --repo "$GITHUB_REPOSITORY" \
    --json baseRefOid --jq .baseRefOid
)"

gh api "repos/$GITHUB_REPOSITORY/branches/main/protection" >/dev/null
test "$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)" = "$REVIEWED_BASE_SHA"
test "$(gh pr view "$RELEASE_PR" --repo "$GITHUB_REPOSITORY" --json mergeable --jq .mergeable)" = 'MERGEABLE'
test "$(gh pr view "$RELEASE_PR" --repo "$GITHUB_REPOSITORY" --json mergeStateStatus --jq .mergeStateStatus)" = 'CLEAN'

export RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/3rdplace-prompts-1-8.XXXXXX")"
export RELEASE_WT="$RELEASE_ROOT/release"
git -C "$REPO_ROOT" worktree add --detach "$RELEASE_WT" "$RELEASE_SHA"

test "$(git -C "$RELEASE_WT" rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git -C "$RELEASE_WT" status --porcelain --untracked-files=all)"
test -f "$RELEASE_WT/docs/runbooks/write-pause.md"
test -x "$RELEASE_WT/scripts/release/toggle-write-pause.sh"
test -f "$RELEASE_WT/scripts/security/preflight-server-owned-execution.sql"
test -f "$RELEASE_WT/scripts/release/verify-plan-supply-intents.sql"
test -f "$RELEASE_WT/scripts/security/verify-hosted-control-plane.sql"
test -f "$RELEASE_WT/scripts/security/verify-hosted-acls.sql"
test -x "$RELEASE_WT/scripts/release/rehearse-bundle-setup.sh"
test -x "$RELEASE_WT/scripts/release/rehearse-bundle.sh"
test -f "$RELEASE_WT/scripts/release/rehearsal-report-template.md"

export ACTIONS_SECRET_NAMES="$(
  gh secret list --repo "$GITHUB_REPOSITORY" --app actions \
    --json name --jq '.[].name'
)"
for required_secret in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; do
  grep -qx "$required_secret" <<<"$ACTIONS_SECRET_NAMES"
done
```

## Freeze the exact 23-file migration manifest

The bundle is not one transaction. An error in a later file can leave earlier
files committed. Freeze every file checksum before rehearsal and production:

```bash
BUNDLE_FILES=(
  supabase/migrations/20260709110000_repair_p0_stored_functions.sql
  supabase/migrations/20260709114000_atomic_vendor_base_rate_repair.sql
  supabase/migrations/20260709115000_add_atomic_builder_event_materialization.sql
  supabase/migrations/20260709120000_lock_down_function_and_view_privileges.sql
  supabase/migrations/20260709130000_server_owned_execution_control_plane.sql
  supabase/migrations/20260709140000_add_approval_version_retry_contract.sql
  supabase/migrations/20260709150000_add_canonical_plan_event_identity.sql
  supabase/migrations/20260709160000_complete_concierge_execution.sql
  supabase/migrations/20260709162000_add_canonical_quote_booking_execution.sql
  supabase/migrations/20260709163000_complete_canonical_event_outcome_command.sql
  supabase/migrations/20260709164000_extend_approved_action_handoff_retry.sql
  supabase/migrations/20260709165000_cancel_external_checkout_handoff.sql
  supabase/migrations/20260709166000_harden_canonical_booking_provenance.sql
  supabase/migrations/20260709167000_confirm_external_checkout_handoff.sql
  supabase/migrations/20260709168000_confirm_canonical_venue_bookings_batch.sql
  supabase/migrations/20260709169000_allow_waiting_quote_reapproval.sql
  supabase/migrations/20260709170000_require_canonical_quote_booking_reapproval.sql
  supabase/migrations/20260709171000_decline_canonical_bookings.sql
  supabase/migrations/20260709174000_claim_canonical_quote_booking_resume.sql
  supabase/migrations/20260709175000_harden_prompt8_confirmation_side_effects.sql
  supabase/migrations/20260709176000_harden_canonical_vendor_claim_binding.sql
  supabase/migrations/20260709177000_harden_terminal_plan_execution_boundary.sql
  supabase/migrations/20260709178000_make_canonical_venue_confirmation_effects_replayable.sql
)

test "${#BUNDLE_FILES[@]}" -eq 23
for migration in "${BUNDLE_FILES[@]}"; do
  test -f "$RELEASE_WT/$migration"
done

export BUNDLE_MANIFEST="$RELEASE_ROOT/prompts-1-8.sha256"
(
  cd "$RELEASE_WT"
  shasum -a 256 "${BUNDLE_FILES[@]}" > "$BUNDLE_MANIFEST"
)
(
  cd "$RELEASE_WT"
  shasum -a 256 -c "$BUNDLE_MANIFEST"
)
```

Preserve that manifest with the release receipt. Any checksum change requires a
new release SHA, clone rehearsal, tests, review, and dry run.

## Rehearse against two disposable production-derived clones

Provision two fresh clones from the same recent production backup after all
three prerequisite migrations are present. The clone provider/operator must
install the non-production guard documented by
`scripts/release/rehearse-bundle-setup.sh`; the scripts refuse production and
never create their own authorization marker.

Load the two clone connections and non-secret clone IDs without printing the
URLs:

```bash
export REHEARSAL_CLONE_ID_FULL='prompts-1-8-full-clone'
export REHEARSAL_CLONE_ID_FAILURE='prompts-1-8-failure-clone'

: "${REHEARSAL_DATABASE_URL_FULL:?missing full clone URL}"
: "${REHEARSAL_CLONE_ID_FULL:?missing full clone ID}"
: "${REHEARSAL_DATABASE_URL_FAILURE:?missing failure clone URL}"
: "${REHEARSAL_CLONE_ID_FAILURE:?missing failure clone ID}"

export FULL_REHEARSAL_DIR="$RELEASE_ROOT/rehearsal-full"
export FAILURE_REHEARSAL_DIR="$RELEASE_ROOT/rehearsal-failure"
export REHEARSAL_RUN_ID="prompts-1-8-$(date -u '+%Y%m%dT%H%M%SZ')"
```

Run the complete 23-file rehearsal against the first clone. Its exact baseline
must be the write-pause prerequisite, `20260709100000`:

```bash
cd "$RELEASE_WT"
REHEARSAL_DATABASE_URL="$REHEARSAL_DATABASE_URL_FULL" \
REHEARSAL_CLONE_ID="$REHEARSAL_CLONE_ID_FULL" \
REHEARSAL_EXPECTED_BASELINE_VERSION='20260709100000' \
REHEARSAL_CANDIDATE_SHA="$RELEASE_SHA" \
REHEARSAL_OLD_PRODUCTION_SHA="$REVIEWED_BASE_SHA" \
REHEARSAL_TARGET_CLASS='clone' \
PRODUCTION_PROJECT_REF="$SUPABASE_PROJECT_REF" \
scripts/release/rehearse-bundle.sh \
  --confirm-non-production \
  --run-id "$REHEARSAL_RUN_ID-full" \
  --artifacts-dir "$FULL_REHEARSAL_DIR"

grep -F -- "- Status: \`passed\`" "$FULL_REHEARSAL_DIR/rehearsal-report.md"
grep -F -- "- Candidate SHA: \`$RELEASE_SHA\`" "$FULL_REHEARSAL_DIR/rehearsal-report.md"
grep -F -- "- Old production SHA: \`$REVIEWED_BASE_SHA\`" "$FULL_REHEARSAL_DIR/rehearsal-report.md"
```

Required terminal output includes:

```text
Rehearsal passed on disposable clone <clone-id>.
Last committed version: 20260709178000.
```

Run the deliberate partial-failure drill against the second fresh clone. This
example executes migration 13 inside its per-file transaction, injects a
failure before its ledger insert, and must prove that the transaction rolled
back so migration 12, `20260709165000`, remains the last committed bundle
version:

```bash
export FAILURE_REHEARSAL_RC='0'
REHEARSAL_DATABASE_URL="$REHEARSAL_DATABASE_URL_FAILURE" \
REHEARSAL_CLONE_ID="$REHEARSAL_CLONE_ID_FAILURE" \
REHEARSAL_EXPECTED_BASELINE_VERSION='20260709100000' \
REHEARSAL_CANDIDATE_SHA="$RELEASE_SHA" \
REHEARSAL_OLD_PRODUCTION_SHA="$REVIEWED_BASE_SHA" \
REHEARSAL_TARGET_CLASS='clone' \
PRODUCTION_PROJECT_REF="$SUPABASE_PROJECT_REF" \
scripts/release/rehearse-bundle.sh \
  --confirm-non-production \
  --run-id "$REHEARSAL_RUN_ID-failure-13" \
  --fail-at 13 \
  --artifacts-dir "$FAILURE_REHEARSAL_DIR" || FAILURE_REHEARSAL_RC="$?"

test "$FAILURE_REHEARSAL_RC" -eq 42
```

Required stderr includes:

```text
Deliberate failure verified at migration 13: transaction rolled back; ledger remains at 20260709165000.
```

Exit code 42 is valid only when the receipt also records the exact injected
`rehearsal_injected_failure_at_20260709166000` sentinel. If migration 13 fails
before that sentinel executes, the harness exits 1 and the rehearsal is a stop.

Attach both artifact directories. The complete receipt must show both
preflights, all 23 timings plus their total window estimate, all three
verifiers, and the old-production route, helper-blob, and compatibility
evidence. The failure receipt must prove the migration `N` transaction rolled
back to the `N-1` ledger boundary.
The compatibility probes must target `REVIEWED_BASE_SHA`, which is the actual
application live immediately before this bundle after PR #203 and the
write-pause prerequisite. A harness or receipt still pinned to historical
production SHA `461e3da…` is a stop condition. Never reuse either clone for
production.

## Clean candidate gates

```bash
cd "$RELEASE_WT"
npm ci
supabase db reset
npm run db:types
supabase db lint --local --fail-on error
npm run type-check
npm run lint
npm test -- --runInBand
npm run security:rls
npm run security:deps
npm run security:tied-house
npm run eval:outreach
npm run build
git diff --check

test -z "$(git status --porcelain --untracked-files=all)"
gh pr checks "$RELEASE_PR" \
  --repo "$GITHUB_REPOSITORY" \
  --watch \
  --fail-fast
```

The RLS workflow must supply the clean-reset and opt-in realized-database proof;
ordinary Jest intentionally skips those suites without their `RUN_*` flags.
Attach the successful workflow URLs and the production-clone rehearsal receipt.

Prove that a successful Vercel preview was built from the frozen head:

```bash
export PREVIEW_DEPLOYMENT_ID="$(
  gh api "repos/$GITHUB_REPOSITORY/deployments?sha=$RELEASE_SHA&environment=Preview&per_page=1" \
    --jq '.[0].id'
)"

test "$(gh api "repos/$GITHUB_REPOSITORY/deployments/$PREVIEW_DEPLOYMENT_ID" --jq .sha)" = "$RELEASE_SHA"
test "$(gh api "repos/$GITHUB_REPOSITORY/deployments/$PREVIEW_DEPLOYMENT_ID/statuses" --jq '.[0].state')" = 'success'
```

## Hosted read-only preflight

```bash
cd "$RELEASE_WT"
supabase link \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --password "$SUPABASE_DB_PASSWORD"

export EXPECTED_MISSING='20260709110000,20260709114000,20260709115000,20260709120000,20260709130000,20260709140000,20260709150000,20260709160000,20260709162000,20260709163000,20260709164000,20260709165000,20260709166000,20260709167000,20260709168000,20260709169000,20260709170000,20260709171000,20260709174000,20260709175000,20260709176000,20260709177000,20260709178000'

supabase migration list \
  --linked \
  --password "$SUPABASE_DB_PASSWORD"

npm run release:migrations:parity -- \
  --linked \
  --expect-missing "$EXPECTED_MISSING"

supabase db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD" \
  --dry-run

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/preflight-server-owned-execution.sql
```

Required outcomes:

- the hosted ledger already contains `20260701090000`, `20260709090000`, and
  `20260709100000`;
- parity reports exactly the 23 versions in `EXPECTED_MISSING` and no
  remote-only version;
- the dry run lists the 23 manifest files in the same order and nothing else;
  and
- the control-plane preflight prints
  `Server-owned execution preflight passed with zero contradictions.`

The preflight checks nine contradiction classes: duplicate active approvals,
approval/action plan mismatches, invalid action approval pointers, authorization
above the requested amount, invalid executable approvals, missing payment or
settlement approvals, and payment/settlement aggregate mismatches.

## Phase 1: pause writes and apply schema

Follow `docs/runbooks/write-pause.md` from the pinned release worktree. Reads
and health must remain available; Stripe webhook receipt must remain durable.
Enable pauses new writes and waits for the configured drain interval. The
command must exit zero only after authenticated status reports
`safe_to_migrate=true`.

```bash
cd "$RELEASE_WT"
scripts/release/toggle-write-pause.sh status
scripts/release/toggle-write-pause.sh enable 'Prompts 1-8 coordinated schema release'
scripts/release/toggle-write-pause.sh status |
  jq -e '.state == "paused" and .paused == true and .blocking == true and .safe_to_migrate == true'
```

Keep the pause active if any later command fails. Immediately before mutation,
re-prove the immutable tree, migration checksums, current base, exact dry run,
and zero-contradiction preflight:

```bash
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain --untracked-files=all)"
test "$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)" = "$REVIEWED_BASE_SHA"
shasum -a 256 -c "$BUNDLE_MANIFEST"

npm run release:migrations:parity -- \
  --linked \
  --expect-missing "$EXPECTED_MISSING"
supabase db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD" \
  --dry-run
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/preflight-server-owned-execution.sql
scripts/release/toggle-write-pause.sh status |
  jq -e '.state == "paused" and .paused == true and .blocking == true and .safe_to_migrate == true'
```

The production database operator then applies the reviewed inventory:

```bash
supabase db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD"
```

Do not assume bundle-wide rollback. If the command fails, leave writes paused,
record the first failed and last committed versions from
`supabase migration list --linked`, and invoke the forward-fix owner.

## Hosted schema verification while paused

Run all three hosted verifiers, not only the ACL verifier:

```bash
npm run release:migrations:parity -- --linked

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/release/verify-plan-supply-intents.sql

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/verify-hosted-control-plane.sql

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/verify-hosted-acls.sql

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/preflight-server-owned-execution.sql
```

Required outcomes:

- exact deployed migration parity;
- supply-intent table, RLS, five policies, and two indexes present;
- browser DML absent from all trusted control-plane tables;
- service-role reads/writes preserved;
- all required constraints, invariant triggers, and the active-approval unique
  index present and validated;
- the control-plane trigger functions remain `SECURITY INVOKER` and unavailable
  for direct authenticated execution;
- the SECURITY DEFINER allowlists match exactly and no anonymous privileged
  function remains; and
- the post-apply contradiction scan is still zero.

Any exception or unexpected row is a stop. Keep writes paused.

## Phase 2: merge and let Vercel deploy the exact reviewed tree

Recheck GitHub and the frozen head, then use a merge commit with the head-SHA
guard. Do not use squash, rebase merge, `--admin`, or auto-merge.

```bash
test "$(gh pr view "$RELEASE_PR" --repo "$GITHUB_REPOSITORY" --json headRefOid --jq .headRefOid)" = "$RELEASE_SHA"
test "$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)" = "$REVIEWED_BASE_SHA"

gh pr checks "$RELEASE_PR" \
  --repo "$GITHUB_REPOSITORY" \
  --watch \
  --fail-fast

gh pr merge "$RELEASE_PR" \
  --repo "$GITHUB_REPOSITORY" \
  --merge \
  --match-head-commit "$RELEASE_SHA"

git -C "$REPO_ROOT" fetch origin --prune
export MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"

git -C "$REPO_ROOT" merge-base --is-ancestor "$RELEASE_SHA" "$MAIN_SHA"
git -C "$REPO_ROOT" diff --quiet "$RELEASE_SHA" "$MAIN_SHA" --
```

The first command proves ancestry; the second proves exact tree identity. The
production deployment SHA will be `MAIN_SHA`, not `RELEASE_SHA`.

Wait for the production deployment created for `MAIN_SHA` and fail closed on a
Vercel error:

```bash
export PRODUCTION_DEPLOYMENT_ID=''
export PRODUCTION_DEPLOYMENT_STATE='pending'

for attempt in $(seq 1 60); do
  PRODUCTION_DEPLOYMENT_ID="$(
    gh api "repos/$GITHUB_REPOSITORY/deployments?sha=$MAIN_SHA&environment=Production&per_page=1" \
      --jq '.[0].id // empty'
  )"
  if [ -n "$PRODUCTION_DEPLOYMENT_ID" ]; then
    test "$(gh api "repos/$GITHUB_REPOSITORY/deployments/$PRODUCTION_DEPLOYMENT_ID" --jq .sha)" = "$MAIN_SHA"
    PRODUCTION_DEPLOYMENT_STATE="$(
      gh api "repos/$GITHUB_REPOSITORY/deployments/$PRODUCTION_DEPLOYMENT_ID/statuses" \
        --jq '.[0].state // "pending"'
    )"
    case "$PRODUCTION_DEPLOYMENT_STATE" in
      success) break ;;
      error|failure|inactive) exit 1 ;;
    esac
  fi
  sleep 10
done

test "$PRODUCTION_DEPLOYMENT_STATE" = 'success'
export PRODUCTION_DEPLOYMENT_URL="$(
  gh api "repos/$GITHUB_REPOSITORY/deployments/$PRODUCTION_DEPLOYMENT_ID/statuses" \
    --jq '.[0].environment_url'
)"

vercel inspect "$PRODUCTION_DEPLOYMENT_URL" --scope "$VERCEL_SCOPE"
vercel inspect "$PRODUCTION_ORIGIN" --scope "$VERCEL_SCOPE"
curl --fail --silent --show-error "$PRODUCTION_ORIGIN/api/health" | jq .
```

Both Vercel inspections must report `Ready`, target `production`, and the
production aliases must resolve to the deployment created for `MAIN_SHA`.

## Post-deploy hosted parity and product proof

The `Hosted Migration Parity` workflow exists on `main` only after this merge.
Preview parity is intentionally skipped; it is not evidence that the GitHub
Supabase credentials work. Wait for the successful production-deployment run:

```bash
export PARITY_RUN_ID=''
for attempt in $(seq 1 30); do
  PARITY_RUN_ID="$(
    gh run list \
      --repo "$GITHUB_REPOSITORY" \
      --workflow hosted-migration-parity.yml \
      --commit "$MAIN_SHA" \
      --limit 1 \
      --json databaseId \
      --jq '.[0].databaseId // empty'
  )"
  [ -n "$PARITY_RUN_ID" ] && break
  sleep 10
done

if [ -z "$PARITY_RUN_ID" ]; then
  gh workflow run hosted-migration-parity.yml \
    --repo "$GITHUB_REPOSITORY" \
    --ref main \
    -f deployed_sha="$MAIN_SHA"

  for attempt in $(seq 1 30); do
    PARITY_RUN_ID="$(
      gh run list \
        --repo "$GITHUB_REPOSITORY" \
        --workflow hosted-migration-parity.yml \
        --commit "$MAIN_SHA" \
        --limit 1 \
        --json databaseId \
        --jq '.[0].databaseId // empty'
    )"
    [ -n "$PARITY_RUN_ID" ] && break
    sleep 10
  done
fi

test -n "$PARITY_RUN_ID"
gh run watch "$PARITY_RUN_ID" \
  --repo "$GITHUB_REPOSITORY" \
  --exit-status
gh run view "$PARITY_RUN_ID" \
  --repo "$GITHUB_REPOSITORY" \
  --log | grep -F 'Migration parity passed: deployed code and hosted ledger match exactly.'
```

The workflow must print
`Migration parity passed: deployed code and hosted ledger match exactly.` The
fallback dispatches the now-main workflow with the same `MAIN_SHA`; absence or
failure remains a stop condition.

While the pause is still active, prove:

- health and authenticated planner reads;
- a representative planner mutation returns HTTP 503 with
  `code: maintenance_in_progress`;
- Stripe webhook receipt remains available for signed durable deferral; and
- discovery read/health surfaces remain available.

Only after every database, deployment, parity, health/read, and maintenance
boundary check passes may the release commander reopen writes:

```bash
cd "$RELEASE_WT"
scripts/release/toggle-write-pause.sh status
scripts/release/toggle-write-pause.sh disable 'Prompts 1-8 production verification complete'
scripts/release/toggle-write-pause.sh status |
  jq -e '.state == "open" and .paused == false and .blocking == false and .safe_to_migrate == false'
```

Disable must keep writes blocked in `draining`, complete the documented
deferred Stripe-webhook drain, and atomically prove the queue empty before it
opens. Immediately after disable, use controlled
non-money test data to prove:

- plan creation, explicit approval, canonical materialization, and analytics
  deep link;
- external checkout handoff without automatic navigation;
- concierge task creation only after approval;
- canonical venue/vendor confirm and decline with visible host evidence;
- retry and reapproval without duplicate effects; and
- discovery refresh recurrence and its Sentry constraint alert.

Do not execute a real Stripe payment, booking purchase, checkout navigation, or
outbound message. If any post-disable write smoke fails, immediately inspect
pause status and re-enable it while the forward fix is prepared.

## Failure and recovery posture

Before schema apply, any failed assertion is a clean stop. After the first
migration commits, there is no one-command rollback:

- leave writes paused;
- preserve the failed command, ledger, verifier, Vercel, and smoke output;
- identify the last committed migration;
- use the rehearsed forward-fix procedure or a coordinated database recovery
  plus compatible application deployment; and
- require the same parity and verification gates again before reopening.

After `20260709120000` and `20260709130000`, a Vercel-only rollback to the old
application is unsafe because old routes lose browser mutation privileges. Do
not run `vercel rollback`, repoint the production alias, revert only the merge,
or use `supabase migration repair` as a schema rollback unless an incident
commander has first proved application/schema compatibility and approved the
paired recovery. The old deployment URL is evidence, not an automatic rollback
target.

Keep the database recovery point until the post-release observation window is
closed. Preserve `BUNDLE_MANIFEST`, `FULL_REHEARSAL_DIR`, and
`FAILURE_REHEARSAL_DIR` with the release ticket. Then remove only the temporary
detached worktree; do not remove `RELEASE_ROOT` until those artifacts are safely
archived:

```bash
git -C "$REPO_ROOT" worktree remove "$RELEASE_WT"
```

## Release receipt

Record all of the following in the release ticket:

- prerequisite migration and deployment receipts (`010900`, `090000`,
  `091000`);
- production-clone backup date, rehearsal result, timing, and partial-failure
  drill;
- `REVIEWED_BASE_SHA`, `RELEASE_SHA`, bundle manifest, and successful check
  URLs;
- write-pause enable actor, reason, timestamp, and `safe_to_migrate` proof;
- schema apply start/end, first/last applied versions, and all verifier output;
- `MAIN_SHA`, ancestry/tree proof, Vercel deployment ID/URL, and alias proof;
- hosted parity run URL and non-money smoke evidence; and
- write-pause disable/deferred-webhook-drain result and final go decision.
