-- ============================================================================
-- GROWTH PATH INDEXES
-- ============================================================================
-- These indexes cover the high-traffic marketplace, booking dashboard, and
-- messaging access patterns used by the app as seeded data grows.

CREATE INDEX IF NOT EXISTS idx_venues_marketplace_filters
  ON public.venues(is_published, city, venue_type, standing_capacity, hourly_rate);

CREATE INDEX IF NOT EXISTS idx_vendor_profiles_marketplace_filters
  ON public.vendor_profiles(is_published, service_type, average_rating, total_bookings);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_venue_status_date
  ON public.venue_bookings(venue_id, status, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_organizer_status_date
  ON public.venue_bookings(organizer_id, status, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_venue_bookings_event
  ON public.venue_bookings(event_id);

CREATE INDEX IF NOT EXISTS idx_vendor_bookings_vendor_status_date
  ON public.vendor_bookings(vendor_id, status, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_bookings_organizer_status_date
  ON public.vendor_bookings(organizer_id, status, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_bookings_event
  ON public.vendor_bookings(event_id);

CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON public.messages(thread_id, created_at);

DO $$
BEGIN
  IF to_regclass('public.vendor_messages') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_vendor_messages_thread_created
      ON public.vendor_messages(thread_id, created_at);
  END IF;
END $$;
