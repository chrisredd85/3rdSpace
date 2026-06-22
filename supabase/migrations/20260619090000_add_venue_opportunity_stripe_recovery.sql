-- Migration: Add venue opportunity Stripe recovery state
-- Created: 2026-06-19
-- Context: Paid venue opportunities can be accepted before the venue has
-- completed Stripe Connect onboarding. The builder checkout remains blocked
-- until Connect is ready; this adds the self-serve recovery state around that
-- blocked path.

ALTER TABLE public.venue_opportunity_invites
  ADD COLUMN IF NOT EXISTS stripe_setup_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

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
    'venue_blocked_compliance',
    'pending_stripe_setup',
    'stripe_ready',
    'payment_confirmation_requested'
  ));

COMMENT ON COLUMN public.venue_opportunity_invites.stripe_setup_started_at IS
  'Timestamp when the accepted venue opportunity entered the Stripe Connect recovery loop.';
COMMENT ON COLUMN public.venue_opportunity_invites.stripe_ready_at IS
  'Timestamp when Stripe Connect became payout-ready for the claimed venue.';
COMMENT ON COLUMN public.venue_opportunity_invites.payment_confirmation_requested_at IS
  'Timestamp when the organizer was notified to confirm the venue rental payment after Stripe became ready.';
COMMENT ON COLUMN public.venue_opportunity_invites.decline_reason IS
  'Venue-facing decline reason captured from token-gated decline confirmation.';
COMMENT ON COLUMN public.venue_opportunity_invites.declined_at IS
  'Timestamp when the venue explicitly declined through the token-gated flow.';

CREATE INDEX IF NOT EXISTS idx_venue_opportunity_invites_stripe_recovery
  ON public.venue_opportunity_invites(venue_id, status, stripe_setup_started_at)
  WHERE status IN ('pending_stripe_setup', 'stripe_ready', 'payment_confirmation_requested');

CREATE INDEX IF NOT EXISTS idx_app_jobs_venue_stripe_setup_reminders
  ON public.app_jobs(job_type, status, scheduled_at)
  WHERE job_type = 'venue.stripe_setup_reminder';
