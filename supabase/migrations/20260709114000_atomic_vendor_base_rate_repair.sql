-- Atomically reconcile a legacy vendor base rate and append its audit record.
-- This intentionally runs with the caller's privileges and is callable only by
-- the service role used by the reviewed admin repair script.

CREATE OR REPLACE FUNCTION public.repair_vendor_base_rate_atomic(
  p_vendor_id UUID,
  p_expected_base_rate NUMERIC,
  p_new_base_rate_cents INTEGER,
  p_audit_action TEXT,
  p_admin_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_before_base_rate NUMERIC;
  v_after_base_rate NUMERIC;
  v_audit_id UUID;
BEGIN
  SELECT vendor.base_rate
    INTO v_before_base_rate
    FROM public.vendor_profiles AS vendor
   WHERE vendor.id = p_vendor_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_profile_not_found:%', p_vendor_id;
  END IF;

  IF v_before_base_rate IS DISTINCT FROM p_expected_base_rate THEN
    RAISE EXCEPTION 'vendor_base_rate_stale:% expected=% actual=%',
      p_vendor_id,
      p_expected_base_rate,
      v_before_base_rate;
  END IF;

  IF p_new_base_rate_cents IS NOT NULL AND p_new_base_rate_cents <= 0 THEN
    RAISE EXCEPTION 'new vendor base rate must be positive integer cents';
  END IF;

  v_after_base_rate := COALESCE(p_new_base_rate_cents, v_before_base_rate);

  IF p_new_base_rate_cents IS NOT NULL THEN
    UPDATE public.vendor_profiles
       SET base_rate = p_new_base_rate_cents,
           updated_at = now()
     WHERE id = p_vendor_id;
  END IF;

  -- If this audit insert fails, PostgreSQL rolls back the preceding update.
  INSERT INTO public.admin_audit_log (
    admin_user_id,
    action,
    entity_type,
    entity_id,
    before_state,
    after_state,
    metadata
  )
  VALUES (
    p_admin_user_id,
    p_audit_action,
    'vendor_profiles',
    p_vendor_id,
    jsonb_build_object('base_rate', v_before_base_rate),
    jsonb_build_object('base_rate', v_after_base_rate),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'script', 'scripts/admin/repair-vendor-base-rate-units.ts',
      'reason', 'legacy_vendor_base_rate_dollars_to_cents'
    )
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'vendor_id', p_vendor_id,
    'before_base_rate', v_before_base_rate,
    'after_base_rate', v_after_base_rate,
    'audit_id', v_audit_id,
    'updated', p_new_base_rate_cents IS NOT NULL
  );
END;
$$;

COMMENT ON FUNCTION public.repair_vendor_base_rate_atomic(UUID, NUMERIC, INTEGER, TEXT, UUID, JSONB) IS
  'Service-role-only, SECURITY INVOKER repair of vendor base-rate units with an atomic admin audit row.';

REVOKE ALL ON FUNCTION public.repair_vendor_base_rate_atomic(UUID, NUMERIC, INTEGER, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_vendor_base_rate_atomic(UUID, NUMERIC, INTEGER, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.repair_vendor_base_rate_atomic(UUID, NUMERIC, INTEGER, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_vendor_base_rate_atomic(UUID, NUMERIC, INTEGER, TEXT, UUID, JSONB) TO service_role;
