-- ============================================================================
-- VENUE BULK APPROVAL AND AUTO-APPROVAL SETTINGS
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS bulk_approval_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_approve_threshold NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS auto_approve_conditions JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_auto_approve_threshold_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_auto_approve_threshold_check
    CHECK (auto_approve_threshold IS NULL OR auto_approve_threshold >= 0);

ALTER TABLE public.venue_bookings
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_source TEXT;

ALTER TABLE public.venue_bookings
  DROP CONSTRAINT IF EXISTS venue_bookings_approval_source_check;

ALTER TABLE public.venue_bookings
  ADD CONSTRAINT venue_bookings_approval_source_check
    CHECK (approval_source IS NULL OR approval_source IN ('manual', 'bulk', 'auto'));

CREATE TABLE IF NOT EXISTS public.venue_booking_approval_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.venue_bookings(id) ON DELETE CASCADE,
  actor_id UUID,
  action TEXT NOT NULL CHECK (action IN ('bulk_approve', 'bulk_reject')),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venue_booking_approval_audit_venue
  ON public.venue_booking_approval_audit(venue_id);

CREATE INDEX IF NOT EXISTS idx_venue_booking_approval_audit_booking
  ON public.venue_booking_approval_audit(booking_id);

ALTER TABLE public.venue_booking_approval_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Venue owners can view approval audit" ON public.venue_booking_approval_audit;
CREATE POLICY "Venue owners can view approval audit"
  ON public.venue_booking_approval_audit FOR SELECT
  USING (
    venue_id IN (
      SELECT id FROM public.venues WHERE owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Venue owners can insert approval audit" ON public.venue_booking_approval_audit;
CREATE POLICY "Venue owners can insert approval audit"
  ON public.venue_booking_approval_audit FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND venue_id IN (
      SELECT id FROM public.venues WHERE owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.apply_venue_booking_auto_approval()
RETURNS TRIGGER AS $$
DECLARE
  venue_settings RECORD;
  event_settings RECORD;
  booking_amount NUMERIC;
  min_notice_days INTEGER;
  max_capacity INTEGER;
  event_notice_days INTEGER;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT
    bulk_approval_enabled,
    auto_approve_threshold,
    COALESCE(auto_approve_conditions, '{}'::jsonb) AS auto_approve_conditions
  INTO venue_settings
  FROM public.venues
  WHERE id = NEW.venue_id;

  IF venue_settings.bulk_approval_enabled IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  booking_amount := COALESCE(NEW.final_price, NEW.quoted_price, 0);

  IF venue_settings.auto_approve_threshold IS NOT NULL
    AND booking_amount > venue_settings.auto_approve_threshold THEN
    RETURN NEW;
  END IF;

  SELECT
    e.event_date,
    NULLIF(
      COALESCE(
        to_jsonb(e)->>'expected_attendees',
        to_jsonb(e)->>'expected_attendance',
        to_jsonb(e)->>'expected_attendance_min',
        to_jsonb(e)->>'expected_attendance_max'
      ),
      ''
    )::INTEGER AS expected_attendees
  INTO event_settings
  FROM public.events e
  WHERE e.id = NEW.event_id;

  min_notice_days := NULLIF(venue_settings.auto_approve_conditions->>'minNotice', '')::INTEGER;
  max_capacity := NULLIF(venue_settings.auto_approve_conditions->>'maxCapacity', '')::INTEGER;

  IF min_notice_days IS NOT NULL AND event_settings.event_date IS NOT NULL THEN
    event_notice_days := event_settings.event_date::date - CURRENT_DATE;
    IF event_notice_days < min_notice_days THEN
      RETURN NEW;
    END IF;
  END IF;

  IF max_capacity IS NOT NULL
    AND event_settings.expected_attendees IS NOT NULL
    AND event_settings.expected_attendees > max_capacity THEN
    RETURN NEW;
  END IF;

  NEW.status := 'confirmed';
  NEW.approved_at := COALESCE(NEW.approved_at, NOW());
  NEW.approval_source := 'auto';
  NEW.updated_at := NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS venue_booking_auto_approval_before_write ON public.venue_bookings;
CREATE TRIGGER venue_booking_auto_approval_before_write
  BEFORE INSERT OR UPDATE OF status, quoted_price, final_price, venue_id, event_id
  ON public.venue_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_venue_booking_auto_approval();
