-- Migration: Kickback settlement schema foundation
-- Created: 2026-05-27
-- Context: Phase 1 revenue-share settlement with plan-linked proof uploads,
-- Stripe Invoicing, compliance gating, and refund lifecycle fields.

-- Plan-linked agreements can coexist with legacy event-linked agreements. The
-- new planner settlement path uses plan_id as the canonical link and does not
-- materialize a legacy events row.
ALTER TABLE public.event_kickback_agreements
  ALTER COLUMN event_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS bar_revenue_share_percent numeric,
  ADD COLUMN IF NOT EXISTS ticket_revenue_share_percent numeric,
  ADD COLUMN IF NOT EXISTS attendance_proof_url text,
  ADD COLUMN IF NOT EXISTS attendance_extracted_value integer,
  ADD COLUMN IF NOT EXISTS attendance_extraction_confidence text,
  ADD COLUMN IF NOT EXISTS attendance_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_revenue_cents integer,
  ADD COLUMN IF NOT EXISTS revenue_proof_url text,
  ADD COLUMN IF NOT EXISTS revenue_extracted_value_cents integer,
  ADD COLUMN IF NOT EXISTS revenue_extraction_confidence text,
  ADD COLUMN IF NOT EXISTS revenue_submitted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'event_kickback_agreements_plan_id_fkey'
      AND conrelid = 'public.event_kickback_agreements'::regclass
  ) THEN
    ALTER TABLE public.event_kickback_agreements
      ADD CONSTRAINT event_kickback_agreements_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.event_kickback_agreements
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_attendance_confidence_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_revenue_confidence_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_reported_revenue_cents_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_revenue_extracted_value_cents_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_attendance_extracted_value_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_bar_revenue_share_percent_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_ticket_revenue_share_percent_check;

ALTER TABLE public.event_kickback_agreements
  ADD CONSTRAINT event_kickback_agreements_attendance_confidence_check
    CHECK (
      attendance_extraction_confidence IS NULL
      OR attendance_extraction_confidence IN ('high', 'medium', 'low')
    ),
  ADD CONSTRAINT event_kickback_agreements_revenue_confidence_check
    CHECK (
      revenue_extraction_confidence IS NULL
      OR revenue_extraction_confidence IN ('high', 'medium', 'low')
    ),
  ADD CONSTRAINT event_kickback_agreements_reported_revenue_cents_check
    CHECK (reported_revenue_cents IS NULL OR reported_revenue_cents >= 0),
  ADD CONSTRAINT event_kickback_agreements_revenue_extracted_value_cents_check
    CHECK (revenue_extracted_value_cents IS NULL OR revenue_extracted_value_cents >= 0),
  ADD CONSTRAINT event_kickback_agreements_attendance_extracted_value_check
    CHECK (attendance_extracted_value IS NULL OR attendance_extracted_value >= 0),
  ADD CONSTRAINT event_kickback_agreements_bar_revenue_share_percent_check
    CHECK (bar_revenue_share_percent IS NULL OR (bar_revenue_share_percent >= 0 AND bar_revenue_share_percent <= 100)),
  ADD CONSTRAINT event_kickback_agreements_ticket_revenue_share_percent_check
    CHECK (ticket_revenue_share_percent IS NULL OR (ticket_revenue_share_percent >= 0 AND ticket_revenue_share_percent <= 100));

DROP INDEX IF EXISTS public.idx_agreements_event_id;
CREATE INDEX IF NOT EXISTS idx_agreements_event_id
  ON public.event_kickback_agreements(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_kickback_agreements_plan_status
  ON public.event_kickback_agreements(plan_id, status)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_kickback_agreements_venue_compliance
  ON public.event_kickback_agreements(venue_id, event_date, reported_revenue_cents)
  WHERE venue_id IS NOT NULL;

COMMENT ON COLUMN public.event_kickback_agreements.plan_id IS
  'Nullable planner plan link for new settlement flows. Legacy agreements may remain event-linked only.';
COMMENT ON COLUMN public.event_kickback_agreements.reported_revenue_cents IS
  'Venue-reported revenue for invoice settlement in integer cents.';
COMMENT ON COLUMN public.event_kickback_agreements.bar_revenue_share_percent IS
  'Settlement-specific bar revenue share percent. Preserves legacy lift_share_percentage semantics.';
COMMENT ON COLUMN public.event_kickback_agreements.ticket_revenue_share_percent IS
  'Settlement-specific ticket revenue share percent. Preserves legacy lift_share_percentage semantics.';

-- New invoice settlement rows use amount_cents and may not have a legacy event_id
-- or amount. Existing checkout rows keep using amount as legacy dollars.
ALTER TABLE public.kickback_payments
  ALTER COLUMN event_id DROP NOT NULL,
  ALTER COLUMN amount DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS amount_cents integer,
  ADD COLUMN IF NOT EXISTS settlement_method text NOT NULL DEFAULT 'checkout',
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS invoice_hosted_url text,
  ADD COLUMN IF NOT EXISTS due_date timestamptz,
  ADD COLUMN IF NOT EXISTS processing_fee_cents integer,
  ADD COLUMN IF NOT EXISTS builder_payout_cents integer,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_amount_cents integer,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_requested_by uuid,
  ADD COLUMN IF NOT EXISTS refund_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_approved_by uuid,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS stripe_transfer_reversal_id text;

UPDATE public.kickback_payments
SET settlement_method = 'checkout'
WHERE settlement_method IS NULL;

ALTER TABLE public.kickback_payments
  ALTER COLUMN settlement_method SET DEFAULT 'checkout',
  ALTER COLUMN settlement_method SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kickback_payments_refund_requested_by_fkey'
      AND conrelid = 'public.kickback_payments'::regclass
  ) THEN
    ALTER TABLE public.kickback_payments
      ADD CONSTRAINT kickback_payments_refund_requested_by_fkey
      FOREIGN KEY (refund_requested_by) REFERENCES public.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kickback_payments_refund_approved_by_fkey'
      AND conrelid = 'public.kickback_payments'::regclass
  ) THEN
    ALTER TABLE public.kickback_payments
      ADD CONSTRAINT kickback_payments_refund_approved_by_fkey
      FOREIGN KEY (refund_approved_by) REFERENCES public.users(id);
  END IF;
END;
$$;

ALTER TABLE public.kickback_payments
  DROP CONSTRAINT IF EXISTS kickback_payments_status_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_settlement_method_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_amount_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_processing_fee_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_builder_payout_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_refund_amount_cents_check;

ALTER TABLE public.kickback_payments
  ADD CONSTRAINT kickback_payments_status_check
    CHECK (status IN (
      'pending',
      'processing',
      'completed',
      'failed',
      'refunded',
      'pending_venue_approval',
      'invoice_sent',
      'paid',
      'invoice_failed',
      'refund_requested',
      'refund_approved',
      'refund_processing',
      'refunded_full',
      'refunded_partial'
    )),
  ADD CONSTRAINT kickback_payments_settlement_method_check
    CHECK (settlement_method IN ('checkout', 'invoice')),
  ADD CONSTRAINT kickback_payments_amount_cents_check
    CHECK (amount_cents IS NULL OR amount_cents >= 0),
  ADD CONSTRAINT kickback_payments_processing_fee_cents_check
    CHECK (processing_fee_cents IS NULL OR processing_fee_cents >= 0),
  ADD CONSTRAINT kickback_payments_builder_payout_cents_check
    CHECK (builder_payout_cents IS NULL OR builder_payout_cents >= 0),
  ADD CONSTRAINT kickback_payments_refund_amount_cents_check
    CHECK (refund_amount_cents IS NULL OR refund_amount_cents >= 0);

DROP INDEX IF EXISTS public.idx_kickback_payments_event_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_agreement_unique
  ON public.kickback_payments(agreement_id);

CREATE INDEX IF NOT EXISTS idx_kickback_payments_event_id
  ON public.kickback_payments(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kickback_payments_invoice_status
  ON public.kickback_payments(settlement_method, status, due_date, paid_at)
  WHERE settlement_method = 'invoice';

CREATE INDEX IF NOT EXISTS idx_kickback_payments_stripe_invoice_id
  ON public.kickback_payments(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kickback_payments_refund_status
  ON public.kickback_payments(status, refund_requested_at)
  WHERE status IN ('refund_requested', 'refund_approved', 'refund_processing');

COMMENT ON COLUMN public.kickback_payments.amount_cents IS
  'Canonical invoice-settlement principal in integer cents. Legacy amount remains dollars for checkout rows.';
COMMENT ON COLUMN public.kickback_payments.settlement_method IS
  'Distinguishes legacy checkout settlements from new Stripe Invoice settlements.';
COMMENT ON COLUMN public.kickback_payments.processing_fee_cents IS
  'Stripe processing fee charged to the venue as a separate invoice item.';
COMMENT ON COLUMN public.kickback_payments.builder_payout_cents IS
  'Principal transferred to the builder connected account.';
COMMENT ON COLUMN public.kickback_payments.refund_amount_cents IS
  'Approved or requested refund principal in integer cents. Processing fee is not refunded.';

-- Recreate the legacy event check-in kickback RPC to use the new agreement-level
-- uniqueness. This preserves the event-based upload flow after dropping the
-- event_id unique index.
CREATE OR REPLACE FUNCTION public.calculate_event_kickback(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_attendees integer;
  v_actual_attendees integer;
  v_kickback_amount integer := 0;
  v_event_kickback_agreement public.event_kickback_agreements%ROWTYPE;
  v_result jsonb;
  v_has_access boolean := false;
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
    updated_at = now()
  WHERE id = v_event_kickback_agreement.id;

  IF v_kickback_amount > 0 THEN
    INSERT INTO public.kickback_payments (
      agreement_id,
      event_id,
      payer_id,
      recipient_id,
      amount,
      settlement_method,
      status,
      notes,
      initiated_at
    ) VALUES (
      v_event_kickback_agreement.id,
      p_event_id,
      v_event_kickback_agreement.venue_owner_id,
      v_event_kickback_agreement.builder_id,
      v_kickback_amount,
      'checkout',
      'pending',
      'Auto-calculated from imported attendee check-ins.',
      now()
    )
    ON CONFLICT (agreement_id)
    DO UPDATE SET
      event_id = EXCLUDED.event_id,
      payer_id = EXCLUDED.payer_id,
      recipient_id = EXCLUDED.recipient_id,
      amount = EXCLUDED.amount,
      settlement_method = 'checkout',
      status = 'pending',
      notes = EXCLUDED.notes,
      initiated_at = now(),
      failure_reason = NULL;
  ELSE
    DELETE FROM public.kickback_payments
    WHERE agreement_id = v_event_kickback_agreement.id;
  END IF;

  v_result := jsonb_build_object(
    'event_id', p_event_id,
    'expected_attendees', v_expected_attendees,
    'actual_attendees', v_actual_attendees,
    'kickback_amount', v_kickback_amount,
    'per_head_rate', v_event_kickback_agreement.per_head_amount,
    'minimum_threshold', v_event_kickback_agreement.minimum_attendees,
    'met_minimum', v_actual_attendees >= COALESCE(v_event_kickback_agreement.minimum_attendees, 0),
    'calculated_at', now(),
    'status', CASE WHEN v_kickback_amount > 0 THEN 'eligible' ELSE 'ineligible' END
  );

  RETURN v_result;
END;
$$;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS last_overdue_count_notified integer NOT NULL DEFAULT 0;

UPDATE public.venues
SET last_overdue_count_notified = 0
WHERE last_overdue_count_notified IS NULL;

ALTER TABLE public.venues
  ALTER COLUMN last_overdue_count_notified SET DEFAULT 0,
  ALTER COLUMN last_overdue_count_notified SET NOT NULL;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_last_overdue_count_notified_check;

ALTER TABLE public.venues
  ADD CONSTRAINT venues_last_overdue_count_notified_check
    CHECK (last_overdue_count_notified >= 0);

CREATE INDEX IF NOT EXISTS idx_venues_stripe_customer_id
  ON public.venues(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.venue_opportunity_invites
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE public.venue_opportunity_invites
  DROP CONSTRAINT IF EXISTS venue_opportunity_invites_status_check;

ALTER TABLE public.venue_opportunity_invites
  ADD CONSTRAINT venue_opportunity_invites_status_check
  CHECK (status IN (
    'queued',
    'sent',
    'viewed',
    'accepted',
    'declined',
    'countered',
    'expired',
    'concierge_followup',
    'draft',
    'pending_organizer_approval',
    'concierge_queue',
    'cancelled',
    'venue_blocked_compliance'
  ));

COMMENT ON COLUMN public.venue_opportunity_invites.blocked_reason IS
  'Compliance reason when a venue is blocked from receiving new outreach.';

-- Private proof buckets. All writes go through server routes with the service
-- role client after ownership checks; do not add direct user upload policies.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'event-reports',
    'event-reports',
    false,
    10485760,
    ARRAY[
      'image/png',
      'image/jpeg',
      'image/heic',
      'application/pdf',
      'text/csv',
      'text/tab-separated-values',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]
  ),
  (
    'venue-spend-reports',
    'venue-spend-reports',
    false,
    10485760,
    ARRAY[
      'image/png',
      'image/jpeg',
      'image/heic',
      'application/pdf',
      'text/csv',
      'text/tab-separated-values',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ]
  )
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Down migration reference:
-- DELETE FROM storage.buckets WHERE id IN ('event-reports', 'venue-spend-reports');
-- ALTER TABLE public.venue_opportunity_invites DROP COLUMN IF EXISTS blocked_reason;
-- ALTER TABLE public.venues
--   DROP COLUMN IF EXISTS stripe_customer_id,
--   DROP COLUMN IF EXISTS last_overdue_count_notified;
-- DROP INDEX IF EXISTS public.idx_kickback_payments_refund_status;
-- DROP INDEX IF EXISTS public.idx_kickback_payments_stripe_invoice_id;
-- DROP INDEX IF EXISTS public.idx_kickback_payments_invoice_status;
-- DROP INDEX IF EXISTS public.idx_kickback_payments_event_id;
-- DROP INDEX IF EXISTS public.idx_kickback_payments_agreement_unique;
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_event_unique
--   ON public.kickback_payments(event_id)
--   WHERE event_id IS NOT NULL;
-- ALTER TABLE public.kickback_payments
--   DROP COLUMN IF EXISTS amount_cents,
--   DROP COLUMN IF EXISTS settlement_method,
--   DROP COLUMN IF EXISTS stripe_invoice_id,
--   DROP COLUMN IF EXISTS invoice_hosted_url,
--   DROP COLUMN IF EXISTS due_date,
--   DROP COLUMN IF EXISTS processing_fee_cents,
--   DROP COLUMN IF EXISTS builder_payout_cents,
--   DROP COLUMN IF EXISTS paid_at,
--   DROP COLUMN IF EXISTS refund_amount_cents,
--   DROP COLUMN IF EXISTS refund_reason,
--   DROP COLUMN IF EXISTS refund_requested_at,
--   DROP COLUMN IF EXISTS refund_requested_by,
--   DROP COLUMN IF EXISTS refund_approved_at,
--   DROP COLUMN IF EXISTS refund_approved_by,
--   DROP COLUMN IF EXISTS stripe_refund_id;
-- DROP INDEX IF EXISTS public.idx_event_kickback_agreements_venue_compliance;
-- DROP INDEX IF EXISTS public.idx_event_kickback_agreements_plan_status;
-- DROP INDEX IF EXISTS public.idx_agreements_event_id;
-- ALTER TABLE public.event_kickback_agreements
--   DROP COLUMN IF EXISTS plan_id,
--   DROP COLUMN IF EXISTS bar_revenue_share_percent,
--   DROP COLUMN IF EXISTS ticket_revenue_share_percent,
--   DROP COLUMN IF EXISTS attendance_proof_url,
--   DROP COLUMN IF EXISTS attendance_extracted_value,
--   DROP COLUMN IF EXISTS attendance_extraction_confidence,
--   DROP COLUMN IF EXISTS attendance_submitted_at,
--   DROP COLUMN IF EXISTS reported_revenue_cents,
--   DROP COLUMN IF EXISTS revenue_proof_url,
--   DROP COLUMN IF EXISTS revenue_extracted_value_cents,
--   DROP COLUMN IF EXISTS revenue_extraction_confidence,
--   DROP COLUMN IF EXISTS revenue_submitted_at;
