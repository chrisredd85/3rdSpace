-- Migration: Add Posh org connection, event mapping, and quarantine inbox
-- Created: 2026-06-02
-- Context: Posh org webhooks need a builder-scoped secret, event mapping, heartbeat,
-- and a quarantine inbox for unmapped external Posh event ids.

ALTER TABLE public.builder_ticketing_connections
  DROP CONSTRAINT IF EXISTS builder_ticketing_connections_status_check;

ALTER TABLE public.builder_ticketing_connections
  ADD CONSTRAINT builder_ticketing_connections_status_check
  CHECK (
    status IN (
      'not_connected',
      'selected',
      'setup_required',
      'awaiting_test',
      'pending',
      'connected',
      'failed',
      'disabled'
    )
  );

ALTER TABLE public.builder_ticketing_connections
  ADD COLUMN IF NOT EXISTS last_webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text;

ALTER TABLE public.provider_connections
  DROP CONSTRAINT IF EXISTS provider_connections_status_check;

ALTER TABLE public.provider_connections
  ADD CONSTRAINT provider_connections_status_check
  CHECK (
    status IN (
      'not_connected',
      'setup_required',
      'awaiting_test',
      'pending',
      'connected',
      'linked',
      'failed',
      'disabled'
    )
  );

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS posh_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_builder_posh_event_id
  ON public.events(builder_id, posh_event_id)
  WHERE posh_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_posh_event_id
  ON public.events(posh_event_id)
  WHERE posh_event_id IS NOT NULL;

ALTER TABLE public.event_sales_data
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS gross_cents integer,
  ADD COLUMN IF NOT EXISTS tier_name text;

ALTER TABLE public.event_sales_data
  DROP CONSTRAINT IF EXISTS event_sales_data_gross_cents_check;

ALTER TABLE public.event_sales_data
  ADD CONSTRAINT event_sales_data_gross_cents_check
  CHECK (gross_cents IS NULL OR gross_cents >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_sales_event_platform_order
  ON public.event_sales_data(event_id, platform, order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.event_cost_commitments
  ADD COLUMN IF NOT EXISTS source_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_cost_commitments_source_ref
  ON public.event_cost_commitments(event_id, source, source_ref, category)
  WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.unlinked_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  builder_id uuid NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_event_id text NOT NULL,
  webhook_event_id text,
  webhook_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  linked_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unlinked_ticket_events_platform_check
    CHECK (platform IN ('posh', 'luma', 'partiful', 'eventbrite'))
);

CREATE INDEX IF NOT EXISTS idx_unlinked_ticket_events_builder_open
  ON public.unlinked_ticket_events(builder_id, platform, received_at DESC)
  WHERE linked_event_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unlinked_ticket_events_delivery
  ON public.unlinked_ticket_events(platform, builder_id, webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_unlinked_ticket_events_updated_at
  ON public.unlinked_ticket_events;

CREATE TRIGGER update_unlinked_ticket_events_updated_at
  BEFORE UPDATE ON public.unlinked_ticket_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.unlinked_ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can view own unlinked ticket events"
  ON public.unlinked_ticket_events;
CREATE POLICY "Builders can view own unlinked ticket events"
  ON public.unlinked_ticket_events FOR SELECT
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can update own unlinked ticket events"
  ON public.unlinked_ticket_events;
CREATE POLICY "Builders can update own unlinked ticket events"
  ON public.unlinked_ticket_events FOR UPDATE
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

DROP POLICY IF EXISTS "Service role can manage unlinked ticket events"
  ON public.unlinked_ticket_events;
CREATE POLICY "Service role can manage unlinked ticket events"
  ON public.unlinked_ticket_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON COLUMN public.events.posh_event_id IS
  'External Posh event id assigned by the builder for org-level Posh webhooks.';
COMMENT ON TABLE public.unlinked_ticket_events IS
  'Builder-scoped quarantine inbox for verified ticket webhooks whose external event id is not linked to a 3rdPlace event.';
COMMENT ON COLUMN public.event_cost_commitments.source_ref IS
  'Idempotency reference for external source rows, such as one platform fee per webhook order.';
