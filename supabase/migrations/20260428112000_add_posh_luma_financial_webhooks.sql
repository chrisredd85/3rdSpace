-- ============================================================================
-- POSH/LUMA WEBHOOK FINANCIAL TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.external_event_integrations(id) ON DELETE SET NULL,
  external_event_id VARCHAR(255),
  webhook_event_id VARCHAR(255),
  webhook_type VARCHAR(100),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_webhook_events_event
  ON public.event_webhook_events(event_id);

CREATE INDEX IF NOT EXISTS idx_event_webhook_events_platform
  ON public.event_webhook_events(platform);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_webhook_events_platform_webhook_id
  ON public.event_webhook_events(platform, webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_sales_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  integration_id UUID REFERENCES public.external_event_integrations(id) ON DELETE SET NULL,
  order_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  ticket_buyer_name VARCHAR(255),
  ticket_buyer_email VARCHAR(255),
  ticket_quantity INTEGER NOT NULL,
  ticket_type VARCHAR(100),
  ticket_price NUMERIC(10,2),
  total_amount NUMERIC(10,2) NOT NULL,
  fees NUMERIC(10,2) DEFAULT 0,
  discount_code VARCHAR(100),
  is_refund BOOLEAN DEFAULT false,
  purchase_timestamp TIMESTAMPTZ,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, order_id)
);

ALTER TABLE public.event_sales_data
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES public.external_event_integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS order_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS ticket_buyer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ticket_buyer_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ticket_quantity INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ticket_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_refund BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_event_sales_event
  ON public.event_sales_data(event_id);

CREATE INDEX IF NOT EXISTS idx_event_sales_platform
  ON public.event_sales_data(platform);

CREATE INDEX IF NOT EXISTS idx_event_sales_email
  ON public.event_sales_data(ticket_buyer_email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_sales_platform_order
  ON public.event_sales_data(platform, order_id)
  WHERE order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_financial_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE UNIQUE,
  tickets_sold INTEGER DEFAULT 0,
  gross_revenue NUMERIC(10,2) DEFAULT 0,
  total_fees NUMERIC(10,2) DEFAULT 0,
  total_refunds NUMERIC(10,2) DEFAULT 0,
  net_revenue NUMERIC(10,2) DEFAULT 0,
  average_ticket_price NUMERIC(10,2) DEFAULT 0,
  current_attendance INTEGER DEFAULT 0,
  projected_attendance INTEGER DEFAULT 0,
  projected_revenue NUMERIC(10,2) DEFAULT 0,
  venue_cost NUMERIC(10,2) DEFAULT 0,
  vendor_cost NUMERIC(10,2) DEFAULT 0,
  total_costs NUMERIC(10,2) DEFAULT 0,
  expected_profit NUMERIC(10,2) DEFAULT 0,
  profit_margin NUMERIC(5,2) DEFAULT 0,
  break_even_tickets INTEGER DEFAULT 0,
  venue_kickback_projection NUMERIC(10,2) DEFAULT 0,
  per_attendee_value NUMERIC(10,2) DEFAULT 0,
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_summary_event
  ON public.event_financial_summary(event_id);

ALTER TABLE public.imported_attendees
  ADD COLUMN IF NOT EXISTS ticket_price NUMERIC(10,2);

ALTER TABLE public.event_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sales_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_financial_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event team can view webhook events" ON public.event_webhook_events;
CREATE POLICY "Event team can view webhook events"
  ON public.event_webhook_events FOR SELECT
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
    OR event_id IN (
      SELECT c.event_id
      FROM public.collaborators c
      WHERE c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Event team can view sales data" ON public.event_sales_data;
CREATE POLICY "Event team can view sales data"
  ON public.event_sales_data FOR SELECT
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
    OR event_id IN (
      SELECT c.event_id
      FROM public.collaborators c
      WHERE c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Event team can view financial summary" ON public.event_financial_summary;
CREATE POLICY "Event team can view financial summary"
  ON public.event_financial_summary FOR SELECT
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
    OR event_id IN (
      SELECT c.event_id
      FROM public.collaborators c
      WHERE c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage webhook events" ON public.event_webhook_events;
CREATE POLICY "Service role can manage webhook events"
  ON public.event_webhook_events FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage sales data" ON public.event_sales_data;
CREATE POLICY "Service role can manage sales data"
  ON public.event_sales_data FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage financial summary" ON public.event_financial_summary;
CREATE POLICY "Service role can manage financial summary"
  ON public.event_financial_summary FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP TRIGGER IF EXISTS update_event_sales_data_updated_at ON public.event_sales_data;
CREATE TRIGGER update_event_sales_data_updated_at
  BEFORE UPDATE ON public.event_sales_data
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_financial_summary_updated_at ON public.event_financial_summary;
CREATE TRIGGER update_event_financial_summary_updated_at
  BEFORE UPDATE ON public.event_financial_summary
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
