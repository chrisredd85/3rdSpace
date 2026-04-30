-- ============================================================================
-- BUILDER-LEVEL TICKETING CONNECTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.builder_ticketing_connections (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  builder_id UUID NOT NULL REFERENCES public.builder_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'selected',
  external_account_id TEXT,
  account_label TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  webhook_url TEXT,
  webhook_secret_encrypted TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT builder_ticketing_connections_platform_check
    CHECK (platform IN ('eventbrite', 'luma', 'posh')),
  CONSTRAINT builder_ticketing_connections_status_check
    CHECK (status IN ('selected', 'setup_required', 'pending', 'connected', 'failed', 'disabled')),
  CONSTRAINT builder_ticketing_connections_builder_platform_key
    UNIQUE (builder_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_builder_ticketing_connections_builder_id
  ON public.builder_ticketing_connections(builder_id);

CREATE INDEX IF NOT EXISTS idx_builder_ticketing_connections_platform
  ON public.builder_ticketing_connections(platform);

DROP TRIGGER IF EXISTS update_builder_ticketing_connections_updated_at
  ON public.builder_ticketing_connections;

CREATE TRIGGER update_builder_ticketing_connections_updated_at
  BEFORE UPDATE ON public.builder_ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.builder_ticketing_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can view own ticketing connections"
  ON public.builder_ticketing_connections;
CREATE POLICY "Builders can view own ticketing connections"
  ON public.builder_ticketing_connections
  FOR SELECT
  USING (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can create own ticketing connections"
  ON public.builder_ticketing_connections;
CREATE POLICY "Builders can create own ticketing connections"
  ON public.builder_ticketing_connections
  FOR INSERT
  WITH CHECK (
    builder_id IN (
      SELECT id FROM public.builder_profiles WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can update own ticketing connections"
  ON public.builder_ticketing_connections;
CREATE POLICY "Builders can update own ticketing connections"
  ON public.builder_ticketing_connections
  FOR UPDATE
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

GRANT ALL ON TABLE public.builder_ticketing_connections TO anon;
GRANT ALL ON TABLE public.builder_ticketing_connections TO authenticated;
GRANT ALL ON TABLE public.builder_ticketing_connections TO service_role;

-- ============================================================================
-- DISTRIBUTED WEBHOOK RATE LIMITING
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_rate_limits (
  rate_limit_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE OR REPLACE FUNCTION public.consume_webhook_rate_limit(
  p_key TEXT,
  p_limit INTEGER DEFAULT 120,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_count INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  INSERT INTO public.webhook_rate_limits(rate_limit_key, request_count, reset_at)
  VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (rate_limit_key)
  DO UPDATE SET
    request_count = CASE
      WHEN public.webhook_rate_limits.reset_at <= v_now THEN 1
      ELSE public.webhook_rate_limits.request_count + 1
    END,
    reset_at = CASE
      WHEN public.webhook_rate_limits.reset_at <= v_now THEN v_now + make_interval(secs => p_window_seconds)
      ELSE public.webhook_rate_limits.reset_at
    END
  RETURNING request_count, reset_at INTO v_count, v_reset_at;

  RETURN v_count <= p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- PAYMENT IDEMPOTENCY
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.vendor_transactions') IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_transactions_active_payment
      ON public.vendor_transactions(booking_id, payment_type)
      WHERE payment_type IN ('deposit', 'final_payment')
        AND status IN ('pending', 'processing', 'succeeded');
  END IF;
END $$;

-- ============================================================================
-- APPLICATION JOB QUEUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_jobs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  unique_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_jobs_status_check
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
  CONSTRAINT app_jobs_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT app_jobs_max_attempts_check
    CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS idx_app_jobs_status_scheduled
  ON public.app_jobs(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_app_jobs_type_status
  ON public.app_jobs(job_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_jobs_active_unique_key
  ON public.app_jobs(unique_key)
  WHERE unique_key IS NOT NULL
    AND status IN ('pending', 'running');

DROP TRIGGER IF EXISTS update_app_jobs_updated_at
  ON public.app_jobs;

CREATE TRIGGER update_app_jobs_updated_at
  BEFORE UPDATE ON public.app_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.app_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage app jobs" ON public.app_jobs;
CREATE POLICY "Service role can manage app jobs"
  ON public.app_jobs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.app_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_app_jobs(
  p_limit INTEGER DEFAULT 5,
  p_worker_id TEXT DEFAULT 'next-worker'
)
RETURNS SETOF public.app_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT id
    FROM public.app_jobs
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.app_jobs jobs
  SET
    status = 'running',
    attempts = jobs.attempts + 1,
    started_at = COALESCE(jobs.started_at, now()),
    locked_at = now(),
    locked_by = p_worker_id,
    error = NULL,
    updated_at = now()
  FROM candidates
  WHERE jobs.id = candidates.id
  RETURNING jobs.*;
$$;

GRANT EXECUTE ON FUNCTION public.claim_app_jobs(INTEGER, TEXT) TO service_role;
