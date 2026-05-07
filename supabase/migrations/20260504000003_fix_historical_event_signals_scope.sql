-- Migration: Fix historical_event_signals scope for global benchmark data
-- Created: 2026-05-04
-- Context: Eventbrite, Luma, and Posh imports are platform benchmark data.
-- Authenticated builders can read benchmark signals, while only service role
-- imports new platform-level rows.

-- Drop policies that reference user_id before removing the column.
DROP POLICY IF EXISTS "Users can view own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can create own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can update own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can delete own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Authenticated users can read global signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can manage own signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Service role can insert global signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "signals_owner" ON public.historical_event_signals;
DROP POLICY IF EXISTS "signals_readable_by_authenticated" ON public.historical_event_signals;
DROP POLICY IF EXISTS "signals_insert_service_role_only" ON public.historical_event_signals;

-- Drop indexes that depend on user_id before dropping the column.
DROP INDEX IF EXISTS public.idx_historical_event_signals_user_id;
DROP INDEX IF EXISTS public.idx_historical_event_signals_match;

ALTER TABLE public.historical_event_signals DROP COLUMN IF EXISTS user_id;

-- Allow any authenticated user to read signals; these are public benchmarks.
ALTER TABLE public.historical_event_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals_readable_by_authenticated"
  ON public.historical_event_signals FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert benchmark data.
CREATE POLICY "signals_insert_service_role_only"
  ON public.historical_event_signals FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Recreate the matching index without user ownership scope.
CREATE INDEX IF NOT EXISTS idx_historical_event_signals_match
  ON public.historical_event_signals(event_type, neighborhood, event_date);
