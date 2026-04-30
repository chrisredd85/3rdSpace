-- ============================================================================
-- BUILDER VENUE BOOKING REQUEST CREATION
-- ============================================================================

DROP POLICY IF EXISTS "Organizers can create venue booking requests" ON public.venue_bookings;
CREATE POLICY "Organizers can create venue booking requests"
  ON public.venue_bookings FOR INSERT
  WITH CHECK (
    organizer_id = auth.uid()
    AND status = 'pending'
  );

