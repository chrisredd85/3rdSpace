-- Migration: Kickback settlement schema with plan link and invoice method
-- Created: 2026-05-27
-- Context: Schema checkpoint for revenue share settlement, screenshot proof,
-- Stripe Invoicing pass-through, and venue compliance gating.

-- ---------------------------------------------------------------------------
-- Event kickback agreement proof, plan linkage, and explicit revenue-share terms
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_kickback_agreements
  ADD COLUMN IF NOT EXISTS plan_id UUID,
  ADD COLUMN IF NOT EXISTS bar_revenue_share_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS ticket_revenue_share_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS attendance_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS attendance_extracted_value INTEGER,
  ADD COLUMN IF NOT EXISTS attendance_extraction_confidence TEXT,
  ADD COLUMN IF NOT EXISTS attendance_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reported_revenue_cents INTEGER,
  ADD COLUMN IF NOT EXISTS revenue_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS revenue_extracted_value_cents INTEGER,
  ADD COLUMN IF NOT EXISTS revenue_extraction_confidence TEXT,
  ADD COLUMN IF NOT EXISTS revenue_submitted_at TIMESTAMPTZ;

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
      FOREIGN KEY (plan_id)
      REFERENCES public.plans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.event_kickback_agreements
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_bar_revenue_share_percent_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_ticket_revenue_share_percent_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_attendance_extracted_value_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_revenue_values_cents_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_attendance_confidence_check,
  DROP CONSTRAINT IF EXISTS event_kickback_agreements_revenue_confidence_check;

ALTER TABLE public.event_kickback_agreements
  ADD CONSTRAINT event_kickback_agreements_bar_revenue_share_percent_check
    CHECK (
      bar_revenue_share_percent IS NULL
      OR (bar_revenue_share_percent >= 0 AND bar_revenue_share_percent <= 100)
    ),
  ADD CONSTRAINT event_kickback_agreements_ticket_revenue_share_percent_check
    CHECK (
      ticket_revenue_share_percent IS NULL
      OR (ticket_revenue_share_percent >= 0 AND ticket_revenue_share_percent <= 100)
    ),
  ADD CONSTRAINT event_kickback_agreements_attendance_extracted_value_check
    CHECK (
      attendance_extracted_value IS NULL
      OR attendance_extracted_value >= 0
    ),
  ADD CONSTRAINT event_kickback_agreements_revenue_values_cents_check
    CHECK (
      (reported_revenue_cents IS NULL OR reported_revenue_cents >= 0)
      AND (
        revenue_extracted_value_cents IS NULL
        OR revenue_extracted_value_cents >= 0
      )
    ),
  ADD CONSTRAINT event_kickback_agreements_attendance_confidence_check
    CHECK (
      attendance_extraction_confidence IS NULL
      OR attendance_extraction_confidence IN ('high', 'medium', 'low')
    ),
  ADD CONSTRAINT event_kickback_agreements_revenue_confidence_check
    CHECK (
      revenue_extraction_confidence IS NULL
      OR revenue_extraction_confidence IN ('high', 'medium', 'low')
    );

COMMENT ON COLUMN public.event_kickback_agreements.plan_id IS
  'Nullable planner plan link for post-event settlement. Legacy event-only agreements do not require it.';
COMMENT ON COLUMN public.event_kickback_agreements.bar_revenue_share_percent IS
  'Explicit bar/F&B revenue share percent for new invoice settlement. Preserves lift_share_percentage for legacy lift math.';
COMMENT ON COLUMN public.event_kickback_agreements.ticket_revenue_share_percent IS
  'Explicit ticket revenue share percent for new invoice settlement.';
COMMENT ON COLUMN public.event_kickback_agreements.reported_revenue_cents IS
  'Venue-reported revenue for invoice settlement, stored as integer cents.';

CREATE INDEX IF NOT EXISTS idx_event_kickback_agreements_plan_status
  ON public.event_kickback_agreements(plan_id, status)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_kickback_agreements_venue_event_date
  ON public.event_kickback_agreements(venue_id, event_date);

CREATE INDEX IF NOT EXISTS idx_event_kickback_agreements_reported_revenue
  ON public.event_kickback_agreements(reported_revenue_cents)
  WHERE reported_revenue_cents IS NULL;

-- ---------------------------------------------------------------------------
-- Kickback payment invoice settlement fields and status coexistence
-- ---------------------------------------------------------------------------

ALTER TABLE public.kickback_payments
  ADD COLUMN IF NOT EXISTS amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_method TEXT DEFAULT 'checkout',
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS invoice_hosted_url TEXT,
  ADD COLUMN IF NOT EXISTS processing_fee_cents INTEGER,
  ADD COLUMN IF NOT EXISTS builder_payout_cents INTEGER,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_requested_by UUID,
  ADD COLUMN IF NOT EXISTS refund_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_approved_by UUID,
  ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_transfer_reversal_id TEXT;

UPDATE public.kickback_payments
SET settlement_method = 'checkout'
WHERE settlement_method IS NULL;

ALTER TABLE public.kickback_payments
  ALTER COLUMN settlement_method SET DEFAULT 'checkout',
  ALTER COLUMN settlement_method SET NOT NULL;

ALTER TABLE public.kickback_payments
  DROP CONSTRAINT IF EXISTS kickback_payments_status_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_settlement_method_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_amount_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_processing_fee_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_builder_payout_cents_check,
  DROP CONSTRAINT IF EXISTS kickback_payments_refund_amount_cents_check;

ALTER TABLE public.kickback_payments
  ADD CONSTRAINT kickback_payments_status_check
    CHECK (
      status IN (
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
      )
    ),
  ADD CONSTRAINT kickback_payments_settlement_method_check
    CHECK (settlement_method IN ('checkout', 'invoice')),
  ADD CONSTRAINT kickback_payments_amount_cents_check
    CHECK (amount_cents IS NULL OR amount_cents >= 0),
  ADD CONSTRAINT kickback_payments_processing_fee_cents_check
    CHECK (processing_fee_cents IS NULL OR processing_fee_cents >= 0),
  ADD CONSTRAINT kickback_payments_builder_payout_cents_check
    CHECK (builder_payout_cents IS NULL OR builder_payout_cents >= 0),
  ADD CONSTRAINT kickback_payments_refund_amount_cents_check
    CHECK (
      refund_amount_cents IS NULL
      OR (
        refund_amount_cents >= 0
        AND (
          builder_payout_cents IS NULL
          OR refund_amount_cents <= builder_payout_cents
        )
      )
    );

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
      FOREIGN KEY (refund_requested_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kickback_payments_refund_approved_by_fkey'
      AND conrelid = 'public.kickback_payments'::regclass
  ) THEN
    ALTER TABLE public.kickback_payments
      ADD CONSTRAINT kickback_payments_refund_approved_by_fkey
      FOREIGN KEY (refund_approved_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.kickback_payments.amount IS
  'Legacy checkout amount. Existing code treats non-_cents money columns as dollars.';
COMMENT ON COLUMN public.kickback_payments.amount_cents IS
  'Invoice settlement principal in integer cents. New invoice code writes this instead of amount.';
COMMENT ON COLUMN public.kickback_payments.settlement_method IS
  'Payment rail discriminator: checkout preserves legacy Stripe Checkout flow, invoice uses Stripe Invoicing.';
COMMENT ON COLUMN public.kickback_payments.due_date IS
  'Stripe invoice due date for invoice settlement compliance checks.';
COMMENT ON COLUMN public.kickback_payments.refund_amount_cents IS
  'Approved or requested principal refund amount in integer cents. Processing fees are not refunded.';
COMMENT ON COLUMN public.kickback_payments.refund_reason IS
  'Venue or builder-provided reason for a requested kickback refund.';
COMMENT ON COLUMN public.kickback_payments.stripe_refund_id IS
  'Stripe Refund id for the invoice charge refund back to the venue.';
COMMENT ON COLUMN public.kickback_payments.stripe_transfer_reversal_id IS
  'Stripe transfer reversal id for debiting the builder connected account.';

-- Existing unique event-level idempotency conflicts with agreement-level
-- settlement. Keep event_id indexed, but make agreement_id the unique key.
DROP INDEX IF EXISTS public.idx_kickback_payments_event_unique;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.kickback_payments
    GROUP BY agreement_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot add unique index on kickback_payments(agreement_id): duplicate agreement_id rows exist';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kickback_payments_event_id
  ON public.kickback_payments(event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_agreement_unique
  ON public.kickback_payments(agreement_id);

CREATE INDEX IF NOT EXISTS idx_kickback_payments_invoice_status
  ON public.kickback_payments(settlement_method, status, due_date)
  WHERE settlement_method = 'invoice';

CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_stripe_invoice_id
  ON public.kickback_payments(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_stripe_refund_id
  ON public.kickback_payments(stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kickback_payments_refund_status
  ON public.kickback_payments(status, refund_requested_at)
  WHERE status IN (
    'refund_requested',
    'refund_approved',
    'refund_processing'
  );

-- Reconcile the legacy DB function with the new agreement-level uniqueness.
-- It remains a checkout-method path and does not mutate invoice settlements.
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
  ORDER BY created_at ASC
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
      NOW()
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
      initiated_at = NOW(),
      failure_reason = NULL
    WHERE public.kickback_payments.settlement_method = 'checkout';
  ELSE
    DELETE FROM public.kickback_payments
    WHERE agreement_id = v_event_kickback_agreement.id
      AND settlement_method = 'checkout';
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

-- ---------------------------------------------------------------------------
-- Venue invoice customer and overdue notification tracking
-- ---------------------------------------------------------------------------

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS last_overdue_count_notified INTEGER NOT NULL DEFAULT 0;

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

COMMENT ON COLUMN public.venues.stripe_customer_id IS
  'Stripe Customer id used for venue-paid revenue share invoices.';
COMMENT ON COLUMN public.venues.last_overdue_count_notified IS
  'Last overdue kickback count threshold notified by the venue overdue cron.';

CREATE INDEX IF NOT EXISTS idx_venues_stripe_customer_id
  ON public.venues(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Venue opportunity compliance blocking
-- ---------------------------------------------------------------------------

ALTER TABLE public.venue_opportunity_invites
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

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
  'Human-readable reason an invite was blocked before creation or send, such as venue compliance.';

CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_blocked_compliance
  ON public.venue_opportunity_invites(venue_id, status)
  WHERE status = 'venue_blocked_compliance';

-- ---------------------------------------------------------------------------
-- Private proof storage buckets
-- ---------------------------------------------------------------------------

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
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Uploads for these buckets must go through server-side service-role routes.
-- Drop the previously proposed direct-user policies if they exist anywhere.
DROP POLICY IF EXISTS "Builders upload their own event reports" ON storage.objects;
DROP POLICY IF EXISTS "Venues upload their own spend reports" ON storage.objects;

-- ---------------------------------------------------------------------------
-- Down migration reference
-- ---------------------------------------------------------------------------
-- To reverse manually:
-- 1. DROP POLICY IF EXISTS "Builders upload their own event reports" ON storage.objects;
-- 2. DROP POLICY IF EXISTS "Venues upload their own spend reports" ON storage.objects;
-- 3. DELETE FROM storage.buckets WHERE id IN ('event-reports', 'venue-spend-reports');
-- 4. DROP INDEX IF EXISTS public.idx_venue_opportunity_invites_blocked_compliance;
-- 5. ALTER TABLE public.venue_opportunity_invites DROP COLUMN IF EXISTS blocked_reason;
-- 6. Restore venue_opportunity_invites_status_check without 'venue_blocked_compliance'.
-- 7. DROP INDEX IF EXISTS public.idx_venues_stripe_customer_id;
-- 8. ALTER TABLE public.venues
--      DROP COLUMN IF EXISTS stripe_customer_id,
--      DROP COLUMN IF EXISTS last_overdue_count_notified;
-- 9. DROP INDEX IF EXISTS public.idx_kickback_payments_stripe_invoice_id;
-- 10. DROP INDEX IF EXISTS public.idx_kickback_payments_stripe_refund_id;
-- 11. DROP INDEX IF EXISTS public.idx_kickback_payments_refund_status;
-- 12. DROP INDEX IF EXISTS public.idx_kickback_payments_invoice_status;
-- 13. DROP INDEX IF EXISTS public.idx_kickback_payments_agreement_unique;
-- 14. DROP INDEX IF EXISTS public.idx_kickback_payments_event_id;
-- 15. CREATE UNIQUE INDEX IF NOT EXISTS idx_kickback_payments_event_unique
--       ON public.kickback_payments(event_id);
-- 16. ALTER TABLE public.kickback_payments
--       DROP CONSTRAINT IF EXISTS kickback_payments_refund_requested_by_fkey,
--       DROP CONSTRAINT IF EXISTS kickback_payments_refund_approved_by_fkey,
--       DROP COLUMN IF EXISTS amount_cents,
--       DROP COLUMN IF EXISTS settlement_method,
--       DROP COLUMN IF EXISTS stripe_invoice_id,
--       DROP COLUMN IF EXISTS invoice_hosted_url,
--       DROP COLUMN IF EXISTS processing_fee_cents,
--       DROP COLUMN IF EXISTS builder_payout_cents,
--       DROP COLUMN IF EXISTS paid_at,
--       DROP COLUMN IF EXISTS due_date,
--       DROP COLUMN IF EXISTS refund_amount_cents,
--       DROP COLUMN IF EXISTS refund_reason,
--       DROP COLUMN IF EXISTS refund_requested_at,
--       DROP COLUMN IF EXISTS refund_requested_by,
--       DROP COLUMN IF EXISTS refund_approved_at,
--       DROP COLUMN IF EXISTS refund_approved_by,
--       DROP COLUMN IF EXISTS stripe_refund_id;
--     stripe_transfer_reversal_id is intentionally not dropped here because
--     earlier migrations also create it for the legacy checkout flow.
-- 17. DROP INDEX IF EXISTS public.idx_event_kickback_agreements_reported_revenue;
-- 18. DROP INDEX IF EXISTS public.idx_event_kickback_agreements_venue_event_date;
-- 19. DROP INDEX IF EXISTS public.idx_event_kickback_agreements_plan_status;
-- 20. ALTER TABLE public.event_kickback_agreements
--       DROP CONSTRAINT IF EXISTS event_kickback_agreements_plan_id_fkey,
--       DROP COLUMN IF EXISTS plan_id,
--       DROP COLUMN IF EXISTS bar_revenue_share_percent,
--       DROP COLUMN IF EXISTS ticket_revenue_share_percent,
--       DROP COLUMN IF EXISTS attendance_proof_url,
--       DROP COLUMN IF EXISTS attendance_extracted_value,
--       DROP COLUMN IF EXISTS attendance_extraction_confidence,
--       DROP COLUMN IF EXISTS attendance_submitted_at,
--       DROP COLUMN IF EXISTS reported_revenue_cents,
--       DROP COLUMN IF EXISTS revenue_proof_url,
--       DROP COLUMN IF EXISTS revenue_extracted_value_cents,
--       DROP COLUMN IF EXISTS revenue_extraction_confidence,
--       DROP COLUMN IF EXISTS revenue_submitted_at;
-- 21. Restore public.calculate_event_kickback from the previous migration if
--     event-level unique payment idempotency is required again.
