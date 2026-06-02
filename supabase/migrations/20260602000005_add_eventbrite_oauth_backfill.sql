-- Migration: Add Eventbrite OAuth backfill support
-- Created: 2026-06-02
-- Context: Eventbrite OAuth/backfill needs builder-scoped webhook config,
-- durable event mapping, field confidence, and API-imported platform fees.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS eventbrite_event_id text,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_builder_eventbrite_event_id
  ON public.events(builder_id, eventbrite_event_id)
  WHERE eventbrite_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_eventbrite_event_id
  ON public.events(eventbrite_event_id)
  WHERE eventbrite_event_id IS NOT NULL;

ALTER TABLE public.builder_ticketing_connections
  ADD COLUMN IF NOT EXISTS last_webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text;

ALTER TABLE public.event_cost_commitments
  DROP CONSTRAINT IF EXISTS event_cost_commitments_source_check;

ALTER TABLE public.event_cost_commitments
  ADD CONSTRAINT event_cost_commitments_source_check
  CHECK (source IN ('manual', 'outreach_reply', 'receipt_upload', 'csv_import', 'api_import', 'webhook'));

COMMENT ON COLUMN public.events.eventbrite_event_id IS
  'External Eventbrite event id imported or linked by the builder.';
COMMENT ON COLUMN public.events.field_confidence IS
  'Field-level confidence labels for provider-imported event fields.';
