-- Prompt 8 confirmation follow-up must be safe under concurrent exact replay.
-- Manual invoice regeneration remains supported (NULL generation key), while
-- automatic confirmation-driven generation has exactly one key per booking.

ALTER TABLE public.vendor_invoices
  ADD COLUMN IF NOT EXISTS booking_generation_key UUID;

WITH first_invoice AS (
  SELECT DISTINCT ON (invoice.booking_id)
    invoice.id,
    invoice.booking_id
  FROM public.vendor_invoices AS invoice
  ORDER BY invoice.booking_id, invoice.created_at, invoice.id
)
UPDATE public.vendor_invoices AS invoice
SET booking_generation_key = first_invoice.booking_id
FROM first_invoice
WHERE invoice.id = first_invoice.id
  AND invoice.booking_generation_key IS NULL;

ALTER TABLE public.vendor_invoices
  DROP CONSTRAINT IF EXISTS vendor_invoices_generation_key_matches_booking;
ALTER TABLE public.vendor_invoices
  ADD CONSTRAINT vendor_invoices_generation_key_matches_booking
  CHECK (
    booking_generation_key IS NULL
    OR booking_generation_key = booking_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS vendor_invoices_booking_generation_unique
  ON public.vendor_invoices(booking_generation_key)
  WHERE booking_generation_key IS NOT NULL;

COMMENT ON COLUMN public.vendor_invoices.booking_generation_key IS
  'Idempotency key for automatic confirmation-driven invoice generation. NULL permits explicit manual regeneration.';
