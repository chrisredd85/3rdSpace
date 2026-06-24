-- Migration: Add projection baseline materialized views
-- Created: 2026-06-24
-- Context: Planner profit projections should prefer real organizer history,
-- then anonymized archetype/neighborhood history, then hardcoded defaults.

DROP MATERIALIZED VIEW IF EXISTS public.organizer_baselines;
DROP MATERIALIZED VIEW IF EXISTS public.archetype_baselines;

CREATE MATERIALIZED VIEW public.organizer_baselines AS
WITH event_sales AS (
  SELECT
    event_id,
    SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END)::integer AS tickets_sold,
    SUM(CASE WHEN COALESCE(is_refund, false) THEN ABS(ticket_quantity) ELSE 0 END)::integer AS tickets_refunded
  FROM public.event_sales_data
  GROUP BY event_id
),
event_attendance AS (
  SELECT
    event_id,
    COUNT(*)::integer AS imported_attendee_count,
    COUNT(*) FILTER (WHERE checked_in)::integer AS checked_in_count
  FROM public.imported_attendees
  GROUP BY event_id
),
event_inputs AS (
  SELECT
    bp.user_id AS organizer_id,
    lower(regexp_replace(COALESCE(e.event_type, 'event'), '[^a-zA-Z0-9]+', '_', 'g')) AS archetype,
    GREATEST(COALESCE(es.tickets_sold, 0), 0)::integer AS tickets_sold,
    GREATEST(
      COALESCE(ea.checked_in_count, 0),
      COALESCE(efs.current_attendance, 0),
      GREATEST(COALESCE(es.tickets_sold, 0) - COALESCE(es.tickets_refunded, 0), 0)
    )::integer AS actual_attendance,
    NULLIF(COALESCE(e.expected_attendance, 0), 0)::integer AS promised_guest_count,
    ROUND(COALESCE(efs.expected_profit, 0) * 100)::integer AS net_profit_cents
  FROM public.events e
  JOIN public.builder_profiles bp ON bp.id = e.builder_id
  LEFT JOIN event_sales es ON es.event_id = e.id
  LEFT JOIN event_attendance ea ON ea.event_id = e.id
  LEFT JOIN public.event_financial_summary efs ON efs.event_id = e.id
  WHERE e.event_date >= (now() - interval '12 months')::date
    AND COALESCE(e.status, '') NOT IN ('cancelled', 'canceled', 'draft')
    AND COALESCE(es.tickets_sold, 0) > 0
)
SELECT
  organizer_id,
  archetype,
  COUNT(*)::integer AS n_events,
  AVG(actual_attendance::float / NULLIF(tickets_sold, 0)) AS avg_attendance_rate,
  AVG(tickets_sold::float / NULLIF(promised_guest_count, 0)) AS avg_sell_through,
  AVG(net_profit_cents)::integer AS avg_margin_cents,
  STDDEV(net_profit_cents)::integer AS stddev_margin_cents,
  AVG(GREATEST(tickets_sold - actual_attendance, 0)::float / NULLIF(tickets_sold, 0)) AS avg_no_show_rate,
  now() AS refreshed_at
FROM event_inputs
GROUP BY organizer_id, archetype
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX organizer_baselines_identity
  ON public.organizer_baselines (organizer_id, archetype);

CREATE MATERIALIZED VIEW public.archetype_baselines AS
WITH event_sales AS (
  SELECT
    event_id,
    SUM(CASE WHEN COALESCE(is_refund, false) THEN 0 ELSE GREATEST(ticket_quantity, 0) END)::integer AS tickets_sold,
    SUM(CASE WHEN COALESCE(is_refund, false) THEN ABS(ticket_quantity) ELSE 0 END)::integer AS tickets_refunded
  FROM public.event_sales_data
  GROUP BY event_id
),
event_attendance AS (
  SELECT
    event_id,
    COUNT(*)::integer AS imported_attendee_count,
    COUNT(*) FILTER (WHERE checked_in)::integer AS checked_in_count
  FROM public.imported_attendees
  GROUP BY event_id
),
event_inputs AS (
  SELECT
    lower(regexp_replace(COALESCE(e.event_type, 'event'), '[^a-zA-Z0-9]+', '_', 'g')) AS archetype,
    lower(regexp_replace(COALESCE(sr.neighborhood, v.city, 'bay_area'), '[^a-zA-Z0-9]+', '_', 'g')) AS neighborhood,
    GREATEST(COALESCE(es.tickets_sold, 0), 0)::integer AS tickets_sold,
    GREATEST(
      COALESCE(ea.checked_in_count, 0),
      COALESCE(efs.current_attendance, 0),
      GREATEST(COALESCE(es.tickets_sold, 0) - COALESCE(es.tickets_refunded, 0), 0)
    )::integer AS actual_attendance,
    NULLIF(COALESCE(e.expected_attendance, 0), 0)::integer AS promised_guest_count,
    ROUND(COALESCE(efs.expected_profit, 0) * 100)::integer AS net_profit_cents
  FROM public.events e
  LEFT JOIN public.settlement_runs sr ON sr.event_id = e.id
  LEFT JOIN public.venues v ON v.id = e.venue_id
  LEFT JOIN event_sales es ON es.event_id = e.id
  LEFT JOIN event_attendance ea ON ea.event_id = e.id
  LEFT JOIN public.event_financial_summary efs ON efs.event_id = e.id
  WHERE e.event_date >= (now() - interval '12 months')::date
    AND COALESCE(e.status, '') NOT IN ('cancelled', 'canceled', 'draft')
    AND COALESCE(es.tickets_sold, 0) > 0
)
SELECT
  archetype,
  neighborhood,
  COUNT(*)::integer AS n_events,
  AVG(actual_attendance::float / NULLIF(tickets_sold, 0)) AS avg_attendance_rate,
  AVG(tickets_sold::float / NULLIF(promised_guest_count, 0)) AS avg_sell_through,
  AVG(net_profit_cents)::integer AS avg_margin_cents,
  STDDEV(net_profit_cents)::integer AS stddev_margin_cents,
  AVG(GREATEST(tickets_sold - actual_attendance, 0)::float / NULLIF(tickets_sold, 0)) AS avg_no_show_rate,
  now() AS refreshed_at
FROM event_inputs
GROUP BY archetype, neighborhood
HAVING COUNT(*) >= 5;

CREATE UNIQUE INDEX archetype_baselines_identity
  ON public.archetype_baselines (archetype, neighborhood);

COMMENT ON MATERIALIZED VIEW public.organizer_baselines IS
  'Per-organizer projection baselines. Privacy/noise floor: at least 3 historical events per organizer/archetype.';

COMMENT ON MATERIALIZED VIEW public.archetype_baselines IS
  'Anonymized archetype/neighborhood projection baselines. Privacy floor: at least 5 historical events per archetype/neighborhood.';

GRANT SELECT ON public.organizer_baselines TO service_role;
GRANT SELECT ON public.archetype_baselines TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_projection_baselines()
RETURNS TABLE(organizer_rows bigint, archetype_rows bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.organizer_baselines;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.archetype_baselines;

  RETURN QUERY
    SELECT
      (SELECT COUNT(*) FROM public.organizer_baselines),
      (SELECT COUNT(*) FROM public.archetype_baselines);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_projection_baselines() TO service_role;
