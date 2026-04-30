-- ============================================================================
-- TICKET IMPORT SYSTEM - LIVE SCHEMA SAFE VERSION
-- ============================================================================

-- Extend platform support for Posh without replacing the existing integration table.
ALTER TABLE public.external_event_integrations
  DROP CONSTRAINT IF EXISTS external_event_integrations_platform_check;

ALTER TABLE public.external_event_integrations
  ADD CONSTRAINT external_event_integrations_platform_check
  CHECK (platform = ANY (ARRAY['eventbrite', 'luma', 'posh', 'partiful', 'dice', 'meetup', 'tito', 'other']));

-- Add compatibility fields used by the upcoming ticket import flow.
ALTER TABLE public.external_event_integrations
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_error TEXT,
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.external_event_integrations
  DROP CONSTRAINT IF EXISTS external_event_integrations_sync_status_check;

ALTER TABLE public.external_event_integrations
  ADD CONSTRAINT external_event_integrations_sync_status_check
  CHECK (sync_status = ANY (ARRAY['pending', 'syncing', 'completed', 'failed']));

CREATE INDEX IF NOT EXISTS idx_external_integrations_platform_external_event
  ON public.external_event_integrations(platform, external_event_id);

CREATE INDEX IF NOT EXISTS idx_external_integrations_status
  ON public.external_event_integrations(sync_status)
  WHERE sync_status <> 'completed';

-- Imported attendee records from ticketing providers.
CREATE TABLE IF NOT EXISTS public.imported_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES public.external_event_integrations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  external_attendee_id VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  ticket_type VARCHAR(100),
  ticket_class VARCHAR(100),
  order_id VARCHAR(255),
  checked_in BOOLEAN DEFAULT false,
  check_in_time TIMESTAMPTZ,
  check_in_method VARCHAR(50),
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (integration_id, external_attendee_id)
);

ALTER TABLE public.imported_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Event team can view imported attendees" ON public.imported_attendees;
CREATE POLICY "Event team can view imported attendees"
  ON public.imported_attendees FOR SELECT
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

DROP POLICY IF EXISTS "Service role can manage imported attendees" ON public.imported_attendees;
CREATE POLICY "Service role can manage imported attendees"
  ON public.imported_attendees FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

CREATE INDEX IF NOT EXISTS idx_imported_attendees_event
  ON public.imported_attendees(event_id);

CREATE INDEX IF NOT EXISTS idx_imported_attendees_integration
  ON public.imported_attendees(integration_id);

CREATE INDEX IF NOT EXISTS idx_imported_attendees_checked_in
  ON public.imported_attendees(checked_in);

CREATE INDEX IF NOT EXISTS idx_imported_attendees_email
  ON public.imported_attendees(email);

DROP TRIGGER IF EXISTS update_imported_attendees_updated_at ON public.imported_attendees;
CREATE TRIGGER update_imported_attendees_updated_at
  BEFORE UPDATE ON public.imported_attendees
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Fix builder-facing RLS for integrations to use builder_profiles.user_id.
DROP POLICY IF EXISTS integrations_select ON public.external_event_integrations;

CREATE POLICY integrations_select
  ON public.external_event_integrations FOR SELECT
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS integrations_insert ON public.external_event_integrations;
CREATE POLICY integrations_insert
  ON public.external_event_integrations FOR INSERT
  WITH CHECK (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS integrations_update ON public.external_event_integrations;
CREATE POLICY integrations_update
  ON public.external_event_integrations FOR UPDATE
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS integrations_delete ON public.external_event_integrations;
CREATE POLICY integrations_delete
  ON public.external_event_integrations FOR DELETE
  USING (
    event_id IN (
      SELECT e.id
      FROM public.events e
      JOIN public.builder_profiles bp ON bp.id = e.builder_id
      WHERE bp.user_id = auth.uid()
    )
  );

-- One payment record per event keeps kickback recalculation idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_event_unique
  ON public.kickback_payments(event_id);

CREATE OR REPLACE FUNCTION public.calculate_event_kickback(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_attendees INTEGER;
  v_actual_attendees INTEGER;
  v_kickback_amount INTEGER := 0;
  v_event_kickback_agreement public.event_kickback_agreements%ROWTYPE;
  v_result JSONB;
  v_has_access BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    LEFT JOIN public.builder_profiles bp ON bp.id = e.builder_id
    LEFT JOIN public.collaborators c ON c.event_id = e.id AND c.user_id = auth.uid()
    LEFT JOIN public.event_kickback_agreements eka ON eka.event_id = e.id
    WHERE e.id = p_event_id
      AND (
        bp.user_id = auth.uid()
        OR c.user_id = auth.uid()
        OR eka.venue_owner_id = auth.uid()
        OR auth.jwt()->>'role' = 'service_role'
      )
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'error', 'You do not have access to calculate kickback for this event',
      'event_id', p_event_id
    );
  END IF;

  SELECT expected_attendance
  INTO v_expected_attendees
  FROM public.events
  WHERE id = p_event_id;

  SELECT COUNT(*)
  INTO v_actual_attendees
  FROM public.imported_attendees
  WHERE event_id = p_event_id
    AND checked_in = true;

  SELECT *
  INTO v_event_kickback_agreement
  FROM public.event_kickback_agreements
  WHERE event_id = p_event_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'No kickback agreement found for this event',
      'event_id', p_event_id
    );
  END IF;

  IF v_actual_attendees >= COALESCE(v_event_kickback_agreement.minimum_attendees, 0) THEN
    v_kickback_amount := v_actual_attendees * COALESCE(v_event_kickback_agreement.per_head_amount, 0);

    IF v_event_kickback_agreement.maximum_payout IS NOT NULL THEN
      v_kickback_amount := LEAST(v_kickback_amount, v_event_kickback_agreement.maximum_payout);
    END IF;
  END IF;

  UPDATE public.event_kickback_agreements
  SET
    actual_attendance = v_actual_attendees,
    actual_qualified_attendance = v_actual_attendees,
    actual_kickback_amount = v_kickback_amount,
    updated_at = NOW()
  WHERE event_id = p_event_id;

  IF v_kickback_amount > 0 THEN
    INSERT INTO public.kickback_payments (
      agreement_id,
      event_id,
      payer_id,
      recipient_id,
      amount,
      status,
      notes,
      initiated_at
    ) VALUES (
      v_event_kickback_agreement.id,
      p_event_id,
      v_event_kickback_agreement.venue_owner_id,
      v_event_kickback_agreement.builder_id,
      v_kickback_amount,
      'pending',
      'Auto-calculated from imported attendee check-ins.',
      NOW()
    )
    ON CONFLICT (event_id)
    DO UPDATE SET
      agreement_id = EXCLUDED.agreement_id,
      payer_id = EXCLUDED.payer_id,
      recipient_id = EXCLUDED.recipient_id,
      amount = EXCLUDED.amount,
      status = 'pending',
      notes = EXCLUDED.notes,
      initiated_at = NOW(),
      failure_reason = NULL;
  ELSE
    DELETE FROM public.kickback_payments
    WHERE event_id = p_event_id;
  END IF;

  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'expected_attendees', v_expected_attendees,
    'actual_attendees', v_actual_attendees,
    'kickback_amount', v_kickback_amount,
    'per_head_rate', v_event_kickback_agreement.per_head_amount,
    'minimum_threshold', v_event_kickback_agreement.minimum_attendees,
    'met_minimum', v_actual_attendees >= COALESCE(v_event_kickback_agreement.minimum_attendees, 0),
    'calculated_at', NOW(),
    'status', CASE WHEN v_kickback_amount > 0 THEN 'eligible' ELSE 'ineligible' END
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_event_kickback(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_kickback_summary(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_has_access BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.events e
    LEFT JOIN public.builder_profiles bp ON bp.id = e.builder_id
    LEFT JOIN public.collaborators c ON c.event_id = e.id AND c.user_id = auth.uid()
    LEFT JOIN public.event_kickback_agreements eka ON eka.event_id = e.id
    WHERE e.id = p_event_id
      AND (
        bp.user_id = auth.uid()
        OR c.user_id = auth.uid()
        OR eka.venue_owner_id = auth.uid()
        OR auth.jwt()->>'role' = 'service_role'
      )
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'error', 'You do not have access to view this kickback summary',
      'event_id', p_event_id
    );
  END IF;

  SELECT jsonb_build_object(
    'event_id', e.id,
    'event_name', e.event_name,
    'expected_attendees', e.expected_attendance,
    'actual_attendees', eka.actual_attendance,
    'checked_in_count', (
      SELECT COUNT(*)
      FROM public.imported_attendees ia
      WHERE ia.event_id = p_event_id
        AND ia.checked_in = true
    ),
    'kickback_amount', eka.actual_kickback_amount,
    'payment_status', kp.status,
    'venue_name', v.venue_name,
    'has_integration', EXISTS(
      SELECT 1
      FROM public.external_event_integrations eei
      WHERE eei.event_id = p_event_id
    )
  )
  INTO v_result
  FROM public.events e
  LEFT JOIN public.event_kickback_agreements eka ON e.id = eka.event_id
  LEFT JOIN public.kickback_payments kp ON e.id = kp.event_id
  LEFT JOIN public.venues v ON eka.venue_id = v.id
  WHERE e.id = p_event_id;

  RETURN COALESCE(
    v_result,
    jsonb_build_object('error', 'Event not found', 'event_id', p_event_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_event_kickback_summary(UUID) TO authenticated;
