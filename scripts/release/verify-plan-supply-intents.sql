\set ON_ERROR_STOP on

DO $$
DECLARE
  migration_present BOOLEAN;
  rls_enabled BOOLEAN;
  policy_count INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version::text = '20260701090000'
  ) INTO migration_present;

  IF NOT migration_present THEN
    RAISE EXCEPTION 'Migration 20260701090000 is absent from the hosted ledger';
  END IF;

  IF to_regclass('public.plan_supply_intents') IS NULL THEN
    RAISE EXCEPTION 'public.plan_supply_intents does not exist';
  END IF;

  SELECT c.relrowsecurity
  INTO rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'plan_supply_intents';

  IF NOT COALESCE(rls_enabled, false) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.plan_supply_intents';
  END IF;

  SELECT count(*)
  INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'plan_supply_intents';

  IF policy_count < 5 THEN
    RAISE EXCEPTION 'Expected at least 5 policies on plan_supply_intents, found %', policy_count;
  END IF;
END
$$;

SELECT
  sm.version,
  c.relrowsecurity AS rls_enabled,
  (
    SELECT count(*)
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'plan_supply_intents'
  ) AS policy_count,
  (
    SELECT count(*)
    FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.tablename = 'plan_supply_intents'
  ) AS index_count
FROM supabase_migrations.schema_migrations sm
JOIN pg_class c ON c.oid = 'public.plan_supply_intents'::regclass
WHERE sm.version::text = '20260701090000';
