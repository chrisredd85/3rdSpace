## Summary

Ships the Phase 5 outreach/discovery schema only:

- 5 new Supabase migrations from the phase-5 branch
- Regenerated database types for the new tables
- No app code reads or writes these tables in this PR

This PR is intentionally inert from a product-behavior perspective. The code paths that use these tables land later in PR 3c and must enforce the approval-gated outreach model then.

## Scope

Included files:

- `supabase/migrations/20260601000000_add_creator_gmail_outreach_loop.sql`
- `supabase/migrations/20260601000001_add_discovery_venues.sql`
- `supabase/migrations/20260601000002_add_multichannel_outreach.sql`
- `supabase/migrations/20260601000003_add_outreach_autonomy_policy.sql`
- `supabase/migrations/20260601000004_add_supply_scout_leads.sql`
- `lib/types/database-generated.ts`

No application routes, jobs, agents, UI, package scripts, package dependencies, or env docs are changed.

## Migrations

- `20260601000000_add_creator_gmail_outreach_loop.sql`: adds `creator_email_accounts`, `outreach_threads`, and `outreach_messages` for the creator-approved Gmail outreach loop.
- `20260601000001_add_discovery_venues.sql`: adds `discovery_venues`, `discovery_venue_signals`, and `discovery_venue_events`; extends new `outreach_threads` with discovery-target columns.
- `20260601000002_add_multichannel_outreach.sql`: adds `creator_phone_numbers`, `venue_contact_profiles`, and `outreach_compliance_events`; extends new outreach tables with provider/channel metadata.
- `20260601000003_add_outreach_autonomy_policy.sql`: adds `creator_outreach_policies`, `outreach_notifications`, `outreach_policy_audit_logs`, and `creator_outreach_trust_history`; extends new outreach tables with autonomy-gate metadata.
- `20260601000004_add_supply_scout_leads.sql`: adds `supply_scout_venue_leads` for the admin-only supply-scout staging queue.

## RLS Posture

Every new table has RLS enabled and at least one policy.

- `creator_email_accounts`: creator can view/create/update own rows; service role can manage.
- `outreach_threads`: creator can view/create/update own rows; service role can manage.
- `outreach_messages`: creator can view/create/update own rows; service role can manage.
- `discovery_venues`: authenticated users can read; service role can manage.
- `discovery_venue_signals`: authenticated users can read; service role can manage.
- `discovery_venue_events`: service role can manage.
- `creator_phone_numbers`: creator can view own rows; service role can manage.
- `venue_contact_profiles`: authenticated users can read; service role can manage.
- `outreach_compliance_events`: service role can manage.
- `creator_outreach_policies`: creator can view/create/update own rows; service role can manage.
- `outreach_notifications`: creator can view/update own rows; service role can manage.
- `outreach_policy_audit_logs`: creator can view own rows; service role can manage.
- `creator_outreach_trust_history`: creator can view own rows; service role can manage.
- `supply_scout_venue_leads`: service role can manage.

No storage buckets are added in these migrations.

## Migration Fix: 20260601000001 Search Index

This PR is not a verbatim copy of the phase-5 source branch.

The source migration had this expression inside `idx_discovery_venues_search`:

```sql
coalesce(name, '') || ' ' || coalesce(neighborhood, '') || ' ' || array_to_string(vibe_tags, ' ')
```

A fresh `supabase db reset` failed because Postgres requires every function inside an index expression to be marked `IMMUTABLE`, and `array_to_string` is not marked immutable. The narrowed fix removes the redundant `array_to_string(vibe_tags, ' ')` term and keeps the full-text index on scalar text columns:

```sql
coalesce(name, '') || ' ' || coalesce(neighborhood, '')
```

Vibe-tag search remains covered by the separate GIN index:

```sql
idx_discovery_venues_vibe_tags ON public.discovery_venues USING gin(vibe_tags)
```

After reset, both `idx_discovery_venues_search` and `idx_discovery_venues_vibe_tags` exist. A forced `EXPLAIN` confirmed `vibe_tags && ARRAY[...]` can use `idx_discovery_venues_vibe_tags`.

The phase-5 source branch shipped a migration that would not apply cleanly from scratch. That suggests a follow-up investigation is warranted: either Supabase migrations were not being run end-to-end against the accidentally-promoted preview deployment, or the hosted state skipped this migration path. This is not a blocker for this PR because the narrowed migration has now been corrected and verified from a clean reset.

## Date Ordering

These migrations are dated `20260601*`, while current main already has migrations through `20260602000009`.

Fresh local reset applies the files in timestamp order: `20260601*` first, then `20260602*`. That path now passes.

On an already-migrated environment where `20260602*` has run, these five `20260601*` files will be newly applied after the existing later migrations. That is safe for this PR because the new migrations reference only existing current-main tables or other tables created inside this same five-migration set, and no `20260602*` migration requires these tables.

## Database Types

`npm run db:types` was run after a clean local reset. The raw local generator output included unrelated drift because the local reset database does not expose the public PostGIS type sections that are currently present in `origin/main`'s generated types.

To keep this PR schema-scoped and reviewable, the final `lib/types/database-generated.ts` diff preserves current main and adds only the regenerated definitions for the 14 new Phase 5 tables. No existing table/function/view type sections are removed.

## Approval-Gate Invariant

Untouched. This PR introduces no app code paths, no jobs, no agent execution, no outbound send path, no booking path, and no payment path.

PR 3c is where code begins to read/write these tables. That later PR must enforce the product rule: the agent may plan, draft, and coordinate, but no outbound message, booking, or payment executes without explicit approval or a host-configured outreach autonomy policy.

## Rollback

Because no code writes to these tables yet, rollback is straightforward before PR 3c:

- Drop the 14 new tables and their indexes/policies/triggers.
- Remove the `target_source`, `discovery_venue_id`, provider/channel, and autonomy metadata columns from the new outreach tables if rolling back partially.
- Revert the generated database type additions.

No product data should depend on these tables until later code-path PRs land.

## Audience Impact

Zero real-user impact. These are inert schema additions with no UI, route, job, or agent behavior attached in this PR.

## Validation

- `supabase db reset`: passed after narrowing `idx_discovery_venues_search`.
- Index spot-check: `idx_discovery_venues_search` and `idx_discovery_venues_vibe_tags` both exist.
- Vibe-tag query spot-check: forced `EXPLAIN` uses `idx_discovery_venues_vibe_tags`.
- `npm run db:types`: passed; final type diff is additive-only for the 14 new tables.
- `npm install`: passed; npm reported existing audit findings.
- `npm run type-check`: passed.
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand`: passed, 9 tests.
- `npm run security:rls`: passed.
- `npm test`: passed, 93 suites passed, 1 skipped; 564 tests passed, 9 skipped. Jest reported the existing worker-teardown warning.
- `npm run lint`: passed with existing React hook dependency warnings.
- `npm run build`: first run failed because this fresh worktree had no Supabase env vars; re-run with local Supabase env from `supabase status` passed.
- Dev smoke with local Supabase env: `/api/health` returned `{"status":"ok"}` with 200; `/planner` returned 200 and rendered the planner HTML.
- Pre-commit Husky hook bypassed via `--no-verify` per explicit user authorization. The hook's full Jest suite was flaking in parallel on `venue-payouts-rental-ui.test.tsx`; same test passes in `--runInBand`. The full Jest suite ran clean once during validation. Defer to GitHub CI as the authoritative test gate. Flake tracked separately.
