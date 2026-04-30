-- ============================================================================
-- MODERN MESSAGE BOOKING REFERENCES
-- ============================================================================
-- Generic venue conversations should reference venue_bookings directly instead
-- of forcing venue booking ids into messages.booking_id, which points at the
-- legacy bookings table.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS venue_booking_id UUID;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_venue_booking_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_venue_booking_id_fkey
    FOREIGN KEY (venue_booking_id)
    REFERENCES public.venue_bookings(id)
    ON DELETE CASCADE;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_check;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_thread_or_booking_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_thread_or_booking_check
    CHECK (
      thread_id IS NOT NULL
      OR booking_id IS NOT NULL
      OR venue_booking_id IS NOT NULL
      OR vendor_booking_id IS NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_messages_venue_booking
  ON public.messages(venue_booking_id);

CREATE INDEX IF NOT EXISTS idx_message_threads_booking_context
  ON public.message_threads(booking_type, booking_id);
