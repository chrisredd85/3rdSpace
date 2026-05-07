-- Migration: Add booked partner workspaces
-- Created: 2026-05-04
-- Context: Accepted venue/vendor opportunity invites become host-owned workspaces
-- after the deposit step is unblocked. Workspaces hold partner messages,
-- milestones, documents, and booking coordination state.

CREATE TABLE IF NOT EXISTS public.partnership_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  partner_kind TEXT NOT NULL,
  partner_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partnership_threads_partner_kind_check
    CHECK (partner_kind IN ('venue', 'vendor')),
  CONSTRAINT partnership_threads_status_check
    CHECK (status IN ('pending_deposit', 'active', 'complete', 'cancelled')),
  CONSTRAINT partnership_threads_plan_partner_key
    UNIQUE (plan_id, partner_kind, partner_id)
);

CREATE TABLE IF NOT EXISTS public.partnership_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.partnership_threads(id) ON DELETE CASCADE,
  sender_kind TEXT NOT NULL,
  body TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partnership_messages_sender_kind_check
    CHECK (sender_kind IN ('host', 'partner', 'agent', 'concierge'))
);

CREATE TABLE IF NOT EXISTS public.partnership_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.partnership_threads(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partnership_milestones_thread_label_key
    UNIQUE (thread_id, label)
);

CREATE TABLE IF NOT EXISTS public.partnership_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.partnership_threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partnership_documents_kind_check
    CHECK (kind IN ('contract', 'coi', 'invoice', 'receipt'))
);

COMMENT ON TABLE public.partnership_threads IS
  'Booked partner workspaces created from accepted venue/vendor opportunity invites.';
COMMENT ON TABLE public.partnership_messages IS
  'Host, partner, agent, and concierge messages attached to a booked partner workspace.';
COMMENT ON TABLE public.partnership_milestones IS
  'Operational timeline for a booked partner workspace.';
COMMENT ON TABLE public.partnership_documents IS
  'Contracts, COIs, invoices, and receipts attached to a booked partner workspace.';

CREATE INDEX IF NOT EXISTS idx_partnership_threads_plan_kind
  ON public.partnership_threads(plan_id, partner_kind);
CREATE INDEX IF NOT EXISTS idx_partnership_messages_thread_created
  ON public.partnership_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_partnership_milestones_thread
  ON public.partnership_milestones(thread_id);
CREATE INDEX IF NOT EXISTS idx_partnership_documents_thread
  ON public.partnership_documents(thread_id);

ALTER TABLE public.partnership_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnership_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Builders can manage own partnership threads"
  ON public.partnership_threads;
CREATE POLICY "Builders can manage own partnership threads"
  ON public.partnership_threads
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.plans plan
      WHERE plan.id = partnership_threads.plan_id
        AND plan.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.plans plan
      WHERE plan.id = partnership_threads.plan_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can manage own partnership messages"
  ON public.partnership_messages;
CREATE POLICY "Builders can manage own partnership messages"
  ON public.partnership_messages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_messages.thread_id
        AND plan.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_messages.thread_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can manage own partnership milestones"
  ON public.partnership_milestones;
CREATE POLICY "Builders can manage own partnership milestones"
  ON public.partnership_milestones
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_milestones.thread_id
        AND plan.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_milestones.thread_id
        AND plan.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Builders can manage own partnership documents"
  ON public.partnership_documents;
CREATE POLICY "Builders can manage own partnership documents"
  ON public.partnership_documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_documents.thread_id
        AND plan.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.partnership_threads thread
      JOIN public.plans plan ON plan.id = thread.plan_id
      WHERE thread.id = partnership_documents.thread_id
        AND plan.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partnership_threads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partnership_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partnership_milestones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partnership_documents TO authenticated;
GRANT ALL ON public.partnership_threads TO service_role;
GRANT ALL ON public.partnership_messages TO service_role;
GRANT ALL ON public.partnership_milestones TO service_role;
GRANT ALL ON public.partnership_documents TO service_role;
