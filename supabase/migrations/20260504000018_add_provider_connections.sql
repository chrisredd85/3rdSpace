-- Migration: Add normalized provider connections
-- Created: 2026-05-04
-- Context: Ticketing integrations need a provider-agnostic credential store for
-- Eventbrite, Luma, Posh, and Partiful while existing builder ticketing flows
-- continue to read builder_ticketing_connections.

CREATE TABLE IF NOT EXISTS public.provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  builder_id UUID REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.plans(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'setup_required',
  external_account_id TEXT,
  webhook_url TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT provider_connections_provider_check
    CHECK (provider IN ('eventbrite', 'luma', 'posh', 'partiful')),
  CONSTRAINT provider_connections_status_check
    CHECK (status IN ('setup_required', 'pending', 'connected', 'linked', 'failed', 'disabled')),
  CONSTRAINT provider_connections_scope_check
    CHECK (builder_id IS NOT NULL OR plan_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_user_provider_builder
  ON public.provider_connections(user_id, provider, builder_id)
  WHERE builder_id IS NOT NULL AND plan_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_connections_user_provider_plan
  ON public.provider_connections(user_id, provider, plan_id)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_connections_user
  ON public.provider_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_provider_connections_provider_status
  ON public.provider_connections(provider, status);

DROP TRIGGER IF EXISTS update_provider_connections_updated_at
  ON public.provider_connections;

CREATE TRIGGER update_provider_connections_updated_at
  BEFORE UPDATE ON public.provider_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own provider connections"
  ON public.provider_connections;
CREATE POLICY "Users can view own provider connections"
  ON public.provider_connections FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own provider connections"
  ON public.provider_connections;
CREATE POLICY "Users can create own provider connections"
  ON public.provider_connections FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own provider connections"
  ON public.provider_connections;
CREATE POLICY "Users can update own provider connections"
  ON public.provider_connections FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage provider connections"
  ON public.provider_connections;
CREATE POLICY "Service role can manage provider connections"
  ON public.provider_connections FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.provider_connections IS
  'Provider-agnostic connection store for ticketing and RSVP integrations.';
COMMENT ON COLUMN public.provider_connections.encrypted_credentials IS
  'Encrypted provider credentials, tokens, or webhook secrets. Never returned to the client.';

GRANT SELECT, INSERT, UPDATE ON TABLE public.provider_connections TO authenticated;
GRANT ALL ON TABLE public.provider_connections TO service_role;
