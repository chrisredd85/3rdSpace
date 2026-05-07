-- Migration: Add normalized ticketing tier analytics
-- Created: 2026-05-04
-- Context: Planner analytics need provider-normalized ticket sales rollups across
-- Eventbrite, Luma, Posh, and Partiful-style event imports.

ALTER TABLE public.event_sales_data
  ADD COLUMN IF NOT EXISTS ticket_tier_name        text,
  ADD COLUMN IF NOT EXISTS ticket_tier_category    text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sales_channel           text,
  ADD COLUMN IF NOT EXISTS currency                text NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS ticket_price_cents      integer,
  ADD COLUMN IF NOT EXISTS total_amount_cents      integer,
  ADD COLUMN IF NOT EXISTS fees_cents              integer,
  ADD COLUMN IF NOT EXISTS raw_ticket_class_id     text;

ALTER TABLE public.event_sales_data
  DROP CONSTRAINT IF EXISTS event_sales_data_ticket_tier_category_check;

ALTER TABLE public.event_sales_data
  ADD CONSTRAINT event_sales_data_ticket_tier_category_check
  CHECK (
    ticket_tier_category IN (
      'early_bird',
      'general_admission',
      'vip',
      'comp',
      'donation',
      'waitlist',
      'other',
      'unknown'
    )
  );

ALTER TABLE public.event_sales_data
  ADD CONSTRAINT event_sales_data_ticket_price_cents_check
  CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0);

ALTER TABLE public.event_sales_data
  ADD CONSTRAINT event_sales_data_fees_cents_check
  CHECK (fees_cents IS NULL OR fees_cents >= 0);

COMMENT ON COLUMN public.event_sales_data.ticket_tier_name IS
  'Provider ticket tier/class display name, such as Early Bird, General Admission, or VIP.';
COMMENT ON COLUMN public.event_sales_data.ticket_tier_category IS
  'Normalized ticket tier category used for cross-platform analytics.';
COMMENT ON COLUMN public.event_sales_data.sales_channel IS
  'Source channel when available, such as web, app, door, comp, invite, or import.';
COMMENT ON COLUMN public.event_sales_data.ticket_price_cents IS
  'Per-ticket price stored as integer cents.';
COMMENT ON COLUMN public.event_sales_data.total_amount_cents IS
  'Order or ticket total stored as integer cents. Refund rows may be negative.';
COMMENT ON COLUMN public.event_sales_data.fees_cents IS
  'Provider/payment fees stored as integer cents.';
COMMENT ON COLUMN public.event_sales_data.raw_ticket_class_id IS
  'Provider ticket class/tier identifier when available.';

ALTER TABLE public.imported_attendees
  ADD COLUMN IF NOT EXISTS ticket_tier_name        text,
  ADD COLUMN IF NOT EXISTS ticket_tier_category    text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS ticket_price_cents      integer,
  ADD COLUMN IF NOT EXISTS raw_ticket_class_id     text;

ALTER TABLE public.imported_attendees
  DROP CONSTRAINT IF EXISTS imported_attendees_ticket_tier_category_check;

ALTER TABLE public.imported_attendees
  ADD CONSTRAINT imported_attendees_ticket_tier_category_check
  CHECK (
    ticket_tier_category IN (
      'early_bird',
      'general_admission',
      'vip',
      'comp',
      'donation',
      'waitlist',
      'other',
      'unknown'
    )
  );

ALTER TABLE public.imported_attendees
  ADD CONSTRAINT imported_attendees_ticket_price_cents_check
  CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_event_sales_tier_rollup
  ON public.event_sales_data(event_id, platform, ticket_tier_category, ticket_tier_name);

CREATE INDEX IF NOT EXISTS idx_event_sales_purchase_timestamp
  ON public.event_sales_data(event_id, purchase_timestamp);

CREATE INDEX IF NOT EXISTS idx_imported_attendees_tier_rollup
  ON public.imported_attendees(event_id, ticket_tier_category, ticket_tier_name);

CREATE OR REPLACE VIEW public.event_ticket_sales_rollups AS
SELECT
  event_id,
  platform,
  COALESCE(ticket_tier_category, 'unknown') AS ticket_tier_category,
  COALESCE(ticket_tier_name, ticket_type, 'Unknown') AS ticket_tier_name,
  COALESCE(currency, 'usd') AS currency,
  SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END)::integer AS tickets_sold,
  SUM(CASE WHEN COALESCE(is_refund, false) THEN ABS(ticket_quantity) ELSE 0 END)::integer AS tickets_refunded,
  SUM(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0))::integer AS gross_revenue_cents,
  SUM(COALESCE(fees_cents, ROUND(COALESCE(fees, 0) * 100)::integer, 0))::integer AS fees_cents,
  SUM(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0))
    - SUM(COALESCE(fees_cents, ROUND(COALESCE(fees, 0) * 100)::integer, 0)) AS net_revenue_cents,
  CASE
    WHEN SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END) > 0
      THEN ROUND(
        SUM(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0))::numeric
        / SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END)
      )::integer
    ELSE 0
  END AS average_ticket_price_cents,
  MIN(purchase_timestamp) AS first_sale_at,
  MAX(purchase_timestamp) AS last_sale_at
FROM public.event_sales_data
GROUP BY
  event_id,
  platform,
  COALESCE(ticket_tier_category, 'unknown'),
  COALESCE(ticket_tier_name, ticket_type, 'Unknown'),
  COALESCE(currency, 'usd');

COMMENT ON VIEW public.event_ticket_sales_rollups IS
  'Provider-normalized ticket tier rollups for analytics: Early Bird vs GA vs VIP, by platform and event.';

GRANT SELECT ON public.event_ticket_sales_rollups TO authenticated;
GRANT SELECT ON public.event_ticket_sales_rollups TO service_role;
