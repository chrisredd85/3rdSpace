-- Migration: Align ticketing tier taxonomy and Partiful webhook support
-- Created: 2026-05-04
-- Context: Planner analytics normalize Eventbrite, Luma, Posh, and Partiful
-- ticket data into the MVP tier taxonomy used for pricing benchmarks.

UPDATE public.event_sales_data
SET ticket_tier_category = CASE ticket_tier_category
  WHEN 'general_admission' THEN 'ga'
  WHEN 'waitlist' THEN 'promo'
  WHEN 'other' THEN 'ga'
  WHEN 'unknown' THEN 'ga'
  ELSE ticket_tier_category
END
WHERE ticket_tier_category IN ('general_admission', 'waitlist', 'other', 'unknown');

UPDATE public.imported_attendees
SET ticket_tier_category = CASE ticket_tier_category
  WHEN 'general_admission' THEN 'ga'
  WHEN 'waitlist' THEN 'promo'
  WHEN 'other' THEN 'ga'
  WHEN 'unknown' THEN 'ga'
  ELSE ticket_tier_category
END
WHERE ticket_tier_category IN ('general_admission', 'waitlist', 'other', 'unknown');

ALTER TABLE public.event_sales_data
  ALTER COLUMN ticket_tier_category SET DEFAULT 'ga';

ALTER TABLE public.imported_attendees
  ALTER COLUMN ticket_tier_category SET DEFAULT 'ga';

ALTER TABLE public.event_sales_data
  DROP CONSTRAINT IF EXISTS event_sales_data_ticket_tier_category_check;

ALTER TABLE public.event_sales_data
  ADD CONSTRAINT event_sales_data_ticket_tier_category_check
  CHECK (
    ticket_tier_category IN (
      'early_bird',
      'ga',
      'vip',
      'comp',
      'promo',
      'donation',
      'add_on'
    )
  );

ALTER TABLE public.imported_attendees
  DROP CONSTRAINT IF EXISTS imported_attendees_ticket_tier_category_check;

ALTER TABLE public.imported_attendees
  ADD CONSTRAINT imported_attendees_ticket_tier_category_check
  CHECK (
    ticket_tier_category IN (
      'early_bird',
      'ga',
      'vip',
      'comp',
      'promo',
      'donation',
      'add_on'
    )
  );

ALTER TABLE public.builder_ticketing_connections
  DROP CONSTRAINT IF EXISTS builder_ticketing_connections_platform_check;

ALTER TABLE public.builder_ticketing_connections
  ADD CONSTRAINT builder_ticketing_connections_platform_check
  CHECK (platform IN ('eventbrite', 'luma', 'posh', 'partiful'));

CREATE OR REPLACE VIEW public.event_ticket_sales_rollups AS
SELECT
  event_id,
  platform,
  COALESCE(ticket_tier_category, 'ga') AS ticket_tier_category,
  COALESCE(ticket_tier_name, ticket_type, 'General Admission') AS ticket_tier_name,
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
  COALESCE(ticket_tier_category, 'ga'),
  COALESCE(ticket_tier_name, ticket_type, 'General Admission'),
  COALESCE(currency, 'usd');

COMMENT ON COLUMN public.event_sales_data.ticket_tier_category IS
  'Normalized ticket tier category: early_bird, ga, vip, comp, promo, donation, or add_on.';
COMMENT ON COLUMN public.imported_attendees.ticket_tier_category IS
  'Normalized ticket tier category: early_bird, ga, vip, comp, promo, donation, or add_on.';
COMMENT ON VIEW public.event_ticket_sales_rollups IS
  'Provider-normalized ticket tier rollups for analytics: Early Bird vs GA vs VIP, promo, comp, donation, and add-ons.';

GRANT SELECT ON public.event_ticket_sales_rollups TO authenticated;
GRANT SELECT ON public.event_ticket_sales_rollups TO service_role;
