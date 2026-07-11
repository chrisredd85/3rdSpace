# Hosted migration parity: plan supply intents

## Purpose and fixed inputs

Production deployment `461e3da4e569a41d27c6e972fc467ef3ba042d17`
contains `20260701090000_add_plan_supply_intents.sql`, but the hosted migration
ledger was observed only through `20260627000000`. The deployed commit does not
contain the later parity checker or verifier scripts. Therefore this procedure
uses two immutable worktrees:

- `PROD_WT` at the exact deployed SHA supplies the migration inventory that
  production code was built against.
- `TOOLS_WT` at reviewed SHA
  `add2241e57e495294db5cc67916774edc5980d39` supplies the parity and verification
  tools.

The migration blob must be byte-identical in both worktrees. Its reviewed
SHA-256 is:

```text
823f3f3989bc2624af0c45bf1974c658a3eabda83f627e5d9d800351e17d5e41
```

The discovery refresh writer used `google_places_refresh`, while the existing
`discovery_change_source_check` constraint accepts `places_refresh`. The schema
defines the canonical vocabulary, so the application writer is corrected to
`places_refresh`; the constraint is not widened to preserve an accidental
second name.

This is a schema-first release, not a merge-and-wait release. Phase 1 applies
and verifies the already-deployed migration without merging application code.
The corrected refresh writer is deployed only in the later reviewed application
release, after its required schemas are present.

## Roles and secrets

The production database operator needs values supplied by the production
password manager. Do not paste their values into tickets, shell tracing, or
release logs.

```bash
: "${SUPABASE_ACCESS_TOKEN:?missing SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?missing SUPABASE_PROJECT_REF}"
: "${SUPABASE_DB_PASSWORD:?missing SUPABASE_DB_PASSWORD}"
: "${SUPABASE_DB_URL:?missing SUPABASE_DB_URL}"
```

`SUPABASE_ACCESS_TOKEN` is a Supabase CLI access token, not a browser/API key.
`SUPABASE_DB_PASSWORD` is the production Postgres password, not the service-role
key.

An authorized GitHub repository administrator must also configure the three
repository-level Actions secrets used by the post-deploy parity workflow:

```bash
export GITHUB_REPOSITORY='chrisredd85/3rdSpace'

printf '%s' "$SUPABASE_ACCESS_TOKEN" |
  gh secret set SUPABASE_ACCESS_TOKEN --repo "$GITHUB_REPOSITORY" --app actions
printf '%s' "$SUPABASE_PROJECT_REF" |
  gh secret set SUPABASE_PROJECT_REF --repo "$GITHUB_REPOSITORY" --app actions
printf '%s' "$SUPABASE_DB_PASSWORD" |
  gh secret set SUPABASE_DB_PASSWORD --repo "$GITHUB_REPOSITORY" --app actions

gh secret list --repo "$GITHUB_REPOSITORY" --app actions
```

The list must show all three names with current timestamps. GitHub does not
permit reading the values back; successful linked parity later proves that the
credentials are valid. Do not substitute a browser key, session key, or service
role key.

## Build the two pinned worktrees

Run from any clean checkout of `chrisredd85/3rdSpace` with `git`, `gh`, `npm`,
`supabase`, `psql`, `shasum`, and `jq` installed:

```bash
export GITHUB_REPOSITORY='chrisredd85/3rdSpace'
export PROD_SHA='461e3da4e569a41d27c6e972fc467ef3ba042d17'
export TOOLS_SHA='add2241e57e495294db5cc67916774edc5980d39'
export PLAN_SUPPLY_MIGRATION='supabase/migrations/20260701090000_add_plan_supply_intents.sql'
export PLAN_SUPPLY_SHA256='823f3f3989bc2624af0c45bf1974c658a3eabda83f627e5d9d800351e17d5e41'
export REPO_ROOT="$(git rev-parse --show-toplevel)"
export RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/3rdplace-plan-supply.XXXXXX")"
export PROD_WT="$RELEASE_ROOT/production"
export TOOLS_WT="$RELEASE_ROOT/tools"

git -C "$REPO_ROOT" fetch origin --prune
git -C "$REPO_ROOT" cat-file -e "${PROD_SHA}^{commit}"
git -C "$REPO_ROOT" cat-file -e "${TOOLS_SHA}^{commit}"
git -C "$REPO_ROOT" worktree add --detach "$PROD_WT" "$PROD_SHA"
git -C "$REPO_ROOT" worktree add --detach "$TOOLS_WT" "$TOOLS_SHA"

test "$(git -C "$PROD_WT" rev-parse HEAD)" = "$PROD_SHA"
test "$(git -C "$TOOLS_WT" rev-parse HEAD)" = "$TOOLS_SHA"
test -z "$(git -C "$PROD_WT" status --porcelain --untracked-files=all)"
test -z "$(git -C "$TOOLS_WT" status --porcelain --untracked-files=all)"

test -f "$TOOLS_WT/scripts/release/check-migration-parity.ts"
test -f "$TOOLS_WT/scripts/release/verify-plan-supply-intents.sql"
test -f "$TOOLS_WT/scripts/security/verify-hosted-control-plane.sql"
test -f "$TOOLS_WT/scripts/security/verify-hosted-acls.sql"

test "$(shasum -a 256 "$PROD_WT/$PLAN_SUPPLY_MIGRATION" | awk '{print $1}')" = "$PLAN_SUPPLY_SHA256"
test "$(shasum -a 256 "$TOOLS_WT/$PLAN_SUPPLY_MIGRATION" | awk '{print $1}')" = "$PLAN_SUPPLY_SHA256"
cmp -s "$PROD_WT/$PLAN_SUPPLY_MIGRATION" "$TOOLS_WT/$PLAN_SUPPLY_MIGRATION"
```

Prove that the pinned production SHA is still the latest successful GitHub
production deployment. If either assertion fails, production moved; stop and
prepare a new reviewed runbook rather than changing `PROD_SHA` ad hoc.

```bash
export PROD_DEPLOYMENT_ID="$(
  gh api "repos/$GITHUB_REPOSITORY/deployments?environment=Production&per_page=1" \
    --jq '.[0].id'
)"

test "$(gh api "repos/$GITHUB_REPOSITORY/deployments/$PROD_DEPLOYMENT_ID" --jq .sha)" = "$PROD_SHA"
test "$(gh api "repos/$GITHUB_REPOSITORY/deployments/$PROD_DEPLOYMENT_ID/statuses" --jq '.[0].state')" = 'success'
```

Install the reviewed tooling and link the deployed-inventory worktree to the
hosted project. Linking writes only ignored local Supabase metadata.

```bash
npm --prefix "$TOOLS_WT" ci

(
  cd "$PROD_WT"
  supabase link \
    --project-ref "$SUPABASE_PROJECT_REF" \
    --password "$SUPABASE_DB_PASSWORD"
)
```

Do not run `scripts/release/preflight-hosted-migration.sh` from `PROD_WT`; that
script does not exist at the deployed SHA. The commands below deliberately run
the reviewed checker from `TOOLS_WT` with `--root "$PROD_WT"`.

## Read-only preflight

```bash
(
  cd "$TOOLS_WT"
  npm run release:migrations:parity -- \
    --root "$PROD_WT" \
    --linked \
    --expect-missing 20260701090000
)

(
  cd "$PROD_WT"
  supabase db push \
    --linked \
    --password "$SUPABASE_DB_PASSWORD" \
    --dry-run
)
```

Required outcomes:

- parity prints `Missing remotely: 20260701090000` and
  `Preflight passed: drift is limited to the explicitly expected migration list.`;
- the dry run lists only
  `20260701090000_add_plan_supply_intents.sql`; and
- no remote-only or additional missing version appears.

Stop if any result differs. Do not use `--include-all`.

## Phase 1: apply schema, then verify

Immediately before applying, repeat the immutable inputs and the dry run:

```bash
test "$(git -C "$PROD_WT" rev-parse HEAD)" = "$PROD_SHA"
test "$(git -C "$TOOLS_WT" rev-parse HEAD)" = "$TOOLS_SHA"
test -z "$(git -C "$PROD_WT" status --porcelain --untracked-files=all)"
test -z "$(git -C "$TOOLS_WT" status --porcelain --untracked-files=all)"
test "$(shasum -a 256 "$PROD_WT/$PLAN_SUPPLY_MIGRATION" | awk '{print $1}')" = "$PLAN_SUPPLY_SHA256"
test "$(shasum -a 256 "$TOOLS_WT/$PLAN_SUPPLY_MIGRATION" | awk '{print $1}')" = "$PLAN_SUPPLY_SHA256"
cmp -s "$PROD_WT/$PLAN_SUPPLY_MIGRATION" "$TOOLS_WT/$PLAN_SUPPLY_MIGRATION"

(
  cd "$PROD_WT"
  supabase db push \
    --linked \
    --password "$SUPABASE_DB_PASSWORD" \
    --dry-run
  supabase db push \
    --linked \
    --password "$SUPABASE_DB_PASSWORD"
)
```

Do not merge application code during this phase. After the push:

```bash
(
  cd "$TOOLS_WT"
  npm run release:migrations:parity -- \
    --root "$PROD_WT" \
    --linked
)

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f "$TOOLS_WT/scripts/release/verify-plan-supply-intents.sql"
```

Parity must print
`Migration parity passed: deployed code and hosted ledger match exactly.` The
SQL verifier must return version `20260701090000`, RLS enabled, five policies,
and two indexes.

## Phase 2: deploy the reviewed application tree

The corrected discovery writer is released with the later application candidate,
not by altering this pinned production worktree. Applying the schema first makes
that later code deployment safe. Merging its PR causes Vercel to deploy the new
`main` merge commit, not the PR head SHA. The release operator must preserve the
reviewed head as an ancestor and prove the two trees are identical:

```bash
export APPLICATION_PR='204'
export REVIEWED_HEAD_SHA="$(
  gh pr view "$APPLICATION_PR" --repo "$GITHUB_REPOSITORY" \
    --json headRefOid --jq .headRefOid
)"
export REVIEWED_BASE_SHA="$(
  gh pr view "$APPLICATION_PR" --repo "$GITHUB_REPOSITORY" \
    --json baseRefOid --jq .baseRefOid
)"

test "$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)" = "$REVIEWED_BASE_SHA"

gh pr merge "$APPLICATION_PR" \
  --repo "$GITHUB_REPOSITORY" \
  --merge \
  --match-head-commit "$REVIEWED_HEAD_SHA"

git -C "$REPO_ROOT" fetch origin --prune
export MAIN_SHA="$(git -C "$REPO_ROOT" rev-parse origin/main)"
git -C "$REPO_ROOT" merge-base --is-ancestor "$REVIEWED_HEAD_SHA" "$MAIN_SHA"
git -C "$REPO_ROOT" diff --quiet "$REVIEWED_HEAD_SHA" "$MAIN_SHA" --
```

Do not execute that merge until the separate purchase-race migration and the
full Prompts 1–8 coordinated-release runbook are ready. If a literal production
commit SHA equal to the PR head is required, a normal GitHub merge commit cannot
provide it; that requires a separately reviewed fast-forward/deployment process.

After the corrected worker is live, invoke the normal authenticated discovery
cron once and verify:

1. the response contains no `change_log_insert_failed` entry;
2. a changed entity writes `discovery_change_log.source = 'places_refresh'`;
3. Sentry has an issue alert for message `discovery_change_log_constraint` with
   tag `alert_class:discovery_change_log_constraint`; and
4. the test alert is emitted through a safe test path, never by deliberately
   violating a production constraint.

## Relationship to the 23-migration release

This incident migration is additive and does not itself need the later
server-owned-control-plane maintenance window. Before applying migrations
`20260709110000` through `20260709178000`, the write-pause mechanism must already
be deployed and verified. Follow `docs/runbooks/write-pause.md` and use
`scripts/release/toggle-write-pause.sh` from that release's pinned worktree.

The coordinated release must run all three hosted verifiers after its schema
phase:

- `scripts/release/verify-plan-supply-intents.sql`;
- `scripts/security/verify-hosted-control-plane.sql`; and
- `scripts/security/verify-hosted-acls.sql`.

Only the first verifier is valid immediately after this isolated incident
migration; the latter two validate migrations `20260709120000` and
`20260709130000` and therefore run during the later coordinated release.

Its production-clone rehearsal must test the frozen pre-bundle
`REVIEWED_BASE_SHA` after PR #203 and the write-pause prerequisite are deployed.
Historical incident SHA `461e3da…` is the correct inventory for this isolated
`20260701090000` repair, but it is not the old-code compatibility target for the
later 23-file bundle.

## Failure posture

Before the apply command, any failed assertion is a clean stop. After apply,
never edit or rename the recorded migration and never use migration-history
repair as a schema rollback. Leave the additive schema in place and correct
forward through a new reviewed migration if needed.

For the later 23-migration bundle, there is no one-command rollback. Once
`20260709120000` and `20260709130000` remove browser write privileges, rolling
Vercel back to old code alone is unsafe. A production-clone rehearsal, durable
write pause, database recovery point, and reviewed forward fix are the required
safety controls.

When the incident is closed, remove the temporary worktrees without deleting
any branch:

```bash
git -C "$REPO_ROOT" worktree remove "$PROD_WT"
git -C "$REPO_ROOT" worktree remove "$TOOLS_WT"
rmdir "$RELEASE_ROOT"
```
