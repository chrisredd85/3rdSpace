-- Migration: Agent Planner schema
-- Created: 2026-05-04

-- ============================================================================
-- AGENT PLANNER CORE
-- Adds planner-owned tables without changing existing marketplace tables.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  -- Unique identifier for a planner session or saved event plan.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Owner of the plan; must be a row in public.users.
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Human-readable plan title shown in planner lists and exports.
  title TEXT NOT NULL,
  -- Planner-facing event category such as mixer, dinner, outing, or offsite.
  event_type TEXT,
  -- Current lifecycle state of the plan.
  status TEXT NOT NULL DEFAULT 'drafting',
  -- Expected number of guests or attendees.
  guest_count INTEGER,
  -- Maximum target spend for the plan, stored as integer cents.
  budget_cap_cents INTEGER, -- stored as integer cents
  -- Preferred Bay Area neighborhood or local area.
  neighborhood TEXT,
  -- Earliest acceptable event date.
  date_window_start DATE,
  -- Latest acceptable event date.
  date_window_end DATE,
  -- Whether the experience is expected to sell tickets.
  ticketed BOOLEAN NOT NULL DEFAULT false,
  -- Profit target or breakeven target for the event, stored as integer cents.
  profit_goal_cents INTEGER, -- stored as integer cents
  -- Freeform planner notes, assumptions, or unresolved constraints.
  notes TEXT,
  -- Timestamp when the plan was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the plan was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plans_status_check
    CHECK (status IN ('drafting', 'ready', 'approved', 'executing', 'complete', 'archived')),
  CONSTRAINT plans_guest_count_check
    CHECK (guest_count IS NULL OR guest_count >= 0),
  CONSTRAINT plans_budget_cap_cents_check
    CHECK (budget_cap_cents IS NULL OR budget_cap_cents >= 0),
  CONSTRAINT plans_profit_goal_cents_check
    CHECK (profit_goal_cents IS NULL OR profit_goal_cents >= 0),
  CONSTRAINT plans_date_window_check
    CHECK (date_window_start IS NULL OR date_window_end IS NULL OR date_window_start <= date_window_end)
);

COMMENT ON TABLE public.plans IS
  'Agent Planner source-of-truth records for event and group-experience plans owned by community builders.';

CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON public.plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_event_type ON public.plans(event_type);

DROP TRIGGER IF EXISTS update_plans_updated_at ON public.plans;
CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.plan_messages (
  -- Unique identifier for a chat or system message in a plan.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that owns this message.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Author role for the message.
  role TEXT NOT NULL,
  -- Displayed message body.
  content TEXT NOT NULL,
  -- Structured category for rendering planner cards or timeline updates.
  message_type TEXT NOT NULL DEFAULT 'text',
  -- Structured card data, recommendation options, approval details, or parser output.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp when the message was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_messages_role_check
    CHECK (role IN ('user', 'agent', 'system')),
  CONSTRAINT plan_messages_message_type_check
    CHECK (message_type IN ('text', 'confirmation_card', 'recommendation', 'approval_request', 'status_update'))
);

COMMENT ON TABLE public.plan_messages IS
  'Conversation and card timeline for Agent Planner plans, including user prompts, agent responses, and system status.';

CREATE INDEX IF NOT EXISTS idx_plan_messages_plan_id_created_at
  ON public.plan_messages(plan_id, created_at);

CREATE TABLE IF NOT EXISTS public.plan_versions (
  -- Unique identifier for a saved plan snapshot.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that owns this version.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Monotonic version number within the plan.
  version_number INTEGER NOT NULL,
  -- Full structured plan snapshot at the time of this version.
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- User who caused the change, when known.
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Human-readable reason for the version, such as question answered or recommendation accepted.
  change_reason TEXT,
  -- Timestamp when the version was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_versions_version_number_check
    CHECK (version_number > 0),
  CONSTRAINT plan_versions_plan_version_key
    UNIQUE (plan_id, version_number)
);

COMMENT ON TABLE public.plan_versions IS
  'Immutable structured snapshots of Agent Planner plans for review, rollback, exports, and audit history.';

CREATE INDEX IF NOT EXISTS idx_plan_versions_plan_id_created_at
  ON public.plan_versions(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.recommendations (
  -- Unique identifier for a ranked recommendation.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan receiving this recommendation.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Recommendation category.
  type TEXT NOT NULL,
  -- Polymorphic reference to venues.id or vendor_profiles.id depending on type.
  reference_id UUID,
  -- Display name for external or non-platform recommendations.
  external_name TEXT,
  -- Estimated or quoted price in integer cents.
  price_cents INTEGER, -- stored as integer cents
  -- Explanation, caveats, or fit notes shown to the user.
  notes TEXT,
  -- Rank order within the recommendation set, usually 1 through 3.
  rank INTEGER NOT NULL,
  -- Whether this recommendation is currently the best fit.
  is_best_fit BOOLEAN NOT NULL DEFAULT false,
  -- Selection lifecycle for the recommendation.
  status TEXT NOT NULL DEFAULT 'pending',
  -- Scoring inputs, source records, confidence values, or external links.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp when the recommendation was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT recommendations_type_check
    CHECK (type IN ('venue', 'vendor', 'ticket', 'external')),
  CONSTRAINT recommendations_rank_check
    CHECK (rank IN (1, 2, 3)),
  CONSTRAINT recommendations_status_check
    CHECK (status IN ('pending', 'selected', 'rejected')),
  CONSTRAINT recommendations_price_cents_check
    CHECK (price_cents IS NULL OR price_cents >= 0)
);

COMMENT ON TABLE public.recommendations IS
  'Ranked venue, vendor, ticket, and external options generated by the Agent Planner recommendation system.';

CREATE INDEX IF NOT EXISTS idx_recommendations_plan_id
  ON public.recommendations(plan_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_plan_type_rank
  ON public.recommendations(plan_id, type, rank);

CREATE TABLE IF NOT EXISTS public.agent_actions (
  -- Unique identifier for an executable planner action.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that owns this action.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Action category used by execution workers and UI cards.
  action_type TEXT NOT NULL,
  -- User-facing summary of what the action will do.
  description TEXT NOT NULL,
  -- External or internal provider involved in the action.
  provider TEXT,
  -- Amount in integer cents for payment-like actions.
  amount_cents INTEGER, -- stored as integer cents
  -- ISO currency code for amount.
  currency TEXT NOT NULL DEFAULT 'usd',
  -- Execution lifecycle state.
  status TEXT NOT NULL DEFAULT 'proposed',
  -- Approval record authorizing this action, when required.
  approval_id UUID,
  -- Timestamp when the action was executed.
  executed_at TIMESTAMPTZ,
  -- Provider response, export result, payment receipt, or execution error details.
  result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp when the action was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the action was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_actions_action_type_check
    CHECK (action_type IN ('payment', 'external_link', 'concierge_queue', 'email', 'export', 'hold')),
  CONSTRAINT agent_actions_status_check
    CHECK (status IN ('proposed', 'approved', 'executing', 'complete', 'cancelled', 'failed')),
  CONSTRAINT agent_actions_amount_cents_check
    CHECK (amount_cents IS NULL OR amount_cents >= 0)
);

COMMENT ON TABLE public.agent_actions IS
  'Proposed, approved, and executed actions prepared by Agent Planner, including payments, exports, holds, links, and concierge tasks.';

CREATE INDEX IF NOT EXISTS idx_agent_actions_plan_id
  ON public.agent_actions(plan_id);
CREATE INDEX IF NOT EXISTS idx_agent_actions_status
  ON public.agent_actions(status);

DROP TRIGGER IF EXISTS update_agent_actions_updated_at ON public.agent_actions;
CREATE TRIGGER update_agent_actions_updated_at
  BEFORE UPDATE ON public.agent_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.approvals (
  -- Unique identifier for a confirmation or approval card.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that owns this approval.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Action this approval authorizes.
  agent_action_id UUID NOT NULL REFERENCES public.agent_actions(id) ON DELETE CASCADE,
  -- Short label displayed in the confirmation window.
  action_label TEXT NOT NULL,
  -- Venue, vendor, ticketing platform, or payment provider for the action.
  provider TEXT,
  -- Date of the event or purchase being approved.
  event_date DATE,
  -- Base price in integer cents shown at approval time.
  price_cents INTEGER, -- stored as integer cents
  -- Fees in integer cents shown at approval time.
  fees_cents INTEGER, -- stored as integer cents
  -- Refund terms shown to the user before approval.
  refund_terms TEXT,
  -- Cancellation terms shown to the user before approval.
  cancellation_terms TEXT,
  -- Seats, packages, menu, venue hold, or other approved item details.
  package_details TEXT,
  -- Email address where confirmation details should be delivered.
  delivery_email TEXT,
  -- Stripe PaymentMethod id or other payment method reference.
  payment_method_id TEXT,
  -- Approval lifecycle state.
  status TEXT NOT NULL DEFAULT 'pending',
  -- User who approved the action.
  approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Timestamp when the action was approved.
  approved_at TIMESTAMPTZ,
  -- Timestamp after which the approval can no longer be used.
  expires_at TIMESTAMPTZ,
  -- Hash of important approval fields for detecting price, date, or provider changes.
  snapshot_hash TEXT,
  -- Timestamp when the approval was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the approval was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT approvals_price_cents_check
    CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT approvals_fees_cents_check
    CHECK (fees_cents IS NULL OR fees_cents >= 0),
  CONSTRAINT approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 're_approval_required'))
);

COMMENT ON TABLE public.approvals IS
  'User confirmation records that freeze the exact purchase, booking, payment, or export details approved for Agent Planner execution.';

CREATE INDEX IF NOT EXISTS idx_approvals_plan_id
  ON public.approvals(plan_id);
CREATE INDEX IF NOT EXISTS idx_approvals_action_id
  ON public.approvals(agent_action_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status
  ON public.approvals(status);

ALTER TABLE public.agent_actions
  DROP CONSTRAINT IF EXISTS agent_actions_approval_id_fkey;
ALTER TABLE public.agent_actions
  ADD CONSTRAINT agent_actions_approval_id_fkey
  FOREIGN KEY (approval_id) REFERENCES public.approvals(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS update_approvals_updated_at ON public.approvals;
CREATE TRIGGER update_approvals_updated_at
  BEFORE UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.agent_authorizations (
  -- Unique identifier for an agent spending authorization.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- User granting this authorization.
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Optional plan that scopes this authorization.
  plan_id UUID REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Maximum cent amount the agent can auto-approve for one action.
  auto_approve_under_cents INTEGER, -- stored as integer cents
  -- Monthly cent cap for agent-initiated spend.
  monthly_spend_cap_cents INTEGER, -- stored as integer cents
  -- Vendors that are explicitly approved for agent spending.
  approved_vendor_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  -- Emergency stop that blocks agent spending even when caps would allow it.
  pause_agent_spending BOOLEAN NOT NULL DEFAULT false,
  -- Timestamp when the authorization was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the authorization was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_authorizations_auto_approve_under_cents_check
    CHECK (auto_approve_under_cents IS NULL OR auto_approve_under_cents >= 0),
  CONSTRAINT agent_authorizations_monthly_spend_cap_cents_check
    CHECK (monthly_spend_cap_cents IS NULL OR monthly_spend_cap_cents >= 0)
);

COMMENT ON TABLE public.agent_authorizations IS
  'User-defined guardrails for Agent Planner spending, including caps, approved vendors, and pause controls.';

CREATE INDEX IF NOT EXISTS idx_agent_authorizations_user_id
  ON public.agent_authorizations(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_authorizations_plan_id
  ON public.agent_authorizations(plan_id);

DROP TRIGGER IF EXISTS update_agent_authorizations_updated_at ON public.agent_authorizations;
CREATE TRIGGER update_agent_authorizations_updated_at
  BEFORE UPDATE ON public.agent_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.templates (
  -- Unique identifier for a reusable event template.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- User who owns the template.
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Original plan this template was created from, when applicable.
  source_plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  -- Template name displayed in the rebook flow.
  name TEXT NOT NULL,
  -- Event category this template supports.
  event_type TEXT,
  -- Intended audience or attendee profile.
  target_audience TEXT,
  -- Minimum suggested guest count.
  guest_count_min INTEGER,
  -- Maximum suggested guest count.
  guest_count_max INTEGER,
  -- Reusable budget structure, line items, and cost assumptions.
  budget_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Suggested ticket pricing tiers and sales assumptions.
  ticket_price_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Profit forecast assumptions from the source or template model.
  profit_assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Per-head, revenue-share, or hybrid kickback assumptions.
  kickback_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Reusable event timeline and run-of-show.
  run_of_show JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Reusable venue, vendor, staffing, ticketing, and supplies checklist.
  shopping_list JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Reusable outbound email copy for venues, vendors, sponsors, or attendees.
  email_copy TEXT,
  -- Reusable export copy for final plan documents or itineraries.
  export_copy TEXT,
  -- Required approvals before the template can be rebooked.
  approval_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Actual performance from prior runs, such as attendance, revenue, and margin.
  historical_performance JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp when the template was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the template was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT templates_guest_count_min_check
    CHECK (guest_count_min IS NULL OR guest_count_min >= 0),
  CONSTRAINT templates_guest_count_max_check
    CHECK (guest_count_max IS NULL OR guest_count_max >= 0),
  CONSTRAINT templates_guest_count_range_check
    CHECK (guest_count_min IS NULL OR guest_count_max IS NULL OR guest_count_min <= guest_count_max)
);

COMMENT ON TABLE public.templates IS
  'Reusable event plan templates that support one-click rebook preparation from successful Agent Planner plans.';

CREATE INDEX IF NOT EXISTS idx_templates_user_id
  ON public.templates(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_source_plan_id
  ON public.templates(source_plan_id);

DROP TRIGGER IF EXISTS update_templates_updated_at ON public.templates;
CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.template_runs (
  -- Unique identifier for a rebook attempt from a template.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Template used to create the run.
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  -- Plan created or updated from this template run.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- New target date for the rebooked event.
  new_date DATE,
  -- Expected attendance for this run.
  expected_guest_count INTEGER,
  -- Budget override in integer cents for this run.
  budget_override_cents INTEGER, -- stored as integer cents
  -- Whether the rebook should try to use the same venue.
  use_same_venue BOOLEAN NOT NULL DEFAULT true,
  -- Whether the rebook should try to use the same vendors.
  use_same_vendors BOOLEAN NOT NULL DEFAULT true,
  -- Rebook lifecycle state.
  status TEXT NOT NULL DEFAULT 'pending',
  -- Timestamp when the template run was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT template_runs_expected_guest_count_check
    CHECK (expected_guest_count IS NULL OR expected_guest_count >= 0),
  CONSTRAINT template_runs_budget_override_cents_check
    CHECK (budget_override_cents IS NULL OR budget_override_cents >= 0),
  CONSTRAINT template_runs_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled'))
);

COMMENT ON TABLE public.template_runs IS
  'Instances of templates being rebooked into new plans with updated date, guest count, and budget assumptions.';

CREATE INDEX IF NOT EXISTS idx_template_runs_template_id
  ON public.template_runs(template_id);
CREATE INDEX IF NOT EXISTS idx_template_runs_plan_id
  ON public.template_runs(plan_id);

CREATE TABLE IF NOT EXISTS public.exports (
  -- Unique identifier for an exported planner artifact.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that owns this export.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- Export format or delivery channel.
  export_type TEXT NOT NULL,
  -- Storage URL for file-based exports.
  file_url TEXT,
  -- Email address that received the export, when sent by email.
  sent_to_email TEXT,
  -- Timestamp when the export was created or sent.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exports_export_type_check
    CHECK (export_type IN ('pdf', 'ics', 'email', 'csv'))
);

COMMENT ON TABLE public.exports IS
  'Planner export records for PDFs, calendar files, emails, and CSVs generated from structured Agent Planner plans.';

CREATE INDEX IF NOT EXISTS idx_exports_plan_id
  ON public.exports(plan_id);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  -- Unique identifier for an audit log entry.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- User associated with the audited action.
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Optional plan associated with the audited action.
  plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL,
  -- Human-readable action name such as approval.created or action.executed.
  action TEXT NOT NULL,
  -- Entity type affected by the action.
  entity_type TEXT NOT NULL,
  -- Entity id affected by the action.
  entity_id UUID,
  -- JSON snapshot before the action.
  before_state JSONB,
  -- JSON snapshot after the action.
  after_state JSONB,
  -- Request IP address when available.
  ip_address INET,
  -- Timestamp when the audit entry was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS
  'Immutable operational audit history for Agent Planner plans, approvals, payments, exports, and administrative execution.';

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id_created_at
  ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_plan_id_created_at
  ON public.audit_logs(plan_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_tasks (
  -- Unique identifier for an internal operations task.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Plan that requires administrative or concierge work.
  plan_id UUID NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  -- User assigned to complete the task.
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Operational category for the task.
  task_type TEXT NOT NULL,
  -- User-facing or operator-facing description of the task.
  description TEXT NOT NULL,
  -- Task lifecycle state.
  status TEXT NOT NULL DEFAULT 'open',
  -- Optional due date for the task.
  due_at TIMESTAMPTZ,
  -- Timestamp when the task was completed.
  completed_at TIMESTAMPTZ,
  -- Internal task notes or completion details.
  notes TEXT,
  -- Timestamp when the task was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Timestamp when the task was last updated.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_tasks_task_type_check
    CHECK (task_type IN ('concierge_booking', 'receipt_upload', 'vendor_confirm', 'coi_collect')),
  CONSTRAINT admin_tasks_status_check
    CHECK (status IN ('open', 'in_progress', 'complete', 'cancelled'))
);

COMMENT ON TABLE public.admin_tasks IS
  'Internal concierge and operations queue for planner actions that cannot be completed through controlled APIs.';

CREATE INDEX IF NOT EXISTS idx_admin_tasks_plan_id
  ON public.admin_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_admin_tasks_status_due_at
  ON public.admin_tasks(status, due_at);

DROP TRIGGER IF EXISTS update_admin_tasks_updated_at ON public.admin_tasks;
CREATE TRIGGER update_admin_tasks_updated_at
  BEFORE UPDATE ON public.admin_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.historical_event_signals (
  -- Unique identifier for a historical comp signal.
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = platform-wide benchmark data (Eventbrite/Luma/Posh imports).
  -- Non-null = user-imported private signals.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- global = platform benchmark, user = builder-imported private data.
  signal_scope TEXT NOT NULL DEFAULT 'global',
  -- Source platform or manual entry source.
  source TEXT NOT NULL,
  -- External source id, when present.
  external_id TEXT,
  -- Event category used for matching comparable events.
  event_type TEXT,
  -- Neighborhood or local area for the historical event.
  neighborhood TEXT,
  -- Actual or reported guest count.
  guest_count INTEGER,
  -- Average or listed ticket price in integer cents.
  ticket_price_cents INTEGER, -- stored as integer cents
  -- RSVP conversion rate used for planning assumptions.
  rsvp_rate NUMERIC(6,4),
  -- Show-up rate used for attendance assumptions.
  show_rate NUMERIC(6,4),
  -- Gross revenue in integer cents from the historical event.
  revenue_cents INTEGER, -- stored as integer cents
  -- Date of the historical event.
  event_date DATE,
  -- Original imported payload or manual source details.
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Timestamp when the historical signal was created.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT historical_event_signals_signal_scope_check
    CHECK (signal_scope IN ('global', 'user')),
  CONSTRAINT historical_event_signals_source_check
    CHECK (source IN ('eventbrite', 'luma', 'posh', 'manual')),
  CONSTRAINT historical_event_signals_guest_count_check
    CHECK (guest_count IS NULL OR guest_count >= 0),
  CONSTRAINT historical_event_signals_ticket_price_cents_check
    CHECK (ticket_price_cents IS NULL OR ticket_price_cents >= 0),
  CONSTRAINT historical_event_signals_rsvp_rate_check
    CHECK (rsvp_rate IS NULL OR (rsvp_rate >= 0 AND rsvp_rate <= 1)),
  CONSTRAINT historical_event_signals_show_rate_check
    CHECK (show_rate IS NULL OR (show_rate >= 0 AND show_rate <= 1)),
  CONSTRAINT historical_event_signals_revenue_cents_check
    CHECK (revenue_cents IS NULL OR revenue_cents >= 0)
);

COMMENT ON TABLE public.historical_event_signals IS
  'Imported or manually entered historical event performance signals used for Agent Planner foot traffic and profit assumptions.';

CREATE INDEX IF NOT EXISTS idx_historical_event_signals_user_id
  ON public.historical_event_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_historical_event_signals_source_external_id
  ON public.historical_event_signals(source, external_id);
CREATE INDEX IF NOT EXISTS idx_historical_event_signals_match
  ON public.historical_event_signals(user_id, event_type, neighborhood, event_date);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_event_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own plans" ON public.plans;
CREATE POLICY "Users can view own plans"
  ON public.plans FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own plans" ON public.plans;
CREATE POLICY "Users can create own plans"
  ON public.plans FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own plans" ON public.plans;
CREATE POLICY "Users can update own plans"
  ON public.plans FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own plans" ON public.plans;
CREATE POLICY "Users can delete own plans"
  ON public.plans FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own plan messages" ON public.plan_messages;
CREATE POLICY "Users can view own plan messages"
  ON public.plan_messages FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own plan messages" ON public.plan_messages;
CREATE POLICY "Users can create own plan messages"
  ON public.plan_messages FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own plan messages" ON public.plan_messages;
CREATE POLICY "Users can update own plan messages"
  ON public.plan_messages FOR UPDATE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own plan messages" ON public.plan_messages;
CREATE POLICY "Users can delete own plan messages"
  ON public.plan_messages FOR DELETE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own plan versions" ON public.plan_versions;
CREATE POLICY "Users can view own plan versions"
  ON public.plan_versions FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own plan versions" ON public.plan_versions;
CREATE POLICY "Users can create own plan versions"
  ON public.plan_versions FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own recommendations" ON public.recommendations;
CREATE POLICY "Users can view own recommendations"
  ON public.recommendations FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own recommendations" ON public.recommendations;
CREATE POLICY "Users can create own recommendations"
  ON public.recommendations FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own recommendations" ON public.recommendations;
CREATE POLICY "Users can update own recommendations"
  ON public.recommendations FOR UPDATE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete own recommendations" ON public.recommendations;
CREATE POLICY "Users can delete own recommendations"
  ON public.recommendations FOR DELETE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own agent actions" ON public.agent_actions;
CREATE POLICY "Users can view own agent actions"
  ON public.agent_actions FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own agent actions" ON public.agent_actions;
CREATE POLICY "Users can create own agent actions"
  ON public.agent_actions FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own agent actions" ON public.agent_actions;
CREATE POLICY "Users can update own agent actions"
  ON public.agent_actions FOR UPDATE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own approvals" ON public.approvals;
CREATE POLICY "Users can view own approvals"
  ON public.approvals FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own approvals" ON public.approvals;
CREATE POLICY "Users can create own approvals"
  ON public.approvals FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own approvals" ON public.approvals;
CREATE POLICY "Users can update own approvals"
  ON public.approvals FOR UPDATE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own agent authorizations" ON public.agent_authorizations;
CREATE POLICY "Users can view own agent authorizations"
  ON public.agent_authorizations FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own agent authorizations" ON public.agent_authorizations;
CREATE POLICY "Users can create own agent authorizations"
  ON public.agent_authorizations FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own agent authorizations" ON public.agent_authorizations;
CREATE POLICY "Users can update own agent authorizations"
  ON public.agent_authorizations FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own agent authorizations" ON public.agent_authorizations;
CREATE POLICY "Users can delete own agent authorizations"
  ON public.agent_authorizations FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own templates" ON public.templates;
CREATE POLICY "Users can view own templates"
  ON public.templates FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own templates" ON public.templates;
CREATE POLICY "Users can create own templates"
  ON public.templates FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own templates" ON public.templates;
CREATE POLICY "Users can update own templates"
  ON public.templates FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own templates" ON public.templates;
CREATE POLICY "Users can delete own templates"
  ON public.templates FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own template runs" ON public.template_runs;
CREATE POLICY "Users can view own template runs"
  ON public.template_runs FOR SELECT
  USING (
    template_id IN (SELECT id FROM public.templates WHERE user_id = auth.uid())
    AND plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own template runs" ON public.template_runs;
CREATE POLICY "Users can create own template runs"
  ON public.template_runs FOR INSERT
  WITH CHECK (
    template_id IN (SELECT id FROM public.templates WHERE user_id = auth.uid())
    AND plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own template runs" ON public.template_runs;
CREATE POLICY "Users can update own template runs"
  ON public.template_runs FOR UPDATE
  USING (
    template_id IN (SELECT id FROM public.templates WHERE user_id = auth.uid())
    AND plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  )
  WITH CHECK (
    template_id IN (SELECT id FROM public.templates WHERE user_id = auth.uid())
    AND plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can view own exports" ON public.exports;
CREATE POLICY "Users can view own exports"
  ON public.exports FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own exports" ON public.exports;
CREATE POLICY "Users can create own exports"
  ON public.exports FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view own audit logs"
  ON public.audit_logs FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own audit logs" ON public.audit_logs;
CREATE POLICY "Users can create own audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own admin tasks" ON public.admin_tasks;
CREATE POLICY "Users can view own admin tasks"
  ON public.admin_tasks FOR SELECT
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can create own admin tasks" ON public.admin_tasks;
CREATE POLICY "Users can create own admin tasks"
  ON public.admin_tasks FOR INSERT
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update own admin tasks" ON public.admin_tasks;
CREATE POLICY "Users can update own admin tasks"
  ON public.admin_tasks FOR UPDATE
  USING (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()))
  WITH CHECK (plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can create own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can update own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Users can delete own historical event signals" ON public.historical_event_signals;
DROP POLICY IF EXISTS "Authenticated users can read global signals" ON public.historical_event_signals;
CREATE POLICY "Authenticated users can read global signals"
  ON public.historical_event_signals FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND user_id IS NULL
  );

DROP POLICY IF EXISTS "Users can manage own signals" ON public.historical_event_signals;
CREATE POLICY "Users can manage own signals"
  ON public.historical_event_signals FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can insert global signals" ON public.historical_event_signals;
CREATE POLICY "Service role can insert global signals"
  ON public.historical_event_signals FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;

GRANT ALL ON TABLE public.plan_messages TO anon;
GRANT ALL ON TABLE public.plan_messages TO authenticated;
GRANT ALL ON TABLE public.plan_messages TO service_role;

GRANT ALL ON TABLE public.plan_versions TO anon;
GRANT ALL ON TABLE public.plan_versions TO authenticated;
GRANT ALL ON TABLE public.plan_versions TO service_role;

GRANT ALL ON TABLE public.recommendations TO anon;
GRANT ALL ON TABLE public.recommendations TO authenticated;
GRANT ALL ON TABLE public.recommendations TO service_role;

GRANT ALL ON TABLE public.agent_actions TO anon;
GRANT ALL ON TABLE public.agent_actions TO authenticated;
GRANT ALL ON TABLE public.agent_actions TO service_role;

GRANT ALL ON TABLE public.approvals TO anon;
GRANT ALL ON TABLE public.approvals TO authenticated;
GRANT ALL ON TABLE public.approvals TO service_role;

GRANT ALL ON TABLE public.agent_authorizations TO anon;
GRANT ALL ON TABLE public.agent_authorizations TO authenticated;
GRANT ALL ON TABLE public.agent_authorizations TO service_role;

GRANT ALL ON TABLE public.templates TO anon;
GRANT ALL ON TABLE public.templates TO authenticated;
GRANT ALL ON TABLE public.templates TO service_role;

GRANT ALL ON TABLE public.template_runs TO anon;
GRANT ALL ON TABLE public.template_runs TO authenticated;
GRANT ALL ON TABLE public.template_runs TO service_role;

GRANT ALL ON TABLE public.exports TO anon;
GRANT ALL ON TABLE public.exports TO authenticated;
GRANT ALL ON TABLE public.exports TO service_role;

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

GRANT ALL ON TABLE public.admin_tasks TO anon;
GRANT ALL ON TABLE public.admin_tasks TO authenticated;
GRANT ALL ON TABLE public.admin_tasks TO service_role;

GRANT ALL ON TABLE public.historical_event_signals TO anon;
GRANT ALL ON TABLE public.historical_event_signals TO authenticated;
GRANT ALL ON TABLE public.historical_event_signals TO service_role;
