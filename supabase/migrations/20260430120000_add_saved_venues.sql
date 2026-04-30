-- ============================================================================
-- CANONICAL SAVED VENUES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.saved_venues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, venue_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_venues_user_id
  ON public.saved_venues(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_venues_venue_id
  ON public.saved_venues(venue_id);

ALTER TABLE public.saved_venues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own saved venues" ON public.saved_venues;
CREATE POLICY "Users can view own saved venues"
  ON public.saved_venues FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can save venues" ON public.saved_venues;
CREATE POLICY "Users can save venues"
  ON public.saved_venues FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own saved venues" ON public.saved_venues;
CREATE POLICY "Users can update own saved venues"
  ON public.saved_venues FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove own saved venues" ON public.saved_venues;
CREATE POLICY "Users can remove own saved venues"
  ON public.saved_venues FOR DELETE
  USING (auth.uid() = user_id);

GRANT ALL ON TABLE public.saved_venues TO anon;
GRANT ALL ON TABLE public.saved_venues TO authenticated;
GRANT ALL ON TABLE public.saved_venues TO service_role;
