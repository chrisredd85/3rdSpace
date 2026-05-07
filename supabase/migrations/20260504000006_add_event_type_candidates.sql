-- Migration: Add event type candidate review queue for unsupported planner intents
-- Created: 2026-05-04
-- Context: Unsupported but plannable event phrases should not block users. The
-- planner captures them for taxonomy review while continuing with fallback flows.

CREATE TABLE IF NOT EXISTS public.event_type_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  raw_phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  inferred_archetype TEXT NOT NULL,
  suggested_event_type TEXT,
  event_components JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_plan_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  frequency_count INTEGER NOT NULL DEFAULT 1 CHECK (frequency_count > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.event_type_candidates IS
  'Review queue for unsupported event phrases captured by the planner taxonomy fallback.';
COMMENT ON COLUMN public.event_type_candidates.raw_phrase IS
  'Original unsupported event phrase extracted from the user message.';
COMMENT ON COLUMN public.event_type_candidates.normalized_phrase IS
  'Lowercase normalized phrase used for grouping similar candidate events.';
COMMENT ON COLUMN public.event_type_candidates.inferred_archetype IS
  'Fallback planning archetype used while the phrase is pending taxonomy review.';
COMMENT ON COLUMN public.event_type_candidates.suggested_questions IS
  'Draft intake questions proposed for future taxonomy promotion.';
COMMENT ON COLUMN public.event_type_candidates.event_components IS
  'Parsed primary and secondary components for compound events such as night run with mocktails.';
COMMENT ON COLUMN public.event_type_candidates.frequency_count IS
  'Occurrence count for this captured candidate row. MVP inserts one row per capture.';
COMMENT ON COLUMN public.event_type_candidates.status IS
  'Review state controlled by internal admins before taxonomy promotion.';

CREATE INDEX IF NOT EXISTS idx_event_type_candidates_status_created_at
  ON public.event_type_candidates(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_type_candidates_normalized_phrase
  ON public.event_type_candidates(normalized_phrase);
CREATE INDEX IF NOT EXISTS idx_event_type_candidates_user_id_created_at
  ON public.event_type_candidates(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_type_candidates_plan_id
  ON public.event_type_candidates(plan_id);

CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON public.event_type_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_type_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create own event type candidates" ON public.event_type_candidates;
CREATE POLICY "Users can create own event type candidates"
  ON public.event_type_candidates FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own event type candidates" ON public.event_type_candidates;
CREATE POLICY "Users can view own event type candidates"
  ON public.event_type_candidates FOR SELECT
  USING (user_id = auth.uid());

GRANT ALL ON TABLE public.event_type_candidates TO authenticated;
GRANT ALL ON TABLE public.event_type_candidates TO service_role;
