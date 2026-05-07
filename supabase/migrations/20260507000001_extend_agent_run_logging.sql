ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS messages_payload JSONB,
  ADD COLUMN IF NOT EXISTS raw_model_output TEXT,
  ADD COLUMN IF NOT EXISTS quality_label TEXT CHECK (quality_label IN ('good', 'corrected', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_agent_runs_plan
  ON public.agent_runs(plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_quality
  ON public.agent_runs(agent_name, quality_label)
  WHERE quality_label IS NOT NULL;
