-- ============================================================================
-- VENDOR AVAILABILITY CALENDAR
-- ============================================================================

ALTER TABLE public.vendor_bookings
  ADD COLUMN IF NOT EXISTS vendor_offering_id UUID REFERENCES public.vendor_offerings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_package_id UUID REFERENCES public.vendor_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_date DATE,
  ADD COLUMN IF NOT EXISTS requested_start_time TIME,
  ADD COLUMN IF NOT EXISTS requested_end_time TIME,
  ADD COLUMN IF NOT EXISTS confirmed_date DATE,
  ADD COLUMN IF NOT EXISTS confirmed_start_time TIME,
  ADD COLUMN IF NOT EXISTS confirmed_end_time TIME,
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS deposit_paid BOOLEAN DEFAULT false;

DROP POLICY IF EXISTS "Organizers can create vendor booking requests" ON public.vendor_bookings;
CREATE POLICY "Organizers can create vendor booking requests"
  ON public.vendor_bookings FOR INSERT
  WITH CHECK (
    organizer_id = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Vendors can update own vendor bookings" ON public.vendor_bookings;
CREATE POLICY "Vendors can update own vendor bookings"
  ON public.vendor_bookings FOR UPDATE
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

UPDATE public.vendor_bookings
SET
  requested_date = COALESCE(requested_date, booking_date),
  requested_start_time = COALESCE(requested_start_time, start_time),
  requested_end_time = COALESCE(requested_end_time, end_time),
  confirmed_date = CASE
    WHEN status = 'confirmed' THEN COALESCE(confirmed_date, booking_date)
    ELSE confirmed_date
  END,
  confirmed_start_time = CASE
    WHEN status = 'confirmed' THEN COALESCE(confirmed_start_time, start_time)
    ELSE confirmed_start_time
  END,
  confirmed_end_time = CASE
    WHEN status = 'confirmed' THEN COALESCE(confirmed_end_time, end_time)
    ELSE confirmed_end_time
  END,
  deposit_paid = COALESCE(deposit_paid, false);

CREATE TABLE IF NOT EXISTS public.vendor_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendor_id UUID NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  booking_id UUID REFERENCES public.vendor_bookings(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT vendor_availability_status_check
    CHECK (status IN ('available', 'booked', 'blocked', 'tentative')),
  UNIQUE(vendor_id, date)
);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_vendor_month
  ON public.vendor_availability(vendor_id, date);

CREATE INDEX IF NOT EXISTS idx_vendor_availability_status
  ON public.vendor_availability(status);

ALTER TABLE public.vendor_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view vendor availability" ON public.vendor_availability;
CREATE POLICY "Anyone can view vendor availability"
  ON public.vendor_availability FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Vendors can manage own availability" ON public.vendor_availability;
CREATE POLICY "Vendors can manage own availability"
  ON public.vendor_availability FOR ALL
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage vendor availability" ON public.vendor_availability;
CREATE POLICY "Service role can manage vendor availability"
  ON public.vendor_availability FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP TRIGGER IF EXISTS update_vendor_availability_updated_at ON public.vendor_availability;
CREATE TRIGGER update_vendor_availability_updated_at
  BEFORE UPDATE ON public.vendor_availability
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_vendor_booking_calendar_date(p_booking public.vendor_bookings)
RETURNS DATE AS $$
BEGIN
  IF p_booking.status = 'confirmed' THEN
    RETURN COALESCE(p_booking.confirmed_date, p_booking.requested_date, p_booking.booking_date);
  END IF;

  RETURN COALESCE(p_booking.requested_date, p_booking.booking_date, p_booking.confirmed_date);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_vendor_double_booking()
RETURNS TRIGGER AS $$
DECLARE
  target_date DATE;
  conflicting_availability RECORD;
  conflicting_booking RECORD;
BEGIN
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  target_date := public.get_vendor_booking_calendar_date(NEW);
  IF target_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, status, booking_id, notes
  INTO conflicting_availability
  FROM public.vendor_availability
  WHERE vendor_id = NEW.vendor_id
    AND date = target_date
    AND status IN ('blocked', 'booked', 'tentative')
    AND (booking_id IS NULL OR booking_id <> NEW.id)
  LIMIT 1;

  IF conflicting_availability.id IS NOT NULL THEN
    RAISE EXCEPTION 'Vendor is not available on % (%).', target_date, conflicting_availability.status
      USING ERRCODE = '23514';
  END IF;

  SELECT id, status
  INTO conflicting_booking
  FROM public.vendor_bookings
  WHERE vendor_id = NEW.vendor_id
    AND id <> NEW.id
    AND status IN ('pending', 'confirmed')
    AND COALESCE(confirmed_date, requested_date, booking_date) = target_date
  LIMIT 1;

  IF conflicting_booking.id IS NOT NULL THEN
    RAISE EXCEPTION 'Vendor already has a % booking on %.', conflicting_booking.status, target_date
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_vendor_double_booking_before_write ON public.vendor_bookings;
CREATE TRIGGER prevent_vendor_double_booking_before_write
  BEFORE INSERT OR UPDATE OF status, booking_date, requested_date, confirmed_date, vendor_id
  ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_vendor_double_booking();

CREATE OR REPLACE FUNCTION public.sync_vendor_booking_availability()
RETURNS TRIGGER AS $$
DECLARE
  target_date DATE;
  next_status TEXT;
  next_notes TEXT;
BEGIN
  target_date := public.get_vendor_booking_calendar_date(NEW);
  IF target_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed' THEN
    next_status := 'booked';
    next_notes := 'Confirmed booking';
  ELSIF NEW.status = 'pending' THEN
    next_status := 'tentative';
    next_notes := 'Pending booking request';
  ELSE
    UPDATE public.vendor_availability
    SET status = 'available',
        booking_id = NULL,
        notes = NULL,
        updated_at = NOW()
    WHERE vendor_id = NEW.vendor_id
      AND booking_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.vendor_availability (vendor_id, date, status, booking_id, notes)
  VALUES (NEW.vendor_id, target_date, next_status, NEW.id, next_notes)
  ON CONFLICT (vendor_id, date) DO UPDATE
    SET status = EXCLUDED.status,
        booking_id = EXCLUDED.booking_id,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    WHERE public.vendor_availability.booking_id = NEW.id
       OR public.vendor_availability.status = 'available';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_vendor_booking_availability_after_write ON public.vendor_bookings;
CREATE TRIGGER sync_vendor_booking_availability_after_write
  AFTER INSERT OR UPDATE OF status, booking_date, requested_date, confirmed_date, vendor_id
  ON public.vendor_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vendor_booking_availability();
