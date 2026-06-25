-- Migration: Track Stripe setup notifications for authorization gates
-- Created: 2026-06-25
-- Context: Payment-like approvals must not proceed when the recipient cannot
-- receive funds through Stripe Connect. This table records rate-limited setup
-- reminders so organizer retries do not spam venues or vendors.

CREATE TABLE IF NOT EXISTS public.stripe_setup_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  organizer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT stripe_setup_notifications_entity_type_check
    CHECK (entity_type IN ('venue', 'vendor', 'organizer')),
  CONSTRAINT stripe_setup_notifications_reason_check
    CHECK (reason IN ('no_account', 'onboarding_incomplete', 'restricted', 'disabled', 'deauthorized')),
  CONSTRAINT stripe_setup_notifications_channel_check
    CHECK (channel IN ('email', 'webhook_log', 'in_app'))
);

COMMENT ON TABLE public.stripe_setup_notifications IS
  'Rate-limited audit log for Stripe setup reminders and readiness-unblock notices triggered by planner authorization gates.';
COMMENT ON COLUMN public.stripe_setup_notifications.entity_id IS
  'For venues this is the venue row id when available; for vendors this is vendor_profiles.id; for organizers this is users.id.';

CREATE INDEX IF NOT EXISTS idx_stripe_setup_notifications_entity_recent
  ON public.stripe_setup_notifications(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_setup_notifications_plan_recent
  ON public.stripe_setup_notifications(plan_id, created_at DESC)
  WHERE plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_setup_notifications_organizer_recent
  ON public.stripe_setup_notifications(organizer_id, created_at DESC)
  WHERE organizer_id IS NOT NULL;

ALTER TABLE public.stripe_setup_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers can view own stripe setup notifications"
  ON public.stripe_setup_notifications;
CREATE POLICY "Organizers can view own stripe setup notifications"
  ON public.stripe_setup_notifications FOR SELECT
  USING (organizer_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage stripe setup notifications"
  ON public.stripe_setup_notifications;
CREATE POLICY "Service role can manage stripe setup notifications"
  ON public.stripe_setup_notifications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.stripe_setup_notifications TO authenticated;
GRANT ALL ON public.stripe_setup_notifications TO service_role;
