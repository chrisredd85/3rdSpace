-- ============================================================================
-- VENDOR INVOICES
-- ============================================================================

ALTER TABLE public.vendor_profiles
  ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC(5,2) DEFAULT 0;

ALTER TABLE public.vendor_profiles
  DROP CONSTRAINT IF EXISTS vendor_profiles_default_tax_rate_check;

ALTER TABLE public.vendor_profiles
  ADD CONSTRAINT vendor_profiles_default_tax_rate_check
    CHECK (default_tax_rate >= 0 AND default_tax_rate <= 100);

CREATE TABLE IF NOT EXISTS public.vendor_invoice_sequences (
  invoice_year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_vendor_invoice_number(p_year INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_value INTEGER;
BEGIN
  INSERT INTO public.vendor_invoice_sequences (invoice_year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (invoice_year)
  DO UPDATE SET last_value = public.vendor_invoice_sequences.last_value + 1
  RETURNING last_value INTO next_value;

  RETURN 'INV-' || p_year::text || '-' || lpad(next_value::text, 4, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.vendor_invoices (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  booking_id UUID NOT NULL REFERENCES public.vendor_bookings(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES public.vendor_profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  builder_id UUID NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  deposit_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  deposit_due_date DATE,
  deposit_paid BOOLEAN NOT NULL DEFAULT false,
  deposit_paid_at TIMESTAMPTZ,
  final_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  final_due_date DATE,
  final_paid BOOLEAN NOT NULL DEFAULT false,
  final_paid_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_invoices_status_check
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  CONSTRAINT vendor_invoices_line_items_array_check
    CHECK (jsonb_typeof(line_items) = 'array'),
  CONSTRAINT vendor_invoices_amounts_check
    CHECK (
      subtotal >= 0
      AND tax_rate >= 0
      AND tax_amount >= 0
      AND total >= 0
      AND deposit_amount >= 0
      AND final_amount >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_booking_id
  ON public.vendor_invoices(booking_id);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_vendor_id
  ON public.vendor_invoices(vendor_id);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_event_id
  ON public.vendor_invoices(event_id);

CREATE INDEX IF NOT EXISTS idx_vendor_invoices_builder_id
  ON public.vendor_invoices(builder_id);

DROP TRIGGER IF EXISTS update_vendor_invoices_updated_at
  ON public.vendor_invoices;

CREATE TRIGGER update_vendor_invoices_updated_at
  BEFORE UPDATE ON public.vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vendor_invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoices',
  'invoices',
  true,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Vendors can view own invoices" ON public.vendor_invoices;
CREATE POLICY "Vendors can view own invoices"
  ON public.vendor_invoices
  FOR SELECT
  USING (
    vendor_id IN (
      SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can view own invoices" ON public.vendor_invoices;
CREATE POLICY "Builders can view own invoices"
  ON public.vendor_invoices
  FOR SELECT
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view own invoices" ON storage.objects;
CREATE POLICY "Users can view own invoices"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND (
      name IN (
        SELECT invoice_number || '.pdf'
        FROM public.vendor_invoices
        WHERE builder_id IN (
          SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
        )
      )
      OR name IN (
        SELECT invoice_number || '.pdf'
        FROM public.vendor_invoices
        WHERE vendor_id IN (
          SELECT id FROM public.vendor_profiles WHERE user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Service role full access invoices storage" ON storage.objects;
CREATE POLICY "Service role full access invoices storage"
  ON storage.objects
  FOR ALL
  USING (bucket_id = 'invoices' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'invoices' AND auth.role() = 'service_role');

GRANT ALL ON TABLE public.vendor_invoice_sequences TO service_role;
GRANT ALL ON TABLE public.vendor_invoices TO anon;
GRANT ALL ON TABLE public.vendor_invoices TO authenticated;
GRANT ALL ON TABLE public.vendor_invoices TO service_role;
GRANT EXECUTE ON FUNCTION public.next_vendor_invoice_number(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_vendor_invoice_number(INTEGER) TO service_role;
