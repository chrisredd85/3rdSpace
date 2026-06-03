## Summary

Schema-only alignment PR for `discovery_venues` search.

Production currently has `idx_discovery_venues_search` built through an immutable helper function:

```sql
public.discovery_venues_search_document(
  venue_name text,
  venue_neighborhood text,
  venue_vibe_tags text[]
) RETURNS text
```

This PR brings fresh local/staging schemas back into that same shape so vibe-tag text remains part of the full-text search document.

## Why This Drift Exists

PR #22 narrowed `idx_discovery_venues_search` because the original migration used `array_to_string(vibe_tags, ' ')` directly inside the indexed `to_tsvector(...)` expression. Postgres requires every function inside an index expression to be marked `IMMUTABLE`, and `array_to_string` is not.

Production had already been hand-patched with the better approach: move the array conversion into an immutable helper function, then index `to_tsvector(...)` over that helper output. We missed that production-side repair during the PR #22 narrowing.

## Prod Signature Verification

Before writing this migration, production was queried with:

```sql
SELECT pg_get_functiondef('public.discovery_venues_search_document(text,text,text[])'::regprocedure);
```

Verified production definition:

```sql
CREATE OR REPLACE FUNCTION public.discovery_venues_search_document(
  venue_name text,
  venue_neighborhood text,
  venue_vibe_tags text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT concat_ws(' ', venue_name, venue_neighborhood, array_to_string(venue_vibe_tags, ' '));
$function$;
```

This PR matches that exact function signature and return type. The index also matches production by wrapping the helper result with:

```sql
to_tsvector('english'::regconfig, discovery_venues_search_document(name, neighborhood, vibe_tags))
```

## Changes

- Adds migration `20260603000000_align_discovery_venues_search_index_with_prod.sql`
- Creates/replaces `public.discovery_venues_search_document(text,text,text[])`
- Drops and recreates `idx_discovery_venues_search` using the helper-backed expression
- Keeps `idx_discovery_venues_vibe_tags` unchanged
- Adds the generated DB type for the helper function only

## Safety

Fresh installs now match production. Production already has this helper and equivalent index, so the migration is effectively an idempotent alignment: `CREATE OR REPLACE FUNCTION`, then drop/recreate the same index shape.

Audience impact: zero. This is schema-only and preserves current production behavior.

## Rollback

If needed:

1. Drop `idx_discovery_venues_search`
2. Drop `public.discovery_venues_search_document(text,text,text[])`
3. Recreate the narrowed PR #22 index on `to_tsvector('english', coalesce(name, '') || ' ' || coalesce(neighborhood, ''))`

That rollback would remove vibe-tag text from the full-text search path, while the separate `idx_discovery_venues_vibe_tags` GIN index would continue to support array-overlap tag filtering.

## Validation

- `supabase db reset` passed with `20260603000000_align_discovery_venues_search_index_with_prod.sql` applied
- Verified local `pg_get_functiondef(...)` matches production signature/body
- Verified both indexes exist after reset:
  - `idx_discovery_venues_search`
  - `idx_discovery_venues_vibe_tags`
- Verified a sample `tsquery` against `discovery_venues_search_document(...)` runs successfully
- Verified `EXPLAIN` uses `Bitmap Index Scan on idx_discovery_venues_search`
- `npm run type-check` passed
- `RUN_RLS_DB_TESTS=1 npm test -- __tests__/security/rls.test.ts --runInBand` passed: 9 tests
- `npm run security:rls` passed
- `npm run lint` passed with existing hook dependency warnings only
- `npm run build` passed with local Supabase env values sourced from `supabase status -o env`
- Pre-commit Husky hook bypassed via `--no-verify` per explicit user authorization. The hook's full Jest suite was flaking in parallel on `__tests__/integration/venue-payouts-rental-ui.test.tsx`; the same test passes in isolation with `--runInBand`. The hook run reached 92 passed, 1 skipped, 1 failed-on-timeout suite before exiting. Defer to GitHub CI as the authoritative merge gate.
