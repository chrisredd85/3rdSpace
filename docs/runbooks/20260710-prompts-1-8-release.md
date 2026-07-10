# Prompts 1–8 coordinated release

Prompts 1–8 change application code and the database control plane together.
They must not be released by merging `main` and hoping the hosted migrations
catch up afterward. The Vercel project promotes `main` automatically, while the
hosted Supabase migration ledger was observed only through `20260627000000`.
At that observation point, `origin/main` and production were still on
`461e3da`; none of Prompts 1–8 were in main. The deployed application already
expects `20260701090000_add_plan_supply_intents.sql`, so the hosted ledger is
behind even before the Prompt 1–8 branch migration bundle is considered.

This runbook is deliberately non-mutating until the **Apply** section. Applying
hosted migrations, changing GitHub secrets or rulesets, pausing production, and
merging the release require explicit operator authorization. This document is
not that authorization.

## Release scope truth

The July 9 Prompt 7 and Prompt 8 handoffs are historical checkpoints, not the
current completion verdict. The July 10 verification found gaps in exact
booking/action/approval/partner provenance, immutable canonical terms, atomic
partner and external-checkout responses, materialization recovery, safe quote
re-approval, and canonical analytics/rebook/template readers. Corrections are
present in the current worktree through the reviewed
`20260709178000_make_canonical_venue_confirmation_effects_replayable.sql`
migration, but they remain a release candidate until the final receipt below
is filled from a clean tree.
See `qa-artifacts/5k-readiness-prompts7-8-verification-2026-07-10.md` for the
gap-to-proof matrix.

Prompt 9 owns controlled-payment provider execution, canonical transaction
bootstrap, Stripe capture, reconciliation, and payment cancellation. Prompts
1–8 expose only an approval-gated integer-cent payment proposal and must not
call Stripe or move money. Prompts 9–18 remain pending, so this coordinated
release is not by itself the full 5,000-user readiness program.

## Stop conditions

Stop the release if any of these are true:

- the Prompt 1 incident migration `20260701090000` has not been applied and
  verified first from the currently deployed commit;
- the separate purchase-race migration `20260709090000` has not been assigned
  an explicit release order;
- the dry run lists a migration outside the reviewed release inventory;
- the production control-plane preflight reports contradictory historical
  approvals, actions, payments, or settlements;
- the release commit has not passed the clean-reset, realized database,
  security, full test, lint, type, build, and browser smoke gates;
- the ready pull request does not have successful GitHub and Vercel checks; or
- no coordinated schema/code window has been approved.

Do not use `--include-all` to paper over the purchase-race migration ordering
decision. Either release that branch's earlier migration first or have its
owner intentionally renumber and reverify it.

## 1. Close the already-deployed Prompt 1 schema gap

Follow
[`20260701090000-plan-supply-intents-release.md`](./20260701090000-plan-supply-intents-release.md)
from the exact production SHA. Its preflight intentionally requires
`20260701090000_add_plan_supply_intents.sql` to be the only gap. Complete its
post-apply SQL verification before continuing.

## 2. Resolve the purchase-race migration order

Draft PR #203 on `codex/payment-capture-race-hardening` currently owns
`20260709090000_add_payment_intents_capturing_status.sql`, which sorts before
this release's `20260709110000+` migrations. Preserve that work as a separate
review surface, but decide one of these before applying Prompts 1–8:

1. release and verify the purchase-race migration/PR first; or
2. have its owning task renumber it after this release and rerun its clean
   database and concurrency gates.

Do not copy or silently rewrite that migration from this branch.

## 3. Prepare the exact release commit

From the clean Prompt 1–8 worktree:

```bash
git fetch origin --prune
git status --short
git rev-list --left-right --count origin/main...HEAD
npm ci
supabase db reset
npm run db:types
supabase db lint --local --fail-on error
npm run type-check
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Run every opt-in realized database/security suite recorded in the Prompt 1–8
verification report separately; the ordinary Jest command intentionally skips
those unless their `RUN_*_DB_TESTS` variables are enabled.

Commit, push, and open a ready pull request. Wait for all required checks and
the Vercel preview. Record the immutable release SHA.

Release receipt (root fills after the final tree is verified):

- Final release commit: **PENDING_ROOT_FINAL_GATE**
- Clean reset and all local gates: **PASS** through `20260709178000`; 12
  realized suites / 297 tests, 301 ordinary suites / 1,845 tests, type-check,
  lint, RLS, tied-house, dependency threshold, outreach eval, optimized build,
  and 26 Chromium tests passed
- Ready pull request: **PENDING_ROOT_FINAL_GATE**
- GitHub checks and Vercel preview: **PENDING_ROOT_FINAL_GATE**
- Operator-approved schema/code window: **PENDING_OPERATOR_AUTHORIZATION**

## 4. Hosted read-only preflight

Provide Supabase credentials from the production password manager without
printing them. From the exact release SHA:

```bash
supabase link \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --password "$SUPABASE_DB_PASSWORD"

supabase migration list --linked
supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --dry-run

psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/preflight-server-owned-execution.sql
```

Review the dry-run inventory against the committed files. After the earlier two
migration decisions are resolved, the Prompt 1–8 inventory begins at
`20260709110000_repair_p0_stored_functions.sql` and ends at the highest reviewed
Prompt 7/8 hardening migration,
`20260709178000_make_canonical_venue_confirmation_effects_replayable.sql`, in
the release commit. Any additional or missing file is a stop condition.

## 5. Apply in a coordinated schema/code window

Migration `20260709130000_server_owned_execution_control_plane.sql` removes
browser mutation rights that the new server routes replace. Applying the schema
well before the code can break old write paths; deploying the code before the
schema can make new columns and RPCs unavailable. Use an approved maintenance or
write-pause window, or another explicitly reviewed blue/green procedure.

Immediately before the mutation, repeat the linked migration list, dry run, and
control-plane preflight. Then an authorized operator runs:

```bash
supabase db push \
  --linked \
  --password "$SUPABASE_DB_PASSWORD"
```

Do not edit the checkout between the final dry run and apply. When the push
finishes, merge/promote the exact reviewed release SHA without adding commits.

## 6. Post-apply and production proof

Before reopening write traffic, verify:

```bash
npm run release:migrations:parity -- --linked
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/release/verify-plan-supply-intents.sql
psql "$SUPABASE_DB_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/security/verify-hosted-acls.sql
```

Then prove the deployed SHA and production alias, and smoke the following with
non-money test data:

- health and authenticated planner load;
- plan creation, explicit approval, canonical materialization, and analytics
  deep link;
- external checkout handoff without automatic navigation;
- concierge task creation only after approval;
- canonical partner confirm and decline, including visible host evidence;
- retry/re-approval without a duplicate side effect; and
- the discovery refresh recurrence and Sentry alert required by Prompt 1.

Do not execute a real Stripe payment or outbound message as a smoke test.

## 7. Required repository controls

The hosted parity workflow fails closed unless GitHub Actions has
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD`.
Configure those from the password manager and require `RLS Checks / rls` plus
the normal test/build checks on `main`. Secret and ruleset changes are separate
operator-owned mutations; merely committing the workflows does not enforce
them.
