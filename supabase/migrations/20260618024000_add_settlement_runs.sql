-- Migration: CHI settlement runs
-- Context: Phase epsilon.2 — produces approval-ready settlement records.
-- No money moves in this migration or its supporting code. Payment execution
-- belongs to epsilon.3.

CREATE TABLE IF NOT EXISTS public.settlement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  organizer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  venue_id UUID NOT NULL,
  archetype TEXT NOT NULL,
  venue_type TEXT NOT NULL,
  neighborhood TEXT NOT NULL,

  attendance_count INTEGER,
  attendance_source TEXT,
  attendance_recorded_at TIMESTAMPTZ,

  per_attendee_cents INTEGER,
  rate_source TEXT,
  rate_derived_from_event_count INTEGER,
  total_cents INTEGER,

  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_settle_at TIMESTAMPTZ NOT NULL,
  organizer_reviewed_at TIMESTAMPTZ,
  organizer_reviewed_by UUID REFERENCES auth.users(id),
  disputed_at TIMESTAMPTZ,
  dispute_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT settlement_runs_status_check CHECK (status IN (
    'pending', 'awaiting_attendance', 'awaiting_organizer_review',
    'awaiting_venue_ack', 'ready_to_settle', 'settled', 'disputed', 'cancelled'
  )),
  CONSTRAINT settlement_runs_attendance_source_check CHECK (
    attendance_source IS NULL OR attendance_source IN (
      'eventbrite_api', 'webhook_posh', 'webhook_luma', 'webhook_partiful',
      'csv_upload', 'organizer_manual'
    )
  ),
  CONSTRAINT settlement_runs_rate_source_check CHECK (
    rate_source IS NULL OR rate_source IN ('measured', 'network_default', 'no_rate_available')
  ),
  CONSTRAINT settlement_runs_amounts_check CHECK (
    (per_attendee_cents IS NULL OR per_attendee_cents >= 0) AND
    (total_cents IS NULL OR total_cents >= 0) AND
    (attendance_count IS NULL OR attendance_count >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_runs_one_per_event
  ON public.settlement_runs (event_id);

CREATE INDEX IF NOT EXISTS settlement_runs_organizer
  ON public.settlement_runs (organizer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS settlement_runs_status_scheduled
  ON public.settlement_runs (status, scheduled_settle_at)
  WHERE status NOT IN ('settled', 'cancelled');

COMMENT ON TABLE public.settlement_runs IS
  'Per-event CHI settlement records. State machine: pending -> awaiting_attendance -> awaiting_organizer_review -> awaiting_venue_ack -> ready_to_settle -> settled. epsilon.3 ships awaiting_venue_ack -> settled.';

CREATE TABLE IF NOT EXISTS public.settlement_attendance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_run_id UUID NOT NULL REFERENCES public.settlement_runs(id) ON DELETE CASCADE,
  evidence_kind TEXT NOT NULL,
  storage_path TEXT,
  external_ref TEXT,
  attendee_count INTEGER,
  uploaded_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settlement_evidence_kind_check CHECK (evidence_kind IN (
    'pos_screenshot', 'pos_csv', 'pos_pdf',
    'eventbrite_api_response', 'webhook_payload', 'organizer_attestation'
  )),
  CONSTRAINT settlement_evidence_count_check CHECK (
    attendee_count IS NULL OR attendee_count >= 0
  )
);

CREATE INDEX IF NOT EXISTS settlement_evidence_run
  ON public.settlement_attendance_evidence (settlement_run_id);

CREATE TABLE IF NOT EXISTS public.settlement_attendance_webhook_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('webhook_posh', 'webhook_luma', 'webhook_partiful')),
  attendance_count INTEGER NOT NULL CHECK (attendance_count >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS settlement_attendance_webhook_cache_event_source
  ON public.settlement_attendance_webhook_cache (event_id, source)
  WHERE applied_at IS NULL;

COMMENT ON TABLE public.settlement_attendance_webhook_cache IS
  'Caches attendance counts from ticketing webhooks that arrive before a settlement_run exists.';

ALTER TABLE public.settlement_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_attendance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_attendance_webhook_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers read own settlement runs" ON public.settlement_runs;
CREATE POLICY "Organizers read own settlement runs"
  ON public.settlement_runs FOR SELECT USING (auth.uid() = organizer_id);

DROP POLICY IF EXISTS "Service role manages settlement runs" ON public.settlement_runs;
CREATE POLICY "Service role manages settlement runs"
  ON public.settlement_runs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Organizers read own evidence" ON public.settlement_attendance_evidence;
CREATE POLICY "Organizers read own evidence"
  ON public.settlement_attendance_evidence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.settlement_runs
      WHERE settlement_runs.id = settlement_attendance_evidence.settlement_run_id
        AND settlement_runs.organizer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Organizers insert evidence for own runs" ON public.settlement_attendance_evidence;
CREATE POLICY "Organizers insert evidence for own runs"
  ON public.settlement_attendance_evidence FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.settlement_runs
      WHERE settlement_runs.id = settlement_attendance_evidence.settlement_run_id
        AND settlement_runs.organizer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages evidence" ON public.settlement_attendance_evidence;
CREATE POLICY "Service role manages evidence"
  ON public.settlement_attendance_evidence FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role manages settlement webhook cache" ON public.settlement_attendance_webhook_cache;
CREATE POLICY "Service role manages settlement webhook cache"
  ON public.settlement_attendance_webhook_cache FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.settlement_runs TO authenticated;
GRANT SELECT, INSERT ON public.settlement_attendance_evidence TO authenticated;
GRANT ALL ON public.settlement_runs TO service_role;
GRANT ALL ON public.settlement_attendance_evidence TO service_role;
GRANT ALL ON public.settlement_attendance_webhook_cache TO service_role;

DROP TRIGGER IF EXISTS update_settlement_runs_updated_at ON public.settlement_runs;
CREATE TRIGGER update_settlement_runs_updated_at
  BEFORE UPDATE ON public.settlement_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_settlement_attendance_webhook_cache_updated_at ON public.settlement_attendance_webhook_cache;
CREATE TRIGGER update_settlement_attendance_webhook_cache_updated_at
  BEFORE UPDATE ON public.settlement_attendance_webhook_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
