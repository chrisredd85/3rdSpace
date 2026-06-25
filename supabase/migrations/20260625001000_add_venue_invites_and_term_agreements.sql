-- Migration: Add organizer-invited venues and private term agreements
-- Context: Organizers can invite a venue they already know into 3rdPlace,
-- keep that venue private until claimed, and attach proposed terms to an
-- active planner brief without bypassing booking or payment approvals.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS claim_status text NOT NULL DEFAULT 'self_signup',
  ADD COLUMN IF NOT EXISTS invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_role text;

-- Invited venue stubs are created before a venue owner exists.
ALTER TABLE public.venues
  ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_claim_status_check,
  DROP CONSTRAINT IF EXISTS venues_owner_claim_status_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_claim_status_check
    CHECK (claim_status IN ('self_signup', 'invited_unclaimed', 'invited_claimed')),
  ADD CONSTRAINT venues_owner_claim_status_check
    CHECK (
      owner_id IS NOT NULL
      OR claim_status = 'invited_unclaimed'
      OR is_admin_seeded = true
    );

COMMENT ON COLUMN public.venues.claim_status IS
  'self_signup = normal venue signup, invited_unclaimed = organizer-created stub, invited_claimed = invite accepted by venue.';
COMMENT ON COLUMN public.venues.invited_by_user_id IS
  'Organizer auth.users id that created the invited venue stub.';
COMMENT ON COLUMN public.venues.invited_at IS
  'Timestamp when the organizer invited this venue.';

CREATE TABLE IF NOT EXISTS public.organizer_venue_relationships (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  organizer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('organizer_invite', 'platform_booking', 'self_added')),
  trust_tier text NOT NULL DEFAULT 'known' CHECK (trust_tier IN ('known', 'preferred', 'regular')),
  first_worked_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_user_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_organizer_venue_relationships_venue
  ON public.organizer_venue_relationships(venue_id);

CREATE INDEX IF NOT EXISTS idx_organizer_venue_relationships_organizer
  ON public.organizer_venue_relationships(organizer_user_id);

CREATE TABLE IF NOT EXISTS public.venue_term_agreements (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  term_type text NOT NULL CHECK (term_type IN ('flat_rental', 'minimum_spend', 'per_head_chi', 'bar_chi', 'no_charge', 'tbd')),
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'superseded')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  source_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_term_agreements_confirmed_pair
  ON public.venue_term_agreements(organizer_user_id, venue_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_venue_term_agreements_venue
  ON public.venue_term_agreements(venue_id);

CREATE INDEX IF NOT EXISTS idx_venue_term_agreements_organizer
  ON public.venue_term_agreements(organizer_user_id);

ALTER TABLE public.organizer_venue_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_term_agreements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view own venue relationships"
  ON public.organizer_venue_relationships;
DROP POLICY IF EXISTS "Organizers can insert own venue relationships"
  ON public.organizer_venue_relationships;
DROP POLICY IF EXISTS "Organizers can update own venue relationships"
  ON public.organizer_venue_relationships;
DROP POLICY IF EXISTS "Organizers can delete own venue relationships"
  ON public.organizer_venue_relationships;

CREATE POLICY "Organizers can view own venue relationships"
  ON public.organizer_venue_relationships
  FOR SELECT
  USING (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can insert own venue relationships"
  ON public.organizer_venue_relationships
  FOR INSERT
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can update own venue relationships"
  ON public.organizer_venue_relationships
  FOR UPDATE
  USING (organizer_user_id = auth.uid())
  WITH CHECK (organizer_user_id = auth.uid());

CREATE POLICY "Organizers can delete own venue relationships"
  ON public.organizer_venue_relationships
  FOR DELETE
  USING (organizer_user_id = auth.uid());

DROP POLICY IF EXISTS "Parties can view venue term agreements"
  ON public.venue_term_agreements;
DROP POLICY IF EXISTS "Parties can insert venue term agreements"
  ON public.venue_term_agreements;
DROP POLICY IF EXISTS "Parties can update venue term agreements"
  ON public.venue_term_agreements;

CREATE POLICY "Parties can view venue term agreements"
  ON public.venue_term_agreements
  FOR SELECT
  USING (
    organizer_user_id = auth.uid()
    OR venue_id IN (
      SELECT id
      FROM public.venues
      WHERE owner_id = auth.uid() OR claimed_user_id = auth.uid()
    )
  );

CREATE POLICY "Parties can insert venue term agreements"
  ON public.venue_term_agreements
  FOR INSERT
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR venue_id IN (
      SELECT id
      FROM public.venues
      WHERE owner_id = auth.uid() OR claimed_user_id = auth.uid()
    )
  );

CREATE POLICY "Parties can update venue term agreements"
  ON public.venue_term_agreements
  FOR UPDATE
  USING (
    organizer_user_id = auth.uid()
    OR venue_id IN (
      SELECT id
      FROM public.venues
      WHERE owner_id = auth.uid() OR claimed_user_id = auth.uid()
    )
  )
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR venue_id IN (
      SELECT id
      FROM public.venues
      WHERE owner_id = auth.uid() OR claimed_user_id = auth.uid()
    )
  );

REVOKE ALL ON TABLE public.organizer_venue_relationships FROM anon, authenticated;
REVOKE ALL ON TABLE public.venue_term_agreements FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organizer_venue_relationships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.venue_term_agreements TO authenticated;

GRANT ALL ON TABLE public.organizer_venue_relationships TO service_role;
GRANT ALL ON TABLE public.venue_term_agreements TO service_role;

CREATE OR REPLACE FUNCTION public.create_venue_invite(
  p_organizer_user_id uuid,
  p_venue_name text,
  p_contact_email text,
  p_contact_name text DEFAULT NULL,
  p_contact_role text DEFAULT NULL,
  p_venue_type text DEFAULT 'other',
  p_city text DEFAULT NULL,
  p_state text DEFAULT 'CA',
  p_standing_capacity integer DEFAULT NULL,
  p_seated_capacity integer DEFAULT NULL,
  p_term_type text DEFAULT 'tbd',
  p_amount_cents integer DEFAULT NULL,
  p_source_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  venue_id uuid,
  relationship_id uuid,
  term_agreement_id uuid,
  existing boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_venue_id uuid;
  v_relationship_id uuid;
  v_term_agreement_id uuid;
  v_normalized_email text;
  v_venue_type text;
BEGIN
  IF p_organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'organizer_user_id is required';
  END IF;

  IF NULLIF(BTRIM(p_venue_name), '') IS NULL THEN
    RAISE EXCEPTION 'venue_name is required';
  END IF;

  v_normalized_email := LOWER(NULLIF(BTRIM(p_contact_email), ''));
  IF v_normalized_email IS NULL THEN
    RAISE EXCEPTION 'contact_email is required';
  END IF;

  IF p_term_type NOT IN ('flat_rental', 'minimum_spend', 'per_head_chi', 'bar_chi', 'no_charge', 'tbd') THEN
    RAISE EXCEPTION 'unsupported term_type: %', p_term_type;
  END IF;

  IF p_amount_cents IS NOT NULL AND p_amount_cents < 0 THEN
    RAISE EXCEPTION 'amount_cents must be non-negative';
  END IF;

  v_venue_type := CASE p_venue_type
    WHEN 'loft_warehouse' THEN 'loft_warehouse'
    WHEN 'gallery' THEN 'gallery'
    WHEN 'restaurant' THEN 'restaurant'
    WHEN 'rooftop' THEN 'rooftop'
    WHEN 'conference_center' THEN 'conference_center'
    ELSE 'other'
  END;

  SELECT venues.id
  INTO v_venue_id
  FROM public.organizer_venue_relationships
  JOIN public.venues
    ON venues.id = organizer_venue_relationships.venue_id
  WHERE organizer_venue_relationships.organizer_user_id = p_organizer_user_id
    AND LOWER(COALESCE(venues.contact_email, '')) = v_normalized_email
  ORDER BY organizer_venue_relationships.created_at DESC
  LIMIT 1;

  IF v_venue_id IS NOT NULL THEN
    SELECT id
    INTO v_relationship_id
    FROM public.organizer_venue_relationships
    WHERE organizer_user_id = p_organizer_user_id
      AND venue_id = v_venue_id
    LIMIT 1;

    SELECT id
    INTO v_term_agreement_id
    FROM public.venue_term_agreements
    WHERE organizer_user_id = p_organizer_user_id
      AND venue_id = v_venue_id
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY SELECT v_venue_id, v_relationship_id, v_term_agreement_id, true;
    RETURN;
  END IF;

  INSERT INTO public.venues (
    owner_id,
    venue_name,
    venue_type,
    city,
    state,
    standing_capacity,
    seated_capacity,
    contact_email,
    contact_name,
    contact_role,
    claim_status,
    invited_by_user_id,
    invited_at,
    is_published,
    is_claimed,
    is_admin_seeded,
    pricing_model,
    description
  )
  VALUES (
    NULL,
    BTRIM(p_venue_name),
    v_venue_type,
    NULLIF(BTRIM(p_city), ''),
    COALESCE(NULLIF(BTRIM(p_state), ''), 'CA'),
    p_standing_capacity,
    p_seated_capacity,
    v_normalized_email,
    NULLIF(BTRIM(p_contact_name), ''),
    NULLIF(BTRIM(p_contact_role), ''),
    'invited_unclaimed',
    p_organizer_user_id,
    now(),
    false,
    false,
    false,
    NULL,
    'Invited by organizer; pending venue signup.'
  )
  RETURNING id INTO v_venue_id;

  INSERT INTO public.organizer_venue_relationships (
    organizer_user_id,
    venue_id,
    source,
    trust_tier
  )
  VALUES (
    p_organizer_user_id,
    v_venue_id,
    'organizer_invite',
    'known'
  )
  RETURNING id INTO v_relationship_id;

  IF p_term_type <> 'tbd' OR p_amount_cents IS NOT NULL THEN
    INSERT INTO public.venue_term_agreements (
      venue_id,
      organizer_user_id,
      term_type,
      amount_cents,
      source_event_id,
      status
    )
    VALUES (
      v_venue_id,
      p_organizer_user_id,
      p_term_type,
      p_amount_cents,
      p_source_event_id,
      'proposed'
    )
    RETURNING id INTO v_term_agreement_id;
  END IF;

  RETURN QUERY SELECT v_venue_id, v_relationship_id, v_term_agreement_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_venue_invite(uuid, text, text, text, text, text, text, text, integer, integer, text, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_venue_invite(uuid, text, text, text, text, text, text, text, integer, integer, text, integer, uuid) TO authenticated, service_role;
