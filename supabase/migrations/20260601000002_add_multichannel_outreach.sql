-- Migration: Add multi-channel outreach foundation
-- Created: 2026-06-01
-- Context: Phase 4 expands creator-approved outreach beyond Gmail while
-- preserving human approval gates and channel-specific compliance controls.

ALTER TABLE public.outreach_threads
  ALTER COLUMN target_email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS target_phone TEXT,
  ADD COLUMN IF NOT EXISTS target_instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS channel_strategy JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.outreach_threads
  DROP CONSTRAINT IF EXISTS outreach_threads_channel_check;
ALTER TABLE public.outreach_threads
  ADD CONSTRAINT outreach_threads_channel_check
  CHECK (channel IN ('email', 'instagram', 'sms', 'voice'));

ALTER TABLE public.outreach_threads
  DROP CONSTRAINT IF EXISTS outreach_threads_target_email_check;
ALTER TABLE public.outreach_threads
  ADD CONSTRAINT outreach_threads_target_contact_check
  CHECK (
    (channel = 'email' AND target_email IS NOT NULL AND position('@' in target_email) > 1) OR
    (channel IN ('sms', 'voice') AND target_phone IS NOT NULL AND target_phone ~ '^\\+[1-9][0-9]{7,14}$') OR
    (channel = 'instagram' AND target_instagram_handle IS NOT NULL AND length(target_instagram_handle) > 1)
  );

DROP INDEX IF EXISTS public.idx_outreach_threads_plan_target_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_threads_plan_target_channel_active
  ON public.outreach_threads(plan_id, target_type, target_id, channel)
  WHERE target_id IS NOT NULL AND state <> 'cancelled';

COMMENT ON COLUMN public.outreach_threads.target_phone IS
  'E.164 business phone number for SMS or voice outreach.';
COMMENT ON COLUMN public.outreach_threads.target_instagram_handle IS
  'Public Instagram handle for creator-sent DM drafts.';
COMMENT ON COLUMN public.outreach_threads.channel_strategy IS
  'Planner-approved channel strategy and fallback sequence for this target.';

ALTER TABLE public.outreach_messages
  ADD COLUMN IF NOT EXISTS channel_external_id TEXT,
  ADD COLUMN IF NOT EXISTS attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS transcript_text TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS sent_manually BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_cost_cents INTEGER;

ALTER TABLE public.outreach_messages
  DROP CONSTRAINT IF EXISTS outreach_messages_provider_cost_check;
ALTER TABLE public.outreach_messages
  ADD CONSTRAINT outreach_messages_provider_cost_check
  CHECK (provider_cost_cents IS NULL OR provider_cost_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_channel_external
  ON public.outreach_messages(channel_external_id)
  WHERE channel_external_id IS NOT NULL;

COMMENT ON COLUMN public.outreach_messages.channel_external_id IS
  'Provider id such as Twilio MessageSid, Instagram manual-send marker, or voice call id.';
COMMENT ON COLUMN public.outreach_messages.sent_manually IS
  'True when the creator performed the send outside an API, such as Instagram deep link handoff.';
COMMENT ON COLUMN public.outreach_messages.transcript_text IS
  'Voice transcript text when returned by the voice provider or entered manually.';
COMMENT ON COLUMN public.outreach_messages.recording_url IS
  'Voice recording URL only when recording is permitted and retained.';

CREATE TABLE IF NOT EXISTS public.creator_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  e164_number TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  twilio_sid TEXT,
  a2p_registration_status TEXT NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creator_phone_numbers_e164_check
    CHECK (e164_number ~ '^\\+[1-9][0-9]{7,14}$'),
  CONSTRAINT creator_phone_numbers_a2p_status_check
    CHECK (a2p_registration_status IN ('not_started', 'pending', 'approved', 'rejected'))
);

COMMENT ON TABLE public.creator_phone_numbers IS
  'Creator-owned verified sender numbers used for approved SMS outreach.';
COMMENT ON COLUMN public.creator_phone_numbers.a2p_registration_status IS
  'Operator-controlled A2P/TCPA production readiness status. SMS cannot go live until approved.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_phone_numbers_user_number
  ON public.creator_phone_numbers(user_id, e164_number);

DROP TRIGGER IF EXISTS update_creator_phone_numbers_updated_at ON public.creator_phone_numbers;
CREATE TRIGGER update_creator_phone_numbers_updated_at
  BEFORE UPDATE ON public.creator_phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.venue_contact_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
  discovery_venue_id UUID REFERENCES public.discovery_venues(id) ON DELETE CASCADE,
  contact_name TEXT,
  email TEXT,
  phone_e164 TEXT,
  instagram_handle TEXT,
  preferred_channel TEXT NOT NULL DEFAULT 'email',
  sms_opted_out_at TIMESTAMPTZ,
  voice_allowed BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT venue_contact_profiles_target_check
    CHECK ((venue_id IS NOT NULL)::integer + (discovery_venue_id IS NOT NULL)::integer = 1),
  CONSTRAINT venue_contact_profiles_preferred_channel_check
    CHECK (preferred_channel IN ('email', 'instagram', 'sms', 'voice')),
  CONSTRAINT venue_contact_profiles_phone_check
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  CONSTRAINT venue_contact_profiles_email_check
    CHECK (email IS NULL OR position('@' in email) > 1)
);

COMMENT ON TABLE public.venue_contact_profiles IS
  'Per-venue public business contact methods and preferred outreach channel.';
COMMENT ON COLUMN public.venue_contact_profiles.sms_opted_out_at IS
  'Set automatically when a STOP/UNSUBSCRIBE SMS is received.';
COMMENT ON COLUMN public.venue_contact_profiles.voice_allowed IS
  'Operator-reviewed flag allowing approved voice availability checks.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_contact_profiles_venue
  ON public.venue_contact_profiles(venue_id)
  WHERE venue_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_contact_profiles_discovery
  ON public.venue_contact_profiles(discovery_venue_id)
  WHERE discovery_venue_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_venue_contact_profiles_updated_at ON public.venue_contact_profiles;
CREATE TRIGGER update_venue_contact_profiles_updated_at
  BEFORE UPDATE ON public.venue_contact_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.outreach_compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES public.outreach_threads(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.outreach_messages(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outreach_compliance_events_channel_check
    CHECK (channel IN ('email', 'instagram', 'sms', 'voice')),
  CONSTRAINT outreach_compliance_events_type_check
    CHECK (event_type IN ('sms_opt_out', 'sms_opt_out_honored', 'sms_send_blocked', 'voice_ai_disclosure', 'voice_send_blocked', 'manual_reply_logged')),
  CONSTRAINT outreach_compliance_events_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

COMMENT ON TABLE public.outreach_compliance_events IS
  'Audit trail for multi-channel outreach compliance events such as STOP keywords and AI voice disclosure.';

CREATE INDEX IF NOT EXISTS idx_outreach_compliance_events_created
  ON public.outreach_compliance_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_compliance_events_channel
  ON public.outreach_compliance_events(channel, event_type, created_at DESC);

ALTER TABLE public.creator_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_contact_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_compliance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Creators can view own phone numbers" ON public.creator_phone_numbers;
CREATE POLICY "Creators can view own phone numbers"
  ON public.creator_phone_numbers FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage creator phone numbers" ON public.creator_phone_numbers;
CREATE POLICY "Service role can manage creator phone numbers"
  ON public.creator_phone_numbers FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read venue contact profiles" ON public.venue_contact_profiles;
CREATE POLICY "Authenticated users can read venue contact profiles"
  ON public.venue_contact_profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage venue contact profiles" ON public.venue_contact_profiles;
CREATE POLICY "Service role can manage venue contact profiles"
  ON public.venue_contact_profiles FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

DROP POLICY IF EXISTS "Service role can manage outreach compliance events" ON public.outreach_compliance_events;
CREATE POLICY "Service role can manage outreach compliance events"
  ON public.outreach_compliance_events FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

GRANT SELECT ON public.creator_phone_numbers TO authenticated;
GRANT SELECT ON public.venue_contact_profiles TO authenticated;
GRANT ALL ON public.creator_phone_numbers TO service_role;
GRANT ALL ON public.venue_contact_profiles TO service_role;
GRANT ALL ON public.outreach_compliance_events TO service_role;
