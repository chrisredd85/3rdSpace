-- Migration: Discovery freshness notification log and vendor profile link
-- Created: 2026-06-27
-- Context: Tracks organizer notifications emitted by discovery freshness
-- cascades and links claimed vendor profiles to discovery vendor rows so
-- self-service profile updates can participate in the same freshness loop.

ALTER TABLE public.discovery_vendors
  DROP CONSTRAINT IF EXISTS discovery_vendors_source_check;

ALTER TABLE public.discovery_vendors
  ADD CONSTRAINT discovery_vendors_source_check
  CHECK (source IN ('google_places', 'manual_seed', 'creator_referral', 'scrape', 'vendor_self_service'));

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS discovery_vendor_id UUID REFERENCES public.discovery_vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_discovery_vendor
  ON public.vendor_profiles(discovery_vendor_id)
  WHERE discovery_vendor_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_profiles.discovery_vendor_id IS
  'Links claimed/self-service vendor profiles to discovery_vendors so profile updates can write discovery freshness events and cascade stale planner state.';

CREATE TABLE IF NOT EXISTS public.discovery_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type VARCHAR(32) NOT NULL,
  entity_id UUID NOT NULL,
  source VARCHAR(32) NOT NULL,
  notification_type VARCHAR(64) NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discovery_notification_entity_type_check
    CHECK (entity_type IN ('discovery_venue', 'discovery_vendor'))
);

COMMENT ON TABLE public.discovery_notification_log IS
  'Rate-limit ledger for organizer-facing discovery freshness notifications. Prevents chained Places/vendor/Stripe updates from spamming organizers.';

CREATE INDEX IF NOT EXISTS idx_discovery_notification_recent
  ON public.discovery_notification_log(user_id, entity_type, entity_id, source, notification_type, sent_at DESC);

ALTER TABLE public.discovery_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own discovery notification log" ON public.discovery_notification_log;
CREATE POLICY "Users can read own discovery notification log"
  ON public.discovery_notification_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage discovery notification log" ON public.discovery_notification_log;
CREATE POLICY "Service role can manage discovery notification log"
  ON public.discovery_notification_log FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.discovery_notification_log TO authenticated;
GRANT ALL ON public.discovery_notification_log TO service_role;
