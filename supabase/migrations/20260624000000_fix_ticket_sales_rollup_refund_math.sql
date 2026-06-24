-- Migration: Fix ticket sales rollup refund math
-- Created: 2026-06-24
-- Context: Gross ticket revenue should represent non-refunded sales only.
-- Refund amounts are tracked separately and reduce net revenue.

DROP VIEW IF EXISTS public.event_ticket_sales_rollups;

CREATE VIEW public.event_ticket_sales_rollups AS
SELECT
  event_id,
  platform,
  COALESCE(ticket_tier_category, 'ga') AS ticket_tier_category,
  COALESCE(ticket_tier_name, ticket_type, 'General Admission') AS ticket_tier_name,
  COALESCE(currency, 'usd') AS currency,
  SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END)::integer AS tickets_sold,
  SUM(CASE WHEN COALESCE(is_refund, false) THEN ABS(ticket_quantity) ELSE 0 END)::integer AS tickets_refunded,
  SUM(
    CASE
      WHEN COALESCE(is_refund, false) THEN 0
      ELSE GREATEST(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0), 0)
    END
  )::integer AS gross_revenue_cents,
  SUM(
    CASE
      WHEN COALESCE(is_refund, false) THEN ABS(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0))
      ELSE 0
    END
  )::integer AS refund_amount_cents,
  SUM(
    CASE
      WHEN COALESCE(is_refund, false) THEN 0
      ELSE GREATEST(COALESCE(fees_cents, ROUND(COALESCE(fees, 0) * 100)::integer, 0), 0)
    END
  )::integer AS fees_cents,
  SUM(
    CASE
      WHEN COALESCE(is_refund, false) THEN 0
      ELSE GREATEST(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0), 0)
    END
  )
    - SUM(
      CASE
        WHEN COALESCE(is_refund, false) THEN 0
        ELSE GREATEST(COALESCE(fees_cents, ROUND(COALESCE(fees, 0) * 100)::integer, 0), 0)
      END
    )
    - SUM(
      CASE
        WHEN COALESCE(is_refund, false) THEN ABS(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0))
        ELSE 0
      END
    ) AS net_revenue_cents,
  CASE
    WHEN SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END) > 0
      THEN ROUND(
        SUM(
          CASE
            WHEN COALESCE(is_refund, false) THEN 0
            ELSE GREATEST(COALESCE(total_amount_cents, ROUND(total_amount * 100)::integer, 0), 0)
          END
        )::numeric
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

COMMENT ON VIEW public.event_ticket_sales_rollups IS
  'Rolls ticket sales by event/platform/tier. Gross excludes refunds; refund_amount_cents is tracked separately and reduces net revenue.';

GRANT SELECT ON public.event_ticket_sales_rollups TO authenticated;
GRANT SELECT ON public.event_ticket_sales_rollups TO service_role;
