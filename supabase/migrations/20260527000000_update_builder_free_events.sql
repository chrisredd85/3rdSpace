-- Migration: Update builder free tier from one event to two
-- Created: 2026-05-27
-- Context: Phase 0 billing fix before marketplace money-flow work.

ALTER TABLE public.builder_profiles
  ALTER COLUMN free_events_granted SET DEFAULT 2;

UPDATE public.builder_profiles
SET free_events_granted = 2
WHERE free_events_granted IS NULL
  OR free_events_granted < 2;

-- Down migration reference:
-- ALTER TABLE public.builder_profiles
--   ALTER COLUMN free_events_granted SET DEFAULT 1;
-- UPDATE public.builder_profiles
-- SET free_events_granted = 1
-- WHERE billing_tier = 'free_trial'
--   AND free_events_granted = 2
--   AND COALESCE(free_events_used, 0) <= 1;
