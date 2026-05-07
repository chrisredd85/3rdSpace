-- Migration: Add opportunity email job logging
-- Created: 2026-05-04
-- Context: Venue opportunity invites are sent asynchronously by app_jobs and
-- every provider attempt is recorded for operator/debug visibility.

CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  provider TEXT,
  outcome TEXT NOT NULL,
  status_code INTEGER,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.webhook_logs IS
  'Operational log for outbound provider attempts, inbound webhooks, and async delivery outcomes.';
COMMENT ON COLUMN public.webhook_logs.source IS
  'Subsystem that created the log row, such as opportunity_email_worker.';
COMMENT ON COLUMN public.webhook_logs.outcome IS
  'Attempt outcome such as sent, stubbed, provider_failure, skipped, or expired.';

CREATE INDEX IF NOT EXISTS idx_webhook_logs_source_created_at
  ON public.webhook_logs(source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_entity
  ON public.webhook_logs(entity_type, entity_id);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage webhook logs" ON public.webhook_logs;
CREATE POLICY "Service role can manage webhook logs"
  ON public.webhook_logs FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON TABLE public.webhook_logs TO service_role;

CREATE INDEX IF NOT EXISTS idx_app_jobs_opportunity_invite_jobs
  ON public.app_jobs(job_type, status, scheduled_at)
  WHERE job_type IN (
    'opportunity_send_venue_invite',
    'opportunity_remind_venue_invite',
    'opportunity_expire_venue_invite'
  );
