-- ============================================================================
-- RACE-SAFE MANUAL VENDOR AVAILABILITY SAVES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_vendor_manual_availability(
  p_vendor_id uuid,
  p_dates date[],
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS SETOF public.vendor_availability
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF p_status NOT IN ('available', 'blocked', 'tentative') THEN
    RAISE EXCEPTION 'Manual availability status must be available, blocked, or tentative';
  END IF;

  RETURN QUERY
  INSERT INTO public.vendor_availability (
    vendor_id,
    date,
    status,
    booking_id,
    notes,
    updated_at
  )
  SELECT
    p_vendor_id,
    availability_date,
    p_status,
    NULL::uuid,
    p_notes,
    NOW()
  FROM unnest(p_dates) AS availability_date
  ON CONFLICT (vendor_id, date) DO UPDATE
    SET status = EXCLUDED.status,
        booking_id = NULL,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    WHERE public.vendor_availability.booking_id IS NULL
  RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_vendor_manual_availability(uuid, date[], text, text) TO authenticated;
