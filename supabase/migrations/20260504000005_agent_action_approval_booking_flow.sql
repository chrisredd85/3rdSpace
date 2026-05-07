-- Migration: Add booking-flow fields for planner agent actions and approvals
-- Created: 2026-05-04
-- Context: Recommendation CTAs first create an agent action, then create or update
-- an approval linked to that action before any booking, hold, or vendor outreach runs.

ALTER TABLE public.agent_actions
  ADD COLUMN IF NOT EXISTS target_type TEXT,
  ADD COLUMN IF NOT EXISTS target_id UUID,
  ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agent_actions.target_type IS
  'Optional target category for the action, such as venue, vendor, ticket, or recommendation.';
COMMENT ON COLUMN public.agent_actions.target_id IS
  'Optional target row id for the venue, vendor, recommendation, or external object.';
COMMENT ON COLUMN public.agent_actions.payload_json IS
  'Structured request details captured from the recommendation card or planner UI.';

ALTER TABLE public.agent_actions
  DROP CONSTRAINT IF EXISTS agent_actions_action_type_check;
ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_action_type_check
  CHECK (
    action_type IN (
      'payment',
      'external_link',
      'concierge_queue',
      'email',
      'export',
      'hold',
      'hold_request',
      'vendor_contact',
      'external_checkout',
      'ai_query'
    )
  );

ALTER TABLE public.agent_actions
  DROP CONSTRAINT IF EXISTS agent_actions_status_check;
ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_status_check
  CHECK (status IN ('pending', 'proposed', 'approved', 'executing', 'complete', 'cancelled', 'failed'));

CREATE INDEX IF NOT EXISTS idx_agent_actions_target
  ON public.agent_actions(target_type, target_id);

ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS requested_amount_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS authorized_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS authorized_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;

COMMENT ON COLUMN public.approvals.requested_amount_cents IS
  'Amount in integer cents requested when the linked agent action was created.';
COMMENT ON COLUMN public.approvals.authorized_amount_cents IS
  'Amount in integer cents explicitly authorized by the user.';
COMMENT ON COLUMN public.approvals.authorized_by IS
  'auth.users.id for the user who authorized this approval.';
COMMENT ON COLUMN public.approvals.authorized_at IS
  'Timestamp when the user authorized this approval.';

ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_status_check
  CHECK (
    status IN (
      'pending',
      'approved',
      'authorized',
      'rejected',
      'cancelled',
      'expired',
      're_approval_required'
    )
  );

ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_requested_amount_cents_check;
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_requested_amount_cents_check
  CHECK (requested_amount_cents >= 0);

ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_authorized_amount_cents_check;
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_authorized_amount_cents_check
  CHECK (authorized_amount_cents IS NULL OR authorized_amount_cents >= 0);
