CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
  ON public.agent_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_event_created
  ON public.agent_runs(event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_status
  ON public.agent_runs(agent_name, status);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own agent runs" ON public.agent_runs;
CREATE POLICY "Users can view own agent runs"
  ON public.agent_runs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own agent runs" ON public.agent_runs;
CREATE POLICY "Users can create own agent runs"
  ON public.agent_runs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
