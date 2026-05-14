-- Migration: Add organizer-invited vendors and private rate agreements
-- Context: Organizers can bring existing vendors into 3rdPlace, keep their
-- private agreed rate scoped to that organizer/vendor pair, and let vendors
-- publish a separate public base rate after claiming their profile.

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'self_signup',
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

-- user_id is already nullable for admin-seeded catalog rows, but keep this
-- here so a fresh reset can apply this migration independently of remote drift.
ALTER TABLE public.vendor_profiles
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_claim_status_check,
  DROP CONSTRAINT IF EXISTS vendor_profiles_user_claim_status_check;

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT vendor_profiles_claim_status_check
    CHECK (claim_status IN ('self_signup', 'invited_unclaimed', 'invited_claimed')),
  -- admin-seeded catalog rows (user_id NULL, is_admin_seeded = true)
  -- are valid and predate this migration.
  ADD CONSTRAINT vendor_profiles_user_claim_status_check
    CHECK (
      user_id IS NOT NULL
      OR claim_status = 'invited_unclaimed'
      OR is_admin_seeded = true
    );

COMMENT ON COLUMN public.vendor_profiles.claim_status IS
  'self_signup = normal vendor signup, invited_unclaimed = organizer-created stub, invited_claimed = invite accepted by vendor.';
COMMENT ON COLUMN public.vendor_profiles.invited_by_user_id IS
  'Organizer auth.users id that created the invited vendor stub.';
COMMENT ON COLUMN public.vendor_profiles.invited_at IS
  'Timestamp when the organizer invited this vendor.';

CREATE TABLE IF NOT EXISTS public.organizer_vendor_relationships (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organizer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('organizer_invite', 'platform_booking', 'self_added')),
  trust_tier text NOT NULL DEFAULT 'known' CHECK (trust_tier IN ('known', 'preferred', 'regular')),
  first_worked_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_user_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_organizer_vendor_relationships_vendor
  ON public.organizer_vendor_relationships(vendor_id);

CREATE INDEX IF NOT EXISTS idx_organizer_vendor_relationships_organizer
  ON public.organizer_vendor_relationships(organizer_user_id);

CREATE TABLE IF NOT EXISTS public.vendor_rate_agreements (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  vendor_id uuid NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  organizer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rate_type text NOT NULL CHECK (rate_type IN ('flat', 'per_person', 'hourly')),
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'superseded')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  source_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_agreements_confirmed_pair
  ON public.vendor_rate_agreements(organizer_user_id, vendor_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_vendor_rate_agreements_vendor
  ON public.vendor_rate_agreements(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_rate_agreements_organizer
  ON public.vendor_rate_agreements(organizer_user_id);

ALTER TABLE public.organizer_vendor_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_rate_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view own vendor relationships"
  ON public.organizer_vendor_relationships;
DROP POLICY IF EXISTS "Organizers can insert own vendor relationships"
  ON public.organizer_vendor_relationships;
DROP POLICY IF EXISTS "Organizers can update own vendor relationships"
  ON public.organizer_vendor_relationships;
DROP POLICY IF EXISTS "Organizers can delete own vendor relationships"
  ON public.organizer_vendor_relationships;

CREATE POLICY "Organizers can view own vendor relationships"
  ON public.organizer_vendor_relationships
  FOR SELECT
  USING (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can insert own vendor relationships"
  ON public.organizer_vendor_relationships
  FOR INSERT
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can update own vendor relationships"
  ON public.organizer_vendor_relationships
  FOR UPDATE
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can delete own vendor relationships"
  ON public.organizer_vendor_relationships
  FOR DELETE
  USING (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Parties can view vendor rate agreements"
  ON public.vendor_rate_agreements;
DROP POLICY IF EXISTS "Parties can insert vendor rate agreements"
  ON public.vendor_rate_agreements;
DROP POLICY IF EXISTS "Parties can update vendor rate agreements"
  ON public.vendor_rate_agreements;

CREATE POLICY "Parties can view vendor rate agreements"
  ON public.vendor_rate_agreements
  FOR SELECT
  USING (
    organizer_user_id = auth.uid()
    OR vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Parties can insert vendor rate agreements"
  ON public.vendor_rate_agreements
  FOR INSERT
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Parties can update vendor rate agreements"
  ON public.vendor_rate_agreements
  FOR UPDATE
  USING (
    organizer_user_id = auth.uid()
    OR vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR vendor_id IN (
      SELECT id
      FROM public.vendor_profiles
      WHERE user_id = auth.uid()
    )
  );

DROP VIEW IF EXISTS public.organizer_vendor_relationships_vendor_view;

CREATE VIEW public.organizer_vendor_relationships_vendor_view
WITH (security_barrier = true)
AS
SELECT
  id,
  organizer_user_id,
  vendor_id,
  source,
  trust_tier,
  first_worked_at,
  created_at
FROM public.organizer_vendor_relationships
WHERE vendor_id IN (
  SELECT id
  FROM public.vendor_profiles
  WHERE user_id = auth.uid()
);

REVOKE ALL ON TABLE public.organizer_vendor_relationships FROM anon, authenticated;
REVOKE ALL ON TABLE public.vendor_rate_agreements FROM anon, authenticated;
REVOKE ALL ON TABLE public.organizer_vendor_relationships_vendor_view FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organizer_vendor_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.vendor_rate_agreements TO authenticated;
GRANT SELECT ON TABLE public.organizer_vendor_relationships_vendor_view TO authenticated;

GRANT ALL ON TABLE public.organizer_vendor_relationships TO service_role;
GRANT ALL ON TABLE public.vendor_rate_agreements TO service_role;
GRANT SELECT ON TABLE public.organizer_vendor_relationships_vendor_view TO service_role;

CREATE OR REPLACE FUNCTION public.create_vendor_invite(
  p_organizer_user_id uuid,
  p_vendor_name text,
  p_email text,
  p_phone text,
  p_service_type text,
  p_rate_type text,
  p_amount numeric,
  p_source_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  vendor_id uuid,
  relationship_id uuid,
  rate_agreement_id uuid,
  existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_vendor_id uuid;
  v_relationship_id uuid;
  v_rate_agreement_id uuid;
  v_vendor_type text;
  v_normalized_email text;
BEGIN
  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF NULLIF(BTRIM(p_vendor_name), '') IS NULL THEN
    RAISE EXCEPTION 'vendor_name is required';
  END IF;

  v_normalized_email := LOWER(NULLIF(BTRIM(p_email), ''));
  IF v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'email is required';
  END IF;

  IF p_rate_type NOT IN ('flat', 'per_person', 'hourly') THEN
    RAISE EXCEPTION 'unsupported rate_type: %', p_rate_type;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;

  v_vendor_type := CASE p_service_type
    WHEN 'dj' THEN 'DJ / Music'
    WHEN 'catering' THEN 'Caterer'
    WHEN 'bartending' THEN 'Bartender'
    WHEN 'photography' THEN 'Photographer'
    WHEN 'photographer' THEN 'Photographer'
    WHEN 'videography' THEN 'Photographer'
    WHEN 'videographer' THEN 'Photographer'
    WHEN 'av_tech' THEN 'Audio/Visual Tech'
    WHEN 'av' THEN 'Audio/Visual Tech'
    WHEN 'event_planning' THEN 'Security / Event Staff'
    WHEN 'security' THEN 'Security / Event Staff'
    WHEN 'florist' THEN 'Decorator / Florist'
    WHEN 'decor' THEN 'Decorator / Florist'
    ELSE 'DJ / Music'
  END;

  SELECT vendor_profiles.id
  INTO v_vendor_id
  FROM public.organizer_vendor_relationships
  JOIN public.vendor_profiles
    ON vendor_profiles.id = organizer_vendor_relationships.vendor_id
  WHERE organizer_vendor_relationships.organizer_user_id = p_organizer_user_id
    AND LOWER(COALESCE(vendor_profiles.contact_email, '')) = v_normalized_email
  ORDER BY organizer_vendor_relationships.created_at DESC
  LIMIT 1;

  IF v_vendor_id IS NOT NULL THEN
    SELECT id
    INTO v_relationship_id
    FROM public.organizer_vendor_relationships
    WHERE organizer_user_id = p_organizer_user_id
      AND vendor_id = v_vendor_id
    LIMIT 1;

    SELECT id
    INTO v_rate_agreement_id
    FROM public.vendor_rate_agreements
    WHERE organizer_user_id = p_organizer_user_id
      AND vendor_id = v_vendor_id
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY SELECT v_vendor_id, v_relationship_id, v_rate_agreement_id, true;
    RETURN;
  END IF;

  INSERT INTO public.vendor_profiles (
    user_id,
    name,
    vendor_type,
    service_type,
    contact_email,
    phone,
    claim_status,
    invited_by_user_id,
    invited_at,
    is_published,
    is_claimed,
    is_admin_seeded,
    service_area,
    regions_served,
    availability_notes,
    pricing_model
  )
  VALUES (
    NULL,
    BTRIM(p_vendor_name),
    v_vendor_type,
    p_service_type,
    v_normalized_email,
    NULLIF(BTRIM(p_phone), ''),
    'invited_unclaimed',
    p_organizer_user_id,
    now(),
    false,
    false,
    false,
    'all_bay_area',
    'Bay Area',
    'Invited by organizer; pending vendor signup.',
    -- vendor_profiles has two overlapping check constraints on pricing_model;
    -- map the planner-vocabulary 'flat' to the catalog-vocabulary 'flat_rate'
    -- so the INSERT satisfies both. Other rate types already satisfy both.
    CASE WHEN p_rate_type = 'flat' THEN 'flat_rate' ELSE p_rate_type END
  )
  RETURNING id INTO v_vendor_id;

  INSERT INTO public.organizer_vendor_relationships (
    organizer_user_id,
    vendor_id,
    source,
    trust_tier
  )
  VALUES (
    p_organizer_user_id,
    v_vendor_id,
    'organizer_invite',
    'known'
  )
  RETURNING id INTO v_relationship_id;

  INSERT INTO public.vendor_rate_agreements (
    vendor_id,
    organizer_user_id,
    rate_type,
    amount,
    source_event_id,
    status
  )
  VALUES (
    v_vendor_id,
    p_organizer_user_id,
    p_rate_type,
    ROUND(p_amount::numeric, 2),
    p_source_event_id,
    'proposed'
  )
  RETURNING id INTO v_rate_agreement_id;

  RETURN QUERY SELECT v_vendor_id, v_relationship_id, v_rate_agreement_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_vendor_invite(uuid, text, text, text, text, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_vendor_invite(uuid, text, text, text, text, text, numeric, uuid) TO authenticated, service_role;
