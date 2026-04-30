-- ============================================================================
-- VENDOR BOOKING CANCELLATION REFUNDS
-- ============================================================================

ALTER TABLE public.vendor_bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2) DEFAULT 0;

ALTER TABLE public.vendor_bookings
  DROP CONSTRAINT IF EXISTS vendor_bookings_refund_amount_check;

ALTER TABLE public.vendor_bookings
  ADD CONSTRAINT vendor_bookings_refund_amount_check
    CHECK (refund_amount IS NULL OR refund_amount >= 0);
