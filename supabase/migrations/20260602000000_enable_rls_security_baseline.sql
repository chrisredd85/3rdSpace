-- Tier 1 security baseline: every public application table must have RLS.
-- Existing owner/collaborator policies on events and vendor_bookings already
-- define row visibility; this migration turns them on and tightens the webhook
-- rate-limit backing store to service-role access only.

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Builders can delete own events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.builder_profiles
      WHERE builder_profiles.id = events.builder_id
        AND builder_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage webhook rate limits"
  ON public.webhook_rate_limits
  FOR ALL
  TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_webhook_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
