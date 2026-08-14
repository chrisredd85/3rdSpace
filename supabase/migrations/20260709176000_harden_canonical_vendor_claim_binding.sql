-- Prompt 8 P0 hardening: a discovery vendor is not a physical counterparty.
-- Only a service-owned claim may bind those identities, and every canonical
-- booking freezes the resolved physical partner before the booking row exists.

-- Keep legacy profile links readable, including any historical duplicates, but
-- make this table the unique authority for all new execution decisions.
CREATE TABLE public.discovery_vendor_claims (
  discovery_vendor_id UUID PRIMARY KEY
    REFERENCES public.discovery_vendors(id) ON DELETE CASCADE,
  vendor_profile_id UUID NOT NULL UNIQUE
    REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  bound_by UUID,
  binding_source TEXT NOT NULL DEFAULT 'service_command',
  CONSTRAINT discovery_vendor_claims_binding_source_check
    CHECK (binding_source IN ('legacy_unambiguous', 'service_command', 'service_profile_link'))
);

COMMENT ON TABLE public.discovery_vendor_claims IS
  'Unique service-owned authority binding one discovery vendor to one physical vendor profile. Legacy duplicate profile links are left untouched but are not authoritative.';

ALTER TABLE public.discovery_vendor_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.discovery_vendor_claims FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.discovery_vendor_claims FROM service_role;
GRANT SELECT ON TABLE public.discovery_vendor_claims TO service_role;

-- Import only unambiguous legacy links. Duplicates remain in vendor_profiles for
-- operator reconciliation; this migration never deletes or nulls legacy data.
INSERT INTO public.discovery_vendor_claims (
  discovery_vendor_id,
  vendor_profile_id,
  bound_by,
  binding_source
)
SELECT
  profile.discovery_vendor_id,
  (array_agg(profile.id ORDER BY profile.id))[1],
  (array_agg(profile.user_id ORDER BY profile.user_id) FILTER (WHERE profile.user_id IS NOT NULL))[1],
  'legacy_unambiguous'
FROM public.vendor_profiles AS profile
WHERE profile.discovery_vendor_id IS NOT NULL
GROUP BY profile.discovery_vendor_id
HAVING COUNT(*) = 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.protect_discovery_vendor_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'discovery_vendor_claim_is_immutable'
    USING ERRCODE = '23514';
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_discovery_vendor_claim()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_discovery_vendor_claim()
  TO service_role;

CREATE TRIGGER protect_discovery_vendor_claim_trigger
  BEFORE UPDATE ON public.discovery_vendor_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_discovery_vendor_claim();

CREATE OR REPLACE FUNCTION public.protect_vendor_profile_discovery_claim_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.discovery_vendor_id IS NOT DISTINCT FROM OLD.discovery_vendor_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.discovery_vendor_id IS NULL
    AND (TG_OP = 'INSERT' OR OLD.discovery_vendor_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  -- An existing physical/discovery identity is immutable. Repairing historical
  -- conflicts requires a separate audited migration, never an ordinary profile
  -- write or a re-use of the binding command.
  IF TG_OP = 'UPDATE' AND OLD.discovery_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_is_immutable'
      USING ERRCODE = '23514';
  END IF;

  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_requires_service_command'
      USING ERRCODE = '42501';
  END IF;

  -- The row being inserted/updated is already protected by the caller's row
  -- lock. Lock the discovery identity as the serialization point for every
  -- profile-link path, then inspect every committed profile already mentioning
  -- it. A second concurrent writer waits here and observes the first claim
  -- before it can commit its own link.
  PERFORM vendor.id
  FROM public.discovery_vendors AS vendor
  WHERE vendor.id = NEW.discovery_vendor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_discovery_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_profiles AS profile
    WHERE profile.discovery_vendor_id = NEW.discovery_vendor_id
      AND profile.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_legacy_collision'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.discovery_vendor_claims AS claim
    WHERE claim.discovery_vendor_id = NEW.discovery_vendor_id
      AND claim.vendor_profile_id <> NEW.id
  ) OR EXISTS (
    SELECT 1
    FROM public.discovery_vendor_claims AS claim
    WHERE claim.vendor_profile_id = NEW.id
      AND claim.discovery_vendor_id <> NEW.discovery_vendor_id
  ) THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_collision'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_vendor_profile_discovery_claim_link()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_vendor_profile_discovery_claim_link()
  TO service_role;

CREATE TRIGGER protect_vendor_profile_discovery_claim_link_trigger
  BEFORE INSERT OR UPDATE OF discovery_vendor_id
  ON public.vendor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_vendor_profile_discovery_claim_link();

CREATE OR REPLACE FUNCTION public.sync_vendor_profile_discovery_claim_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.discovery_vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Retain the discovery-row lock taken by the BEFORE trigger and recheck the
  -- whole profile set immediately before creating authority. This makes the
  -- authority insert fail closed even if a future trigger-order change adds
  -- another profile mutation between the two checks.
  PERFORM vendor.id
  FROM public.discovery_vendors AS vendor
  WHERE vendor.id = NEW.discovery_vendor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_discovery_not_found'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_profiles AS profile
    WHERE profile.discovery_vendor_id = NEW.discovery_vendor_id
      AND profile.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_legacy_collision'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.discovery_vendor_claims AS claim
    WHERE claim.discovery_vendor_id = NEW.discovery_vendor_id
      AND claim.vendor_profile_id <> NEW.id
  ) OR EXISTS (
    SELECT 1
    FROM public.discovery_vendor_claims AS claim
    WHERE claim.vendor_profile_id = NEW.id
      AND claim.discovery_vendor_id <> NEW.discovery_vendor_id
  ) THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_collision'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.discovery_vendor_claims (
    discovery_vendor_id,
    vendor_profile_id,
    bound_by,
    binding_source
  ) VALUES (
    NEW.discovery_vendor_id,
    NEW.id,
    NEW.user_id,
    'service_profile_link'
  )
  ON CONFLICT (discovery_vendor_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.discovery_vendor_claims AS claim
    WHERE claim.discovery_vendor_id = NEW.discovery_vendor_id
      AND claim.vendor_profile_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'vendor_profile_discovery_claim_collision'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_vendor_profile_discovery_claim_link()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_vendor_profile_discovery_claim_link()
  TO service_role;

CREATE TRIGGER sync_vendor_profile_discovery_claim_link_trigger
  AFTER INSERT OR UPDATE OF discovery_vendor_id
  ON public.vendor_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vendor_profile_discovery_claim_link();

CREATE OR REPLACE FUNCTION public.bind_discovery_vendor_claim(
  p_discovery_vendor_id UUID,
  p_vendor_profile_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
  v_profile public.vendor_profiles%ROWTYPE;
  v_claim public.discovery_vendor_claims%ROWTYPE;
  v_existing BOOLEAN := false;
BEGIN
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_discovery_vendor_id IS NULL OR p_vendor_profile_id IS NULL THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  -- The profile row is the first lock on both the explicit command and the
  -- profile-trigger path. The discovery row then serializes every writer for
  -- that discovery identity. Existing links are immutable, so inspecting all
  -- profiles while holding this lock is sufficient to make a concurrent link
  -- observe the winning authority or fail as a collision.
  SELECT profile.*
  INTO v_profile
  FROM public.vendor_profiles AS profile
  WHERE profile.id = p_vendor_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_profile_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM vendor.id
  FROM public.discovery_vendors AS vendor
  WHERE vendor.id = p_discovery_vendor_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_discovery_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.discovery_vendor_id IS NOT NULL
    AND v_profile.discovery_vendor_id <> p_discovery_vendor_id
  THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_rebind_forbidden'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vendor_profiles AS profile
    WHERE profile.discovery_vendor_id = p_discovery_vendor_id
      AND profile.id <> p_vendor_profile_id
  ) THEN
    RAISE EXCEPTION 'bind_discovery_vendor_claim_legacy_collision'
      USING ERRCODE = '23505';
  END IF;

  SELECT claim.*
  INTO v_claim
  FROM public.discovery_vendor_claims AS claim
  WHERE claim.discovery_vendor_id = p_discovery_vendor_id
     OR claim.vendor_profile_id = p_vendor_profile_id
  ORDER BY claim.discovery_vendor_id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_claim.discovery_vendor_id <> p_discovery_vendor_id
      OR v_claim.vendor_profile_id <> p_vendor_profile_id
    THEN
      RAISE EXCEPTION 'bind_discovery_vendor_claim_collision'
        USING ERRCODE = '23505';
    END IF;
    v_existing := true;
  ELSE
    INSERT INTO public.discovery_vendor_claims (
      discovery_vendor_id,
      vendor_profile_id,
      bound_by,
      binding_source
    ) VALUES (
      p_discovery_vendor_id,
      p_vendor_profile_id,
      p_actor_id,
      'service_command'
    )
    RETURNING * INTO v_claim;
  END IF;

  IF v_profile.discovery_vendor_id IS NULL THEN
    UPDATE public.vendor_profiles AS profile
    SET discovery_vendor_id = p_discovery_vendor_id,
        updated_at = transaction_timestamp()
    WHERE profile.id = p_vendor_profile_id
      AND profile.discovery_vendor_id IS NULL
    RETURNING profile.* INTO v_profile;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'bind_discovery_vendor_claim_profile_race'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'existing', v_existing,
    'discovery_vendor_id', v_claim.discovery_vendor_id,
    'vendor_profile_id', v_claim.vendor_profile_id,
    'bound_at', v_claim.bound_at,
    'binding_source', v_claim.binding_source
  );
END;
$function$;

COMMENT ON FUNCTION public.bind_discovery_vendor_claim(UUID, UUID, UUID) IS
  'Service-only, locked, idempotent binding of one discovery vendor to one physical vendor profile; collisions and rebinding fail closed.';

REVOKE ALL ON FUNCTION public.bind_discovery_vendor_claim(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_discovery_vendor_claim(UUID, UUID, UUID)
  TO service_role;

-- Immutable extension of the exact action/approval snapshot. The booking row
-- continues to store its physical FK; this record proves which approved
-- discovery target resolved to that FK at execution time.
CREATE TABLE public.canonical_booking_partner_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  agent_action_id UUID NOT NULL UNIQUE,
  approval_id UUID NOT NULL UNIQUE,
  booking_kind TEXT NOT NULL CHECK (booking_kind IN ('venue', 'vendor')),
  discovery_partner_id UUID NOT NULL,
  physical_partner_id UUID NOT NULL,
  approval_snapshot_hash TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  bound_by UUID,
  binding_source TEXT NOT NULL DEFAULT 'canonical_booking_insert',
  CONSTRAINT canonical_booking_partner_bindings_action_plan_fkey
    FOREIGN KEY (agent_action_id, plan_id)
    REFERENCES public.agent_actions(id, plan_id) ON DELETE CASCADE,
  CONSTRAINT canonical_booking_partner_bindings_approval_plan_fkey
    FOREIGN KEY (approval_id, plan_id)
    REFERENCES public.approvals(id, plan_id) ON DELETE CASCADE,
  CONSTRAINT canonical_booking_partner_bindings_source_check
    CHECK (binding_source IN ('legacy_canonical_backfill', 'canonical_booking_insert'))
);

CREATE UNIQUE INDEX canonical_booking_partner_bindings_exact_identity_unique
  ON public.canonical_booking_partner_bindings(
    plan_id,
    agent_action_id,
    approval_id,
    booking_kind,
    discovery_partner_id,
    physical_partner_id
  );

ALTER TABLE public.canonical_booking_partner_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canonical_booking_partner_bindings FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.canonical_booking_partner_bindings FROM service_role;
GRANT SELECT ON TABLE public.canonical_booking_partner_bindings TO service_role;

CREATE OR REPLACE FUNCTION public.protect_canonical_booking_partner_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'canonical_booking_partner_binding_is_immutable'
    USING ERRCODE = '23514';
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_canonical_booking_partner_binding()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_canonical_booking_partner_binding()
  TO service_role;

CREATE TRIGGER protect_canonical_booking_partner_binding_trigger
  BEFORE UPDATE ON public.canonical_booking_partner_bindings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_canonical_booking_partner_binding();

CREATE OR REPLACE FUNCTION public.ensure_canonical_booking_partner_binding(
  p_booking_kind TEXT,
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_physical_partner_id UUID
)
RETURNS public.canonical_booking_partner_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_binding public.canonical_booking_partner_bindings%ROWTYPE;
  v_authoritative_partner_id UUID;
BEGIN
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_requires_service_command'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_kind NOT IN ('venue', 'vendor')
    OR p_plan_id IS NULL
    OR p_agent_action_id IS NULL
    OR p_approval_id IS NULL
    OR p_physical_partner_id IS NULL
  THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_invalid_contract'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.* INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT action_row.* INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_agent_action_id
    AND action_row.plan_id = p_plan_id
    AND action_row.approval_id = p_approval_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_action_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT approval_row.* INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_agent_action_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_approval_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF v_action.payload_json ->> 'kind' IS DISTINCT FROM 'canonical_quote_booking'
    OR v_action.payload_json ->> 'quote_kind' IS DISTINCT FROM p_booking_kind
    OR v_action.target_id::TEXT IS DISTINCT FROM v_action.payload_json ->> 'target_id'
    OR v_action.target_type IS DISTINCT FROM (
      CASE
        WHEN p_booking_kind = 'venue' THEN 'discovery_venue'
        ELSE 'discovery_vendor'
      END
    )
    OR v_approval.snapshot_schema_version IS DISTINCT FROM 2
    OR NULLIF(btrim(v_approval.snapshot_hash), '') IS NULL
    OR v_approval.snapshot_json #> '{action,payload_json}' IS DISTINCT FROM v_action.payload_json
    OR v_approval.snapshot_json #>> '{action,target_id}' IS DISTINCT FROM v_action.target_id::TEXT
    OR v_approval.snapshot_json #>> '{counterparty,target_id}' IS DISTINCT FROM v_action.target_id::TEXT
    OR v_approval.status NOT IN ('approved', 'authorized')
    OR v_approval.authorized_by IS DISTINCT FROM v_plan.user_id
    OR v_approval.authorized_at IS NULL
  THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_snapshot_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF p_booking_kind = 'venue' THEN
    SELECT discovery.claimed_venue_id
    INTO v_authoritative_partner_id
    FROM public.discovery_venues AS discovery
    JOIN public.venues AS venue ON venue.id = discovery.claimed_venue_id
    WHERE discovery.id = v_action.target_id
    FOR SHARE OF discovery, venue;
  ELSE
    SELECT claim.vendor_profile_id
    INTO v_authoritative_partner_id
    FROM public.discovery_vendor_claims AS claim
    JOIN public.vendor_profiles AS profile
      ON profile.id = claim.vendor_profile_id
     AND profile.discovery_vendor_id = claim.discovery_vendor_id
    WHERE claim.discovery_vendor_id = v_action.target_id
    FOR SHARE OF claim, profile;
  END IF;

  IF v_authoritative_partner_id IS NULL
    OR v_authoritative_partner_id IS DISTINCT FROM p_physical_partner_id
  THEN
    RAISE EXCEPTION 'canonical_booking_partner_binding_counterparty_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT binding.* INTO v_binding
  FROM public.canonical_booking_partner_bindings AS binding
  WHERE binding.agent_action_id = p_agent_action_id
     OR binding.approval_id = p_approval_id
  ORDER BY binding.id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_binding.plan_id IS DISTINCT FROM p_plan_id
      OR v_binding.agent_action_id IS DISTINCT FROM p_agent_action_id
      OR v_binding.approval_id IS DISTINCT FROM p_approval_id
      OR v_binding.booking_kind IS DISTINCT FROM p_booking_kind
      OR v_binding.discovery_partner_id IS DISTINCT FROM v_action.target_id
      OR v_binding.physical_partner_id IS DISTINCT FROM p_physical_partner_id
      OR v_binding.approval_snapshot_hash IS DISTINCT FROM v_approval.snapshot_hash
    THEN
      RAISE EXCEPTION 'canonical_booking_partner_binding_rebind_forbidden'
        USING ERRCODE = '23514';
    END IF;
    RETURN v_binding;
  END IF;

  INSERT INTO public.canonical_booking_partner_bindings (
    plan_id,
    agent_action_id,
    approval_id,
    booking_kind,
    discovery_partner_id,
    physical_partner_id,
    approval_snapshot_hash,
    bound_by,
    binding_source
  ) VALUES (
    p_plan_id,
    p_agent_action_id,
    p_approval_id,
    p_booking_kind,
    v_action.target_id,
    p_physical_partner_id,
    v_approval.snapshot_hash,
    v_approval.authorized_by,
    'canonical_booking_insert'
  )
  RETURNING * INTO v_binding;

  RETURN v_binding;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_canonical_booking_partner_binding(TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_canonical_booking_partner_binding(TEXT, UUID, UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.freeze_canonical_booking_partner_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_booking_kind TEXT := CASE
    WHEN TG_TABLE_NAME = 'venue_bookings' THEN 'venue'
    ELSE 'vendor'
  END;
  v_partner_id UUID;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_partner_id := NULLIF(
    to_jsonb(NEW) ->> CASE
      WHEN v_booking_kind = 'venue' THEN 'venue_id'
      ELSE 'vendor_id'
    END,
    ''
  )::UUID;

  PERFORM public.ensure_canonical_booking_partner_binding(
    v_booking_kind,
    NEW.plan_id,
    NEW.agent_action_id,
    NEW.approval_id,
    v_partner_id
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.freeze_canonical_booking_partner_binding()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_canonical_booking_partner_binding()
  TO service_role;

CREATE TRIGGER a_freeze_venue_booking_partner_binding_trigger
  BEFORE INSERT ON public.venue_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_canonical_booking_partner_binding();

CREATE TRIGGER a_freeze_vendor_booking_partner_binding_trigger
  BEFORE INSERT ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_canonical_booking_partner_binding();

-- Backfill only rows whose current physical identity is still supported by an
-- unambiguous authoritative claim. Inconsistent history remains blocked for
-- operator review instead of being silently blessed.
INSERT INTO public.canonical_booking_partner_bindings (
  plan_id, agent_action_id, approval_id, booking_kind,
  discovery_partner_id, physical_partner_id, approval_snapshot_hash,
  bound_by, binding_source
)
SELECT
  booking.plan_id,
  booking.agent_action_id,
  booking.approval_id,
  'venue',
  action.target_id,
  booking.venue_id,
  approval.snapshot_hash,
  approval.authorized_by,
  'legacy_canonical_backfill'
FROM public.venue_bookings AS booking
JOIN public.agent_actions AS action
  ON action.id = booking.agent_action_id
 AND action.plan_id = booking.plan_id
 AND action.approval_id = booking.approval_id
JOIN public.approvals AS approval
  ON approval.id = booking.approval_id
 AND approval.plan_id = booking.plan_id
 AND approval.agent_action_id = booking.agent_action_id
JOIN public.discovery_venues AS discovery
  ON discovery.id = action.target_id
 AND discovery.claimed_venue_id = booking.venue_id
WHERE booking.plan_id IS NOT NULL
  AND action.payload_json ->> 'kind' = 'canonical_quote_booking'
  AND action.payload_json ->> 'quote_kind' = 'venue'
  AND NULLIF(btrim(approval.snapshot_hash), '') IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.canonical_booking_partner_bindings (
  plan_id, agent_action_id, approval_id, booking_kind,
  discovery_partner_id, physical_partner_id, approval_snapshot_hash,
  bound_by, binding_source
)
SELECT
  booking.plan_id,
  booking.agent_action_id,
  booking.approval_id,
  'vendor',
  action.target_id,
  booking.vendor_id,
  approval.snapshot_hash,
  approval.authorized_by,
  'legacy_canonical_backfill'
FROM public.vendor_bookings AS booking
JOIN public.agent_actions AS action
  ON action.id = booking.agent_action_id
 AND action.plan_id = booking.plan_id
 AND action.approval_id = booking.approval_id
JOIN public.approvals AS approval
  ON approval.id = booking.approval_id
 AND approval.plan_id = booking.plan_id
 AND approval.agent_action_id = booking.agent_action_id
JOIN public.discovery_vendor_claims AS claim
  ON claim.discovery_vendor_id = action.target_id
 AND claim.vendor_profile_id = booking.vendor_id
WHERE booking.plan_id IS NOT NULL
  AND action.payload_json ->> 'kind' = 'canonical_quote_booking'
  AND action.payload_json ->> 'quote_kind' = 'vendor'
  AND NULLIF(btrim(approval.snapshot_hash), '') IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.assert_canonical_booking_partner_binding(
  p_booking_kind TEXT,
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_physical_partner_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.canonical_booking_partner_bindings AS binding
    JOIN public.agent_actions AS action
      ON action.id = binding.agent_action_id
     AND action.plan_id = binding.plan_id
     AND action.approval_id = binding.approval_id
    JOIN public.approvals AS approval
      ON approval.id = binding.approval_id
     AND approval.plan_id = binding.plan_id
     AND approval.agent_action_id = binding.agent_action_id
    WHERE binding.booking_kind = p_booking_kind
      AND binding.plan_id = p_plan_id
      AND binding.agent_action_id = p_agent_action_id
      AND binding.approval_id = p_approval_id
      AND binding.discovery_partner_id = action.target_id
      AND binding.physical_partner_id = p_physical_partner_id
      AND binding.approval_snapshot_hash = approval.snapshot_hash
  ) THEN
    RAISE EXCEPTION 'canonical_booking_frozen_partner_binding_mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_canonical_booking_partner_binding(TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_canonical_booking_partner_binding(TEXT, UUID, UUID, UUID, UUID)
  TO service_role;

-- Final provenance uses the immutable execution-time binding. It never asks a
-- mutable discovery/profile link which physical counterparty was approved.
CREATE OR REPLACE FUNCTION public.canonical_booking_has_execution_provenance(
  p_booking_kind TEXT,
  p_partner_id UUID,
  p_event_id UUID,
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_organizer_id UUID,
  p_quoted_price_cents INTEGER,
  p_approved_terms_snapshot JSONB,
  p_booking_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT p_booking_kind IN ('venue', 'vendor')
    AND EXISTS (
      SELECT 1
      FROM public.plans AS plan_row
      JOIN public.events AS event_row
        ON event_row.id = plan_row.materialized_event_id
       AND event_row.plan_id = plan_row.id
      JOIN public.agent_actions AS action_row
        ON action_row.id = p_agent_action_id
       AND action_row.plan_id = plan_row.id
       AND action_row.approval_id = p_approval_id
      JOIN public.approvals AS approval_row
        ON approval_row.id = p_approval_id
       AND approval_row.agent_action_id = action_row.id
       AND approval_row.plan_id = plan_row.id
      JOIN public.canonical_booking_partner_bindings AS binding
        ON binding.plan_id = plan_row.id
       AND binding.agent_action_id = action_row.id
       AND binding.approval_id = approval_row.id
       AND binding.booking_kind = p_booking_kind
       AND binding.discovery_partner_id = action_row.target_id
       AND binding.physical_partner_id = p_partner_id
       AND binding.approval_snapshot_hash = approval_row.snapshot_hash
      WHERE plan_row.id = p_plan_id
        AND event_row.id = p_event_id
        AND plan_row.user_id = p_organizer_id
        AND action_row.payload_json ->> 'kind' = 'canonical_quote_booking'
        AND action_row.payload_json ->> 'quote_kind' = p_booking_kind
        AND action_row.target_type = CASE
          WHEN p_booking_kind = 'venue' THEN 'discovery_venue'
          ELSE 'discovery_vendor'
        END
        AND action_row.target_id::TEXT = action_row.payload_json ->> 'target_id'
        AND action_row.target_type = action_row.payload_json ->> 'target_type'
        AND approval_row.snapshot_schema_version = 2
        AND approval_row.snapshot_json ->> 'schema_version' = '2'
        AND approval_row.snapshot_json #> '{action,payload_json}' = action_row.payload_json
        AND approval_row.snapshot_json #>> '{action,action_type}' = action_row.action_type
        AND action_row.currency = 'usd'
        AND approval_row.provider = action_row.provider
        AND approval_row.snapshot_json #>> '{approval,provider}' = action_row.provider
        AND approval_row.snapshot_json #>> '{counterparty,provider}' = action_row.provider
        AND approval_row.snapshot_json #>> '{action,target_type}' = action_row.target_type
        AND approval_row.snapshot_json #>> '{action,target_id}' = action_row.target_id::TEXT
        AND approval_row.snapshot_json #>> '{action,amount_cents}' = action_row.amount_cents::TEXT
        AND approval_row.snapshot_json #>> '{counterparty,target_type}' = action_row.target_type
        AND approval_row.snapshot_json #>> '{counterparty,target_id}' = action_row.target_id::TEXT
        AND action_row.amount_cents = p_quoted_price_cents
        AND approval_row.requested_amount_cents = p_quoted_price_cents
        AND approval_row.authorized_amount_cents = p_quoted_price_cents
        AND approval_row.price_cents = p_quoted_price_cents
        AND approval_row.authorized_by = plan_row.user_id
        AND approval_row.authorized_at IS NOT NULL
        AND NULLIF(btrim(approval_row.snapshot_hash), '') IS NOT NULL
        AND approval_row.snapshot_json = p_approved_terms_snapshot
        AND approval_row.event_date = event_row.event_date
        AND (
          (
            p_booking_status IN ('cancelled', 'rejected', 'declined')
            AND plan_row.status::TEXT IN ('executing', 'booked', 'completed', 'archived')
            AND approval_row.status IN ('approved', 'authorized', 'cancelled', 'rejected')
            AND (
              (
                p_booking_status = 'declined'
                AND action_row.status = 'cancelled'
              )
              OR (
                p_booking_status IN ('cancelled', 'rejected')
                AND action_row.status IN ('approved', 'executing', 'complete', 'cancelled')
              )
            )
          )
          OR (
            p_booking_status NOT IN ('cancelled', 'rejected', 'declined')
            AND (
              plan_row.status::TEXT IN ('executing', 'booked')
              OR (
                p_booking_status = 'confirmed'
                AND plan_row.status::TEXT IN ('completed', 'archived')
                AND action_row.status = 'complete'
              )
            )
            AND approval_row.status IN ('approved', 'authorized')
            AND (
              action_row.status IN ('executing', 'complete')
              OR (
                action_row.status = 'approved'
                AND (
                  approval_row.expires_at IS NULL
                  OR approval_row.expires_at > transaction_timestamp()
                )
              )
            )
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.canonical_booking_has_execution_provenance(
  TEXT, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_booking_has_execution_provenance(
  TEXT, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, JSONB, TEXT
) TO service_role;

-- Exact replay paths return before their booking UPDATE trigger runs. Wrap all
-- three lifecycle commands so replay also proves the frozen partner identity.
ALTER FUNCTION public.confirm_canonical_booking(TEXT, UUID, UUID, JSONB)
  RENAME TO confirm_canonical_booking_pre_frozen_binding;
REVOKE ALL ON FUNCTION public.confirm_canonical_booking_pre_frozen_binding(TEXT, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.confirm_canonical_booking(
  p_booking_kind TEXT,
  p_booking_id UUID,
  p_actor_id UUID,
  p_confirmation_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
  v_plan_id UUID;
  v_action_id UUID;
  v_approval_id UUID;
  v_partner_id UUID;
BEGIN
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'confirm_canonical_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_kind = 'venue' THEN
    SELECT booking.plan_id, booking.agent_action_id, booking.approval_id, booking.venue_id
    INTO v_plan_id, v_action_id, v_approval_id, v_partner_id
    FROM public.venue_bookings AS booking
    WHERE booking.id = p_booking_id;
  ELSIF p_booking_kind = 'vendor' THEN
    SELECT booking.plan_id, booking.agent_action_id, booking.approval_id, booking.vendor_id
    INTO v_plan_id, v_action_id, v_approval_id, v_partner_id
    FROM public.vendor_bookings AS booking
    WHERE booking.id = p_booking_id;
  END IF;

  IF v_plan_id IS NOT NULL OR v_action_id IS NOT NULL OR v_approval_id IS NOT NULL THEN
    PERFORM public.assert_canonical_booking_partner_binding(
      p_booking_kind, v_plan_id, v_action_id, v_approval_id, v_partner_id
    );
  END IF;

  RETURN public.confirm_canonical_booking_pre_frozen_binding(
    p_booking_kind, p_booking_id, p_actor_id, p_confirmation_context
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_canonical_booking(TEXT, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_canonical_booking(TEXT, UUID, UUID, JSONB)
  TO service_role;

ALTER FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  RENAME TO decline_canonical_bookings_pre_frozen_binding;
REVOKE ALL ON FUNCTION public.decline_canonical_bookings_pre_frozen_binding(TEXT, UUID[], UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.decline_canonical_bookings(
  p_booking_kind TEXT,
  p_booking_ids UUID[],
  p_actor_id UUID,
  p_reason TEXT,
  p_decline_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
  v_booking_id UUID;
  v_plan_id UUID;
  v_action_id UUID;
  v_approval_id UUID;
  v_partner_id UUID;
BEGIN
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'decline_canonical_bookings_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_kind IN ('venue', 'vendor') THEN
    FOREACH v_booking_id IN ARRAY COALESCE(p_booking_ids, ARRAY[]::UUID[])
    LOOP
      v_plan_id := NULL;
      v_action_id := NULL;
      v_approval_id := NULL;
      v_partner_id := NULL;
      IF p_booking_kind = 'venue' THEN
        SELECT booking.plan_id, booking.agent_action_id, booking.approval_id, booking.venue_id
        INTO v_plan_id, v_action_id, v_approval_id, v_partner_id
        FROM public.venue_bookings AS booking
        WHERE booking.id = v_booking_id;
      ELSE
        SELECT booking.plan_id, booking.agent_action_id, booking.approval_id, booking.vendor_id
        INTO v_plan_id, v_action_id, v_approval_id, v_partner_id
        FROM public.vendor_bookings AS booking
        WHERE booking.id = v_booking_id;
      END IF;

      IF v_plan_id IS NOT NULL OR v_action_id IS NOT NULL OR v_approval_id IS NOT NULL THEN
        PERFORM public.assert_canonical_booking_partner_binding(
          p_booking_kind, v_plan_id, v_action_id, v_approval_id, v_partner_id
        );
      END IF;
    END LOOP;
  END IF;

  RETURN public.decline_canonical_bookings_pre_frozen_binding(
    p_booking_kind, p_booking_ids, p_actor_id, p_reason, p_decline_context
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_canonical_bookings(TEXT, UUID[], UUID, TEXT, JSONB)
  TO service_role;

ALTER FUNCTION public.cancel_executing_canonical_quote_booking(UUID, UUID, UUID, UUID, TEXT)
  RENAME TO cancel_executing_canonical_quote_booking_pre_frozen_binding;
REVOKE ALL ON FUNCTION public.cancel_executing_canonical_quote_booking_pre_frozen_binding(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.cancel_executing_canonical_quote_booking(
  p_plan_id UUID,
  p_agent_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_caller_role TEXT := COALESCE(
    NULLIF(auth.role()::TEXT, ''),
    NULLIF(NULLIF(current_setting('role', true), ''), 'none'),
    session_user::TEXT
  );
  v_booking_kind TEXT;
  v_partner_id UUID;
BEGIN
  IF v_caller_role NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'cancel_executing_canonical_quote_booking_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT 'venue', booking.venue_id
  INTO v_booking_kind, v_partner_id
  FROM public.venue_bookings AS booking
  WHERE booking.plan_id = p_plan_id
    AND booking.agent_action_id = p_agent_action_id
    AND booking.approval_id = p_approval_id;

  IF NOT FOUND THEN
    SELECT 'vendor', booking.vendor_id
    INTO v_booking_kind, v_partner_id
    FROM public.vendor_bookings AS booking
    WHERE booking.plan_id = p_plan_id
      AND booking.agent_action_id = p_agent_action_id
      AND booking.approval_id = p_approval_id;
  END IF;

  IF v_booking_kind IS NOT NULL THEN
    PERFORM public.assert_canonical_booking_partner_binding(
      v_booking_kind, p_plan_id, p_agent_action_id, p_approval_id, v_partner_id
    );
  END IF;

  RETURN public.cancel_executing_canonical_quote_booking_pre_frozen_binding(
    p_plan_id, p_agent_action_id, p_approval_id, p_actor_id, p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_executing_canonical_quote_booking(UUID, UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_executing_canonical_quote_booking(UUID, UUID, UUID, UUID, TEXT)
  TO service_role;
