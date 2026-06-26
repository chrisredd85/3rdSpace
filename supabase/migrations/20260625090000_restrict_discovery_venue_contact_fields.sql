-- Migration: Restrict discovery venue contact fields behind a plan-scoped view
-- Created: 2026-06-25
-- Context: Google Places discovery rows are reusable global supply leads. Raw
-- contact fields should not be broadly readable by every authenticated user.
-- Planner routes read the filtered view after a venue is attached to the
-- organizer's plan.

CREATE OR REPLACE FUNCTION public.can_read_discovery_venue_contact(
  p_discovery_venue_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT
    COALESCE(auth.jwt()->>'role', '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.plan_discovery_venue_candidates candidate
      JOIN public.plans plan
        ON plan.id = candidate.plan_id
      WHERE candidate.discovery_venue_id = p_discovery_venue_id
        AND candidate.dismissed_at IS NULL
        AND candidate.status IS DISTINCT FROM 'dismissed'
        AND plan.user_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.can_read_discovery_venue_contact(UUID) IS
  'Returns true when the current JWT may see contact fields for a discovery venue: service role or the owner of an active plan candidate.';

REVOKE ALL ON FUNCTION public.can_read_discovery_venue_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_discovery_venue_contact(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_discovery_venue_contact(UUID) TO service_role;

CREATE OR REPLACE VIEW public.discovery_venues_with_contact
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  v.id,
  v.name,
  v.address,
  v.neighborhood,
  v.city,
  v.state,
  v.lat,
  v.lng,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.contact_email ELSE NULL END AS contact_email,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.contact_phone ELSE NULL END AS contact_phone,
  v.website,
  v.instagram_handle,
  v.capacity_seated,
  v.capacity_standing,
  v.capacity_cocktail,
  v.inferred_capacity_standing,
  v.inferred_capacity_seated,
  v.capacity_inference_confidence,
  v.capacity_inference_source_quote,
  v.capacity_inference_model,
  v.capacity_inference_extracted_at,
  v.capacity_inference_admin_status,
  v.vibe_tags,
  v.alcohol_policy,
  v.av_available,
  v.parking_notes,
  v.price_hint_cents_low,
  v.price_hint_cents_high,
  v.price_hint_note,
  v.source,
  v.source_external_id,
  v.google_rating,
  v.google_user_ratings_total,
  v.google_photo_names,
  v.opening_hours_json,
  v.metadata,
  v.last_enriched_at,
  v.last_verified_at,
  v.is_claimed,
  v.claimed_venue_id,
  v.created_at,
  v.updated_at,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.extracted_emails ELSE '[]'::jsonb END AS extracted_emails,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.website_extraction_attempted_at ELSE NULL END AS website_extraction_attempted_at,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.website_extraction_status ELSE NULL END AS website_extraction_status,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.website_extraction_metadata ELSE '{}'::jsonb END AS website_extraction_metadata,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.website_extraction_attempts ELSE 0 END AS website_extraction_attempts,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.organizer_provided_emails ELSE '[]'::jsonb END AS organizer_provided_emails,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.organizer_rescue_count ELSE 0 END AS organizer_rescue_count,
  CASE WHEN public.can_read_discovery_venue_contact(v.id) THEN v.last_rescue_at ELSE NULL END AS last_rescue_at,
  v.photos
FROM public.discovery_venues v;

COMMENT ON VIEW public.discovery_venues_with_contact IS
  'Plan-scoped read view for discovery venues. Raw contact/enrichment fields are only visible to service_role or organizers with an active plan candidate for the venue.';

REVOKE ALL ON public.discovery_venues_with_contact FROM PUBLIC;
GRANT SELECT ON public.discovery_venues_with_contact TO authenticated;
GRANT SELECT ON public.discovery_venues_with_contact TO service_role;

REVOKE SELECT ON public.discovery_venues FROM authenticated;
REVOKE SELECT ON public.discovery_venues FROM anon;

GRANT SELECT (
  id,
  name,
  address,
  neighborhood,
  city,
  state,
  lat,
  lng,
  website,
  instagram_handle,
  capacity_seated,
  capacity_standing,
  capacity_cocktail,
  inferred_capacity_standing,
  inferred_capacity_seated,
  capacity_inference_confidence,
  capacity_inference_source_quote,
  capacity_inference_model,
  capacity_inference_extracted_at,
  capacity_inference_admin_status,
  vibe_tags,
  alcohol_policy,
  av_available,
  parking_notes,
  price_hint_cents_low,
  price_hint_cents_high,
  price_hint_note,
  source,
  source_external_id,
  google_rating,
  google_user_ratings_total,
  google_photo_names,
  opening_hours_json,
  metadata,
  last_enriched_at,
  last_verified_at,
  is_claimed,
  claimed_venue_id,
  created_at,
  updated_at,
  photos
) ON public.discovery_venues TO authenticated;

GRANT ALL ON public.discovery_venues TO service_role;
