-- Migration: Persist creator signup context and signup funnel instrumentation
-- Context: The signup UI collects organizer profile, attendance, and optional
-- ticketing/Gmail setup intent. These fields must be durable so planner intake,
-- outreach, and cold-start recommendations can use them instead of dropping them.

ALTER TABLE public.builder_profiles
  ADD COLUMN IF NOT EXISTS organization_name TEXT,
  ADD COLUMN IF NOT EXISTS organization_type TEXT,
  ADD COLUMN IF NOT EXISTS social_handle TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS typical_attendance_min INTEGER,
  ADD COLUMN IF NOT EXISTS typical_attendance_max INTEGER,
  ADD COLUMN IF NOT EXISTS bulk_booking_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invite_collaborators TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS signup_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.builder_profiles
  DROP CONSTRAINT IF EXISTS builder_profiles_typical_attendance_min_check,
  DROP CONSTRAINT IF EXISTS builder_profiles_typical_attendance_max_check,
  DROP CONSTRAINT IF EXISTS builder_profiles_typical_attendance_range_check,
  ADD CONSTRAINT builder_profiles_typical_attendance_min_check
    CHECK (typical_attendance_min IS NULL OR typical_attendance_min >= 0),
  ADD CONSTRAINT builder_profiles_typical_attendance_max_check
    CHECK (typical_attendance_max IS NULL OR typical_attendance_max >= 0),
  ADD CONSTRAINT builder_profiles_typical_attendance_range_check
    CHECK (
      typical_attendance_min IS NULL
      OR typical_attendance_max IS NULL
      OR typical_attendance_max >= typical_attendance_min
    );

COMMENT ON COLUMN public.builder_profiles.organization_name IS
  'Creator organization, brand, or collective name collected during signup. Used as organizer context in planner intake and outreach.';
COMMENT ON COLUMN public.builder_profiles.organization_type IS
  'Creator organization type collected during signup. Soft context only; explicit planner input wins.';
COMMENT ON COLUMN public.builder_profiles.social_handle IS
  'Public social handle collected during signup for outreach trust context.';
COMMENT ON COLUMN public.builder_profiles.website IS
  'Public website collected during signup for outreach trust context.';
COMMENT ON COLUMN public.builder_profiles.bio IS
  'Short organizer bio collected during signup for planner/outreach context.';
COMMENT ON COLUMN public.builder_profiles.typical_attendance_min IS
  'Lower bound of self-reported typical event attendance from creator signup.';
COMMENT ON COLUMN public.builder_profiles.typical_attendance_max IS
  'Upper bound of self-reported typical event attendance from creator signup.';
COMMENT ON COLUMN public.builder_profiles.bulk_booking_enabled IS
  'Creator signup preference for planning multiple events or recurring bookings.';
COMMENT ON COLUMN public.builder_profiles.invite_collaborators IS
  'Collaborator emails entered during creator signup. Invitations are not sent automatically.';
COMMENT ON COLUMN public.builder_profiles.signup_metadata IS
  'Non-critical signup context such as optional setup choices. Does not drive execution without approval.';

CREATE TABLE IF NOT EXISTS public.signup_funnel_events (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  anonymous_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('community_builder', 'venue_owner', 'vendor')),
  event_name TEXT NOT NULL CHECK (event_name IN ('signup_step_viewed', 'signup_step_completed')),
  step INTEGER CHECK (step IS NULL OR step > 0),
  total_steps INTEGER CHECK (total_steps IS NULL OR total_steps > 0),
  method TEXT CHECK (method IS NULL OR method IN ('email', 'google')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.signup_funnel_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages signup funnel events" ON public.signup_funnel_events;
CREATE POLICY "Service role manages signup funnel events"
  ON public.signup_funnel_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_signup_funnel_events_created_at
  ON public.signup_funnel_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_funnel_events_role_step
  ON public.signup_funnel_events (role, step, event_name, created_at DESC);

GRANT ALL ON TABLE public.signup_funnel_events TO service_role;

COMMENT ON TABLE public.signup_funnel_events IS
  'Best-effort signup funnel instrumentation. No passwords, tokens, or message content.';
