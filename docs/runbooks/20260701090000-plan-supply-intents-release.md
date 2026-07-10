# Hosted migration parity: plan supply intents

## Incident decision

The discovery refresh writer used `google_places_refresh`, while the original
`discovery_change_source_check` constraint allows `places_refresh`. The schema
already defines the canonical vocabulary used by the change log, so the writer
is corrected to `places_refresh`; widening the constraint would preserve an
accidental second name for the same source.

Production deployment `461e3da4e569a41d27c6e972fc467ef3ba042d17`
contains `20260701090000_add_plan_supply_intents.sql`, but the hosted ledger was
observed only through `20260627000000`. The commands below intentionally require
the operator to check out the deployed commit and prove that this is the only
missing migration.

## Required operator environment

Use a shell where these values are provided by the production password manager;
do not paste their values into tickets or logs.

```bash
export SUPABASE_ACCESS_TOKEN='...'
export SUPABASE_PROJECT_REF='...'
export SUPABASE_DB_PASSWORD='...'
export SUPABASE_DB_URL='postgresql://...'
export DEPLOYED_SHA='461e3da4e569a41d27c6e972fc467ef3ba042d17'
```

## One-time GitHub Actions secret setup

The post-deploy parity workflow fails closed unless all three Supabase secrets
exist in GitHub Actions. An authorized repository operator can provision them
from the password-manager-backed shell above without printing their values:

```bash
printf '%s' "$SUPABASE_ACCESS_TOKEN" | gh secret set SUPABASE_ACCESS_TOKEN
printf '%s' "$SUPABASE_PROJECT_REF" | gh secret set SUPABASE_PROJECT_REF
printf '%s' "$SUPABASE_DB_PASSWORD" | gh secret set SUPABASE_DB_PASSWORD
gh secret list --app actions
```

Do not reuse a browser/session key as the access token or service-role key as
the database password. Secret creation is an operator-owned GitHub mutation;
the implementation agent does not perform it as part of the read-only hosted
migration runbook.

## Pre-flight: no mutation

```bash
git fetch origin --prune
git switch --detach "$DEPLOYED_SHA"
npm ci
./scripts/release/preflight-hosted-migration.sh 20260701090000
```

The preflight fails unless the checked-out SHA matches production, migration
files are unmodified, and `20260701090000` is the exact and only hosted-ledger
gap. Its final `supabase db push --dry-run` must list only
`20260701090000_add_plan_supply_intents.sql`.

## Apply: operator-owned mutation

After reviewing the dry-run output:

```bash
supabase db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD"
```

Do not use `--include-all` for this incident. The preflight must be rerun if the
deployed SHA or ledger changes before apply.

## Post-apply verification

```bash
npm run release:migrations:parity -- --linked
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/release/verify-plan-supply-intents.sql
```

Both commands must pass. The SQL proves the ledger entry, table, RLS state,
policies, and indexes exist on the same hosted database.

## Discovery recurrence verification

After the corrected worker is deployed, invoke the normal authenticated cron
once and verify:

1. The response has no `change_log_insert_failed` entries.
2. A changed entity writes `discovery_change_log.source = 'places_refresh'`.
3. Sentry has an issue alert for message `discovery_change_log_constraint` with
   tag `alert_class:discovery_change_log_constraint`. Send a test event to that
   rule before closing the incident; the code emits on the first PostgreSQL
   integrity/constraint error rather than waiting for a count threshold.

Do not deliberately violate the production constraint to test the alert.
