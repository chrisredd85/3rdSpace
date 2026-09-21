\set ON_ERROR_STOP on

DO $$
DECLARE
  migration_present BOOLEAN;
  rls_enabled BOOLEAN;
  policy_count INTEGER;
  missing_policies TEXT[];
  unexpected_policies TEXT[];
  missing_indexes TEXT[];
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

  SELECT array_agg(required.policy_name ORDER BY required.policy_name)
  INTO missing_policies
  FROM unnest(ARRAY[
    'Plan owners can read supply intents',
    'Plan owners can create supply intents',
    'Plan owners can update supply intents',
    'Plan owners can delete supply intents',
    'Service role can manage supply intents'
  ]) required(policy_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'plan_supply_intents'
      AND p.policyname = required.policy_name
  );

  SELECT array_agg(p.policyname ORDER BY p.policyname)
  INTO unexpected_policies
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'plan_supply_intents'
    AND p.policyname <> ALL (ARRAY[
      'Plan owners can read supply intents',
      'Plan owners can create supply intents',
      'Plan owners can update supply intents',
      'Plan owners can delete supply intents',
      'Service role can manage supply intents'
    ]);

  IF policy_count <> 5 OR missing_policies IS NOT NULL OR unexpected_policies IS NOT NULL THEN
    RAISE EXCEPTION
      'Supply-intent policy mismatch: count=%, missing=%, unexpected=%',
      policy_count,
      COALESCE(missing_policies, '{}'::TEXT[]),
      COALESCE(unexpected_policies, '{}'::TEXT[]);
  END IF;

  SELECT array_agg(required.index_name ORDER BY required.index_name)
  INTO missing_indexes
  FROM unnest(ARRAY[
    'idx_plan_supply_intents_unique_active',
    'idx_plan_supply_intents_plan'
  ]) required(index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'plan_supply_intents'
      AND i.indexname = required.index_name
  );

  IF missing_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required plan_supply_intents indexes: %', missing_indexes;
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
