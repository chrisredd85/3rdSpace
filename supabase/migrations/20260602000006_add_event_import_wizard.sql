-- Migration: Add one-shot event import wizard support
-- Created: 2026-06-02
-- Context: CSV/manual/screenshot imports need durable staging plus confidence
-- metadata on imported event, attendee, and sales fields.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.imported_attendees
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.event_sales_data
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.event_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  event_url text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_import_sessions_source_check
    CHECK (source IN ('posh', 'eventbrite', 'luma', 'partiful', 'other')),
  CONSTRAINT event_import_sessions_status_check
    CHECK (status IN ('draft', 'mapping_required', 'ready', 'finalized', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_event_import_sessions_builder_status
  ON public.event_import_sessions(builder_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_import_sessions_event_id
  ON public.event_import_sessions(event_id)
  WHERE event_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_event_import_sessions_updated_at
  ON public.event_import_sessions;

CREATE TRIGGER update_event_import_sessions_updated_at
  BEFORE UPDATE ON public.event_import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can view own event import sessions"
  ON public.event_import_sessions;
CREATE POLICY "Builders can view own event import sessions"
  ON public.event_import_sessions FOR SELECT
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can create own event import sessions"
  ON public.event_import_sessions;
CREATE POLICY "Builders can create own event import sessions"
  ON public.event_import_sessions FOR INSERT
  WITH CHECK (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can update own event import sessions"
  ON public.event_import_sessions;
CREATE POLICY "Builders can update own event import sessions"
  ON public.event_import_sessions FOR UPDATE
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role can manage event import sessions"
  ON public.event_import_sessions;
CREATE POLICY "Service role can manage event import sessions"
  ON public.event_import_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.event_import_sessions TO authenticated;
GRANT ALL ON TABLE public.event_import_sessions TO service_role;

COMMENT ON TABLE public.event_import_sessions IS
  'Durable staging records for one-shot event imports from CSV, screenshots, URL scrape, or manual fallback.';
COMMENT ON COLUMN public.events.field_confidence IS
  'Per-field confidence metadata, shaped as field_name -> {confidence, source}.';
COMMENT ON COLUMN public.imported_attendees.field_confidence IS
  'Per-field confidence metadata for attendee import rows.';
COMMENT ON COLUMN public.event_sales_data.field_confidence IS
  'Per-field confidence metadata for sales import rows.';
