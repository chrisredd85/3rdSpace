-- ============================================================================
-- VENUE TICKET SALES SHARE SETTINGS
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS ticket_sales_share_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_sales_share_percent NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bar_revenue_share_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS bar_revenue_share_percent NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_head_kickback_amount NUMERIC(10,2) DEFAULT 0;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_ticket_sales_share_percent_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_ticket_sales_share_percent_check
  CHECK (ticket_sales_share_percent >= 0 AND ticket_sales_share_percent <= 100);

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_bar_revenue_share_percent_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_bar_revenue_share_percent_check
  CHECK (bar_revenue_share_percent >= 0 AND bar_revenue_share_percent <= 100);

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_per_head_kickback_amount_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_per_head_kickback_amount_check
  CHECK (per_head_kickback_amount >= 0);

ALTER TABLE public.event_financial_summary
  ADD COLUMN IF NOT EXISTS venue_sales_share_projection NUMERIC(10,2) DEFAULT 0;
