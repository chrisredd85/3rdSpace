-- Prompt 8: make Concierge/Admin Queue execution durable and host-visible.
--
-- Approved actions are linked to exactly one internal task. Queue, completion,
-- and cancellation commands are service-only and idempotent so retries cannot
-- create duplicate operator work or duplicate host messages.

ALTER TABLE public.admin_tasks
  ADD COLUMN IF NOT EXISTS agent_action_id UUID,
  ADD COLUMN IF NOT EXISTS approval_id UUID,
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS outcome_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.admin_tasks
  ADD CONSTRAINT admin_tasks_action_plan_consistency_fkey
    FOREIGN KEY (agent_action_id, plan_id)
    REFERENCES public.agent_actions(id, plan_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT admin_tasks_approval_id_fkey
    FOREIGN KEY (approval_id)
    REFERENCES public.approvals(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT admin_tasks_event_id_fkey
    FOREIGN KEY (event_id)
    REFERENCES public.events(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT admin_tasks_outcome_payload_object_check
    CHECK (jsonb_typeof(outcome_payload) = 'object');

CREATE UNIQUE INDEX admin_tasks_agent_action_unique
  ON public.admin_tasks(agent_action_id)
  WHERE agent_action_id IS NOT NULL;

CREATE INDEX admin_tasks_approval_lookup
  ON public.admin_tasks(approval_id)
  WHERE approval_id IS NOT NULL;

CREATE INDEX admin_tasks_event_lookup
  ON public.admin_tasks(event_id)
  WHERE event_id IS NOT NULL;

COMMENT ON COLUMN public.admin_tasks.agent_action_id IS
  'Approved planner action whose Concierge/Admin Queue handoff created this task. Unique when present for retry idempotency.';
COMMENT ON COLUMN public.admin_tasks.approval_id IS
  'Exact approval snapshot that authorized creation of this task.';
COMMENT ON COLUMN public.admin_tasks.event_id IS
  'Canonical event linked to the plan when the task was queued, if materialized.';
COMMENT ON COLUMN public.admin_tasks.outcome_payload IS
  'Structured operator outcome. Internal free-form notes remain in notes and are never copied to host messages.';

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS latest_venue_hold_outcome JSONB;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS latest_venue_hold_outcome JSONB;

ALTER TABLE public.plans
  ADD CONSTRAINT plans_latest_venue_hold_outcome_object_check
    CHECK (
      latest_venue_hold_outcome IS NULL
      OR jsonb_typeof(latest_venue_hold_outcome) = 'object'
    );

ALTER TABLE public.events
  ADD CONSTRAINT events_latest_venue_hold_outcome_object_check
    CHECK (
      latest_venue_hold_outcome IS NULL
      OR jsonb_typeof(latest_venue_hold_outcome) = 'object'
    );

COMMENT ON COLUMN public.plans.latest_venue_hold_outcome IS
  'Latest service-recorded venue-hold result for the plan. This is execution evidence, not booking or payment authority.';
COMMENT ON COLUMN public.events.latest_venue_hold_outcome IS
  'Latest service-recorded venue-hold result projected onto the canonical event. A soft hold does not set venue_confirmed.';

CREATE OR REPLACE FUNCTION public.protect_venue_hold_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_expected_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.latest_venue_hold_outcome IS NOT NULL THEN
      RAISE EXCEPTION 'venue_hold_outcome_requires_dedicated_command'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.latest_venue_hold_outcome IS NOT DISTINCT FROM OLD.latest_venue_hold_outcome THEN
    RETURN NEW;
  END IF;

  v_expected_id := CASE TG_TABLE_NAME
    WHEN 'plans' THEN current_setting('app.concierge_hold_plan_id', true)
    WHEN 'events' THEN current_setting('app.concierge_hold_event_id', true)
    ELSE NULL
  END;

  IF current_user NOT IN ('postgres', 'service_role')
    OR COALESCE(v_expected_id, '') <> NEW.id::TEXT
  THEN
    RAISE EXCEPTION 'venue_hold_outcome_requires_dedicated_command'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_venue_hold_outcome()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_venue_hold_outcome()
  TO service_role;

DROP TRIGGER IF EXISTS protect_plan_venue_hold_outcome_trigger ON public.plans;
CREATE TRIGGER protect_plan_venue_hold_outcome_trigger
  BEFORE INSERT OR UPDATE OF latest_venue_hold_outcome ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_venue_hold_outcome();

DROP TRIGGER IF EXISTS protect_event_venue_hold_outcome_trigger ON public.events;
CREATE TRIGGER protect_event_venue_hold_outcome_trigger
  BEFORE INSERT OR UPDATE OF latest_venue_hold_outcome ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_venue_hold_outcome();

CREATE OR REPLACE FUNCTION public.enforce_admin_task_execution_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.agent_action_id IS NULL THEN
    IF NEW.approval_id IS NOT NULL OR NEW.event_id IS NOT NULL THEN
      RAISE EXCEPTION 'admin_task_execution_link_requires_action'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.approval_id IS NULL THEN
    RAISE EXCEPTION 'admin_task_execution_link_requires_approval'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_actions AS action_row
    JOIN public.approvals AS approval_row
      ON approval_row.id = NEW.approval_id
     AND approval_row.agent_action_id = action_row.id
     AND approval_row.plan_id = action_row.plan_id
    WHERE action_row.id = NEW.agent_action_id
      AND action_row.plan_id = NEW.plan_id
      AND action_row.approval_id = approval_row.id
  ) THEN
    RAISE EXCEPTION 'admin_task_action_approval_plan_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.plans AS plan_row
    JOIN public.events AS event_row
      ON event_row.id = NEW.event_id
     AND event_row.plan_id = plan_row.id
    WHERE plan_row.id = NEW.plan_id
      AND plan_row.materialized_event_id = event_row.id
  ) THEN
    RAISE EXCEPTION 'admin_task_canonical_event_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_admin_task_execution_identity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_admin_task_execution_identity()
  TO service_role;

DROP TRIGGER IF EXISTS enforce_admin_task_execution_identity_trigger
  ON public.admin_tasks;
CREATE TRIGGER enforce_admin_task_execution_identity_trigger
  BEFORE INSERT OR UPDATE OF plan_id, agent_action_id, approval_id, event_id
  ON public.admin_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_admin_task_execution_identity();

CREATE OR REPLACE FUNCTION public.enqueue_approved_admin_task(
  p_plan_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_task_type TEXT,
  p_description TEXT,
  p_priority TEXT DEFAULT 'normal',
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_due_at TIMESTAMPTZ DEFAULT NULL,
  p_host_message TEXT DEFAULT NULL
)
RETURNS public.admin_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_task public.admin_tasks%ROWTYPE;
  v_inserted BOOLEAN := false;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_host_message TEXT;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'enqueue_approved_admin_task_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL
    OR NULLIF(btrim(p_task_type), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'enqueue_approved_admin_task_invalid_input'
      USING ERRCODE = '22023';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND OR v_plan.user_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'enqueue_approved_admin_task_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_action_id
    AND action_row.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enqueue_approved_admin_task_action_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.approval_id IS DISTINCT FROM v_approval.id
    OR v_approval.status NOT IN ('authorized', 'approved')
    OR COALESCE(v_approval.authorized_by, v_approval.approved_by) IS DISTINCT FROM p_actor_id
    OR (v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= transaction_timestamp())
  THEN
    RAISE EXCEPTION 'enqueue_approved_admin_task_approval_not_executable'
      USING ERRCODE = '23514';
  END IF;

  SELECT task_row.*
  INTO v_task
  FROM public.admin_tasks AS task_row
  WHERE task_row.agent_action_id = p_action_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_task.plan_id IS DISTINCT FROM p_plan_id
      OR v_task.approval_id IS DISTINCT FROM p_approval_id
    THEN
      RAISE EXCEPTION 'enqueue_approved_admin_task_idempotency_conflict'
        USING ERRCODE = '23514';
    END IF;

    IF v_task.status IN ('complete', 'cancelled') THEN
      RETURN v_task;
    END IF;
  ELSE
    INSERT INTO public.admin_tasks (
      plan_id,
      agent_action_id,
      approval_id,
      event_id,
      task_type,
      description,
      status,
      priority,
      metadata,
      due_at,
      notes
    ) VALUES (
      p_plan_id,
      p_action_id,
      p_approval_id,
      v_plan.materialized_event_id,
      p_task_type,
      btrim(p_description),
      'open',
      COALESCE(NULLIF(btrim(p_priority), ''), 'normal'),
      COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'execution_action_type', v_action.action_type,
          'queued_at', v_now,
          'outbound_message_sent', false
        ),
      p_due_at,
      NULL
    )
    ON CONFLICT (agent_action_id) WHERE agent_action_id IS NOT NULL
    DO NOTHING
    RETURNING * INTO v_task;

    IF NOT FOUND THEN
      SELECT task_row.*
      INTO v_task
      FROM public.admin_tasks AS task_row
      WHERE task_row.agent_action_id = p_action_id
      FOR UPDATE;
    ELSE
      v_inserted := true;
    END IF;
  END IF;

  IF v_action.status = 'approved' THEN
    UPDATE public.agent_actions AS action_row
    SET status = 'executing',
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'execution_mode', 'concierge_admin_queue',
            'handoff_status', 'queued',
            'admin_task_id', v_task.id,
            'outbound_message_sent', false
          )
    WHERE action_row.id = v_action.id
    RETURNING * INTO v_action;

    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_action.id, p_plan_id, 'approved', 'executing', p_actor_id, 'user',
      'concierge.task_queued',
      jsonb_build_object('task_id', v_task.id, 'approval_id', p_approval_id)
    );
  ELSIF v_action.status = 'executing' THEN
    UPDATE public.agent_actions AS action_row
    SET result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'execution_mode', 'concierge_admin_queue',
        'handoff_status', 'queued',
        'admin_task_id', v_task.id,
        'outbound_message_sent', false
      )
    WHERE action_row.id = v_action.id;
  ELSIF v_action.status <> 'executing' THEN
    IF v_action.status = 'complete' AND v_task.status = 'complete' THEN
      RETURN v_task;
    END IF;
    IF v_action.status = 'cancelled' AND v_task.status = 'cancelled' THEN
      RETURN v_task;
    END IF;
    RAISE EXCEPTION 'enqueue_approved_admin_task_action_not_queueable'
      USING ERRCODE = '23514';
  END IF;

  IF v_inserted THEN
    v_host_message := COALESCE(
      NULLIF(btrim(p_host_message), ''),
      '3rdPlace queued this approved request for operator follow-up. Nothing has been sent, booked, or paid.'
    );

    INSERT INTO public.plan_messages (
      plan_id, role, content, message_type, metadata
    ) VALUES (
      p_plan_id,
      'agent',
      left(v_host_message, 1000),
      'status_update',
      jsonb_build_object(
        'state', 'concierge_task_queued',
        'status', 'executing',
        'agent_action_id', p_action_id,
        'approval_id', p_approval_id,
        'event_id', v_task.event_id,
        'outbound_message_sent', false
      )
    );
  END IF;

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_approved_admin_task(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_approved_admin_task(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_approved_vendor_contact_draft(
  p_plan_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_approval public.approvals%ROWTYPE;
  v_vendor public.vendor_profiles%ROWTYPE;
  v_thread public.outreach_threads%ROWTYPE;
  v_message public.outreach_messages%ROWTYPE;
  v_subject TEXT;
  v_body TEXT;
  v_inserted BOOLEAN := false;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'prepare_vendor_contact_draft_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = p_plan_id
    AND plan_row.user_id = p_actor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepare_vendor_contact_draft_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT action_row.*
  INTO v_action
  FROM public.agent_actions AS action_row
  WHERE action_row.id = p_action_id
    AND action_row.plan_id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.action_type <> 'vendor_contact'
    OR v_action.target_id IS NULL
    OR COALESCE(v_action.payload_json ->> 'kind', '') = 'vendor_reply_capture'
  THEN
    RAISE EXCEPTION 'prepare_vendor_contact_draft_action_invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.approvals AS approval_row
  WHERE approval_row.id = p_approval_id
    AND approval_row.plan_id = p_plan_id
    AND approval_row.agent_action_id = p_action_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_action.approval_id IS DISTINCT FROM v_approval.id
    OR v_approval.status NOT IN ('authorized', 'approved')
    OR COALESCE(v_approval.authorized_by, v_approval.approved_by) IS DISTINCT FROM p_actor_id
    OR v_action.status NOT IN ('approved', 'executing', 'complete')
  THEN
    RAISE EXCEPTION 'prepare_vendor_contact_draft_approval_not_executable'
      USING ERRCODE = '23514';
  END IF;

  SELECT vendor_row.*
  INTO v_vendor
  FROM public.vendor_profiles AS vendor_row
  WHERE vendor_row.id = v_action.target_id
  FOR SHARE;

  IF NOT FOUND
    OR NULLIF(btrim(v_vendor.contact_email), '') IS NULL
    OR position('@' in v_vendor.contact_email) <= 1
  THEN
    RAISE EXCEPTION 'vendor_contact_email_missing'
      USING ERRCODE = '23514';
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.outreach_messages AS message_row
  WHERE message_row.agent_action_id = p_action_id
    AND message_row.direction = 'outbound'
    AND message_row.provider_metadata_json ->> 'draft_kind' = 'vendor_contact'
  ORDER BY message_row.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT thread_row.*
    INTO v_thread
    FROM public.outreach_threads AS thread_row
    WHERE thread_row.id = v_message.thread_id;

    RETURN jsonb_build_object(
      'disposition', 'complete',
      'outreach_thread_id', v_thread.id,
      'outreach_message_id', v_message.id,
      'outbound_message_sent', false,
      'idempotent_replay', true
    );
  END IF;

  SELECT thread_row.*
  INTO v_thread
  FROM public.outreach_threads AS thread_row
  WHERE thread_row.plan_id = p_plan_id
    AND thread_row.target_type = 'vendor'
    AND thread_row.target_id = v_vendor.id
    AND thread_row.channel = 'email'
    AND thread_row.state <> 'cancelled'
  ORDER BY thread_row.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.outreach_threads (
      plan_id,
      user_id,
      target_type,
      target_id,
      target_name,
      target_email,
      channel,
      state,
      source_agent_action_id,
      target_source,
      discovery_vendor_id,
      channel_strategy,
      needs_attention,
      last_event_at
    ) VALUES (
      p_plan_id,
      p_actor_id,
      'vendor',
      v_vendor.id,
      v_vendor.name,
      lower(btrim(v_vendor.contact_email)),
      'email',
      'draft',
      p_action_id,
      CASE WHEN v_vendor.discovery_vendor_id IS NULL THEN 'onboarded' ELSE 'discovery' END,
      v_vendor.discovery_vendor_id,
      jsonb_build_object(
        'source', 'approved_vendor_contact',
        'approval_required_for_send', true
      ),
      false,
      v_now
    )
    RETURNING * INTO v_thread;
  END IF;

  v_subject := left(v_plan.title || ' availability and quote request', 500);
  v_body := concat_ws(
    E'\n\n',
    'Hi ' || v_vendor.name || ' team,',
    'I am planning ' || v_plan.title ||
      CASE
        WHEN v_plan.date_window_start IS NOT NULL
          THEN ' for ' || v_plan.date_window_start::TEXT
        ELSE ''
      END ||
      CASE
        WHEN v_plan.guest_count IS NOT NULL
          THEN ' for ' || v_plan.guest_count::TEXT || ' guests'
        ELSE ''
      END || '.',
    'Could you confirm availability, pricing, package details, deposit terms, and setup requirements?',
    'Thank you.'
  );

  INSERT INTO public.outreach_messages (
    thread_id,
    agent_action_id,
    approval_id,
    direction,
    subject,
    body_text,
    headers_json,
    provider_metadata_json,
    attachments_json,
    sent_manually,
    delivery_status
  ) VALUES (
    v_thread.id,
    p_action_id,
    p_approval_id,
    'outbound',
    v_subject,
    v_body,
    jsonb_build_object('to', lower(btrim(v_vendor.contact_email))),
    jsonb_build_object(
      'draft_kind', 'vendor_contact',
      'approval_required_for_send', true,
      'outbound_message_sent', false
    ),
    '[]'::jsonb,
    false,
    NULL
  )
  RETURNING * INTO v_message;

  v_inserted := true;

  UPDATE public.agent_actions AS action_row
  SET result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'execution_mode', 'concierge_admin_queue',
      'handoff_status', 'draft_ready',
      'outreach_thread_id', v_thread.id,
      'outreach_message_id', v_message.id,
      'outbound_message_sent', false,
      'send_requires_separate_approval', true
    )
  WHERE action_row.id = p_action_id;

  IF v_inserted THEN
    INSERT INTO public.plan_messages (
      plan_id, role, content, message_type, metadata
    ) VALUES (
      p_plan_id,
      'agent',
      'A vendor outreach draft for ' || v_vendor.name || ' is ready for review. Nothing has been sent.',
      'status_update',
      jsonb_build_object(
        'state', 'vendor_contact_draft_ready',
        'status', 'draft_ready',
        'agent_action_id', p_action_id,
        'approval_id', p_approval_id,
        'outreach_thread_id', v_thread.id,
        'outbound_message_sent', false,
        'send_requires_separate_approval', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'disposition', 'complete',
    'outreach_thread_id', v_thread.id,
    'outreach_message_id', v_message.id,
    'outbound_message_sent', false,
    'send_requires_separate_approval', true,
    'idempotent_replay', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_approved_vendor_contact_draft(
  UUID, UUID, UUID, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_approved_vendor_contact_draft(
  UUID, UUID, UUID, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_admin_task_execution(
  p_task_id UUID,
  p_admin_user_id UUID,
  p_outcome_payload JSONB DEFAULT '{"outcome":"completed"}'::jsonb,
  p_host_message TEXT DEFAULT NULL,
  p_internal_note TEXT DEFAULT NULL
)
RETURNS public.admin_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_task_ref public.admin_tasks%ROWTYPE;
  v_task public.admin_tasks%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_outcome JSONB := COALESCE(p_outcome_payload, '{"outcome":"completed"}'::jsonb);
  v_public_outcome JSONB;
  v_hold_outcome JSONB;
  v_host_message TEXT;
  v_previous_action_status TEXT;
  v_before_task JSONB;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'complete_admin_task_execution_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_user_id IS NULL
    OR jsonb_typeof(v_outcome) IS DISTINCT FROM 'object'
    OR NULLIF(btrim(v_outcome ->> 'outcome'), '') IS NULL
  THEN
    RAISE EXCEPTION 'complete_admin_task_execution_invalid_input'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve identity without a row lock, then acquire the same lifecycle lock
  -- order used by enqueue/retry: plan -> action -> approval -> task. The task
  -- is revalidated after it is locked so a concurrent identity change fails
  -- closed instead of being applied to a different aggregate.
  SELECT task_row.*
  INTO v_task_ref
  FROM public.admin_tasks AS task_row
  WHERE task_row.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_admin_task_execution_task_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM plan_row.id
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_task_ref.plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_admin_task_execution_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_task_ref.agent_action_id IS NOT NULL THEN
    SELECT action_row.*
    INTO v_action
    FROM public.agent_actions AS action_row
    WHERE action_row.id = v_task_ref.agent_action_id
      AND action_row.plan_id = v_task_ref.plan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'complete_admin_task_execution_action_not_completable'
        USING ERRCODE = '23514';
    END IF;

    PERFORM approval_row.id
    FROM public.approvals AS approval_row
    WHERE approval_row.id = v_task_ref.approval_id
      AND approval_row.plan_id = v_task_ref.plan_id
      AND approval_row.agent_action_id = v_task_ref.agent_action_id
      AND v_action.approval_id = approval_row.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'complete_admin_task_execution_approval_not_completable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT task_row.*
  INTO v_task
  FROM public.admin_tasks AS task_row
  WHERE task_row.id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'complete_admin_task_execution_task_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_task.plan_id IS DISTINCT FROM v_task_ref.plan_id
    OR v_task.agent_action_id IS DISTINCT FROM v_task_ref.agent_action_id
    OR v_task.approval_id IS DISTINCT FROM v_task_ref.approval_id
    OR v_task.event_id IS DISTINCT FROM v_task_ref.event_id
  THEN
    RAISE EXCEPTION 'complete_admin_task_execution_identity_conflict'
      USING ERRCODE = '40001';
  END IF;

  IF v_task.status = 'complete' THEN
    RETURN v_task;
  END IF;
  IF v_task.status = 'cancelled' THEN
    RAISE EXCEPTION 'complete_admin_task_execution_task_cancelled'
      USING ERRCODE = '23514';
  END IF;
  IF v_task.status NOT IN ('open', 'in_progress') THEN
    RAISE EXCEPTION 'complete_admin_task_execution_task_not_completable'
      USING ERRCODE = '23514';
  END IF;

  IF v_task.agent_action_id IS NOT NULL THEN
    IF v_action.status NOT IN ('approved', 'executing', 'complete') THEN
      RAISE EXCEPTION 'complete_admin_task_execution_action_not_completable'
        USING ERRCODE = '23514';
    END IF;

    IF v_action.action_type = 'hold_request'
      AND v_outcome ->> 'outcome' NOT IN ('hold_confirmed', 'venue_unavailable')
    THEN
      RAISE EXCEPTION 'complete_admin_task_execution_hold_outcome_invalid'
        USING ERRCODE = '22023',
              HINT = 'Changed hold terms require a new approval version.';
    END IF;
  END IF;

  v_public_outcome := jsonb_strip_nulls(jsonb_build_object(
    'outcome', v_outcome ->> 'outcome',
    'hold_reference', NULLIF(btrim(v_outcome ->> 'hold_reference'), ''),
    'hold_expires_at', NULLIF(btrim(v_outcome ->> 'hold_expires_at'), ''),
    'summary', NULLIF(btrim(v_outcome ->> 'summary'), '')
  ));
  v_before_task := to_jsonb(v_task);

  UPDATE public.admin_tasks AS task_row
  SET status = 'complete',
      completed_at = v_now,
      outcome_payload = v_outcome,
      notes = CASE
        WHEN NULLIF(btrim(p_internal_note), '') IS NULL THEN task_row.notes
        ELSE concat_ws(
          E'\n\n',
          NULLIF(btrim(task_row.notes), ''),
          '[' || v_now::TEXT || '] admin' || E'\n' || btrim(p_internal_note)
        )
      END
  WHERE task_row.id = p_task_id
  RETURNING * INTO v_task;

  IF v_task.agent_action_id IS NOT NULL AND v_action.status <> 'complete' THEN
    v_previous_action_status := v_action.status;

    IF v_action.status = 'approved' THEN
      UPDATE public.agent_actions
      SET status = 'executing'
      WHERE id = v_action.id;

      INSERT INTO public.agent_action_audit_log (
        action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
      ) VALUES (
        v_action.id, v_action.plan_id, 'approved', 'executing', p_admin_user_id,
        'admin', 'concierge.operator_started', jsonb_build_object('task_id', v_task.id)
      );
      v_previous_action_status := 'executing';
    END IF;

    UPDATE public.agent_actions AS action_row
    SET status = 'complete',
        executed_at = v_now,
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'execution_mode', 'concierge_admin_queue',
            'handoff_status', 'complete',
            'admin_task_outcome', v_public_outcome,
            'outbound_message_sent', false,
            'completed_at', v_now
          )
    WHERE action_row.id = v_action.id;

    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_action.id, v_action.plan_id, v_previous_action_status, 'complete', p_admin_user_id,
      'admin', 'concierge.operator_completed',
      jsonb_build_object('task_id', v_task.id, 'outcome', v_public_outcome)
    );
  END IF;

  IF v_task.agent_action_id IS NOT NULL AND v_action.action_type = 'hold_request' THEN
    v_hold_outcome := v_public_outcome || jsonb_build_object(
      'agent_action_id', v_action.id,
      'approval_id', v_task.approval_id,
      'event_id', v_task.event_id,
      'recorded_at', v_now,
      'recorded_by', p_admin_user_id
    );

    PERFORM set_config('app.concierge_hold_plan_id', v_task.plan_id::TEXT, true);
    UPDATE public.plans
    SET latest_venue_hold_outcome = v_hold_outcome
    WHERE id = v_task.plan_id;
    PERFORM set_config('app.concierge_hold_plan_id', '', true);

    IF v_task.event_id IS NOT NULL THEN
      PERFORM set_config('app.concierge_hold_event_id', v_task.event_id::TEXT, true);
      UPDATE public.events
      SET latest_venue_hold_outcome = v_hold_outcome
      WHERE id = v_task.event_id
        AND plan_id = v_task.plan_id;
      PERFORM set_config('app.concierge_hold_event_id', '', true);
    END IF;
  END IF;

  v_host_message := COALESCE(
    NULLIF(btrim(p_host_message), ''),
    CASE
      WHEN v_task.agent_action_id IS NOT NULL
        AND v_action.action_type = 'hold_request'
        AND v_outcome ->> 'outcome' = 'hold_confirmed'
        THEN 'The venue hold was confirmed. 3rdPlace recorded the outcome on your event.'
      WHEN v_task.agent_action_id IS NOT NULL
        AND v_action.action_type = 'hold_request'
        THEN 'The venue could not confirm the requested hold. 3rdPlace recorded the outcome for follow-up.'
      ELSE '3rdPlace completed the operator follow-up for this approved request.'
    END
  );

  INSERT INTO public.plan_messages (
    plan_id, role, content, message_type, metadata
  ) VALUES (
    v_task.plan_id,
    'agent',
    left(v_host_message, 1000),
    'status_update',
    jsonb_build_object(
      'state', 'concierge_task_completed',
      'status', 'complete',
      'agent_action_id', v_task.agent_action_id,
      'approval_id', v_task.approval_id,
      'event_id', v_task.event_id,
      'outcome', v_public_outcome,
      'outbound_message_sent', false
    )
  );

  INSERT INTO public.admin_audit_log (
    admin_user_id, action, entity_type, entity_id, before_state, after_state, metadata
  ) VALUES (
    p_admin_user_id,
    'admin_tasks.complete',
    'admin_task',
    v_task.id,
    v_before_task,
    to_jsonb(v_task),
    jsonb_build_object('outcome_recorded', true, 'host_message_written', true)
  );

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_admin_task_execution(
  UUID, UUID, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_admin_task_execution(
  UUID, UUID, JSONB, TEXT, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_admin_task_execution(
  p_task_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_host_message TEXT DEFAULT NULL
)
RETURNS public.admin_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_task_ref public.admin_tasks%ROWTYPE;
  v_task public.admin_tasks%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_action public.agent_actions%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_host_message TEXT;
  v_before_task JSONB;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_actor_required'
      USING ERRCODE = '22023';
  END IF;

  -- Match enqueue and completion lock order: plan -> action -> approval -> task.
  SELECT task_row.*
  INTO v_task_ref
  FROM public.admin_tasks AS task_row
  WHERE task_row.id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_task_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT plan_row.*
  INTO v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_task_ref.plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_plan_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_task_ref.agent_action_id IS NOT NULL THEN
    SELECT action_row.*
    INTO v_action
    FROM public.agent_actions AS action_row
    WHERE action_row.id = v_task_ref.agent_action_id
      AND action_row.plan_id = v_task_ref.plan_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cancel_admin_task_execution_action_not_cancellable'
        USING ERRCODE = '23514';
    END IF;

    PERFORM approval_row.id
    FROM public.approvals AS approval_row
    WHERE approval_row.id = v_task_ref.approval_id
      AND approval_row.plan_id = v_task_ref.plan_id
      AND approval_row.agent_action_id = v_task_ref.agent_action_id
      AND v_action.approval_id = approval_row.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'cancel_admin_task_execution_approval_not_cancellable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT task_row.*
  INTO v_task
  FROM public.admin_tasks AS task_row
  WHERE task_row.id = p_task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_task_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_task.plan_id IS DISTINCT FROM v_task_ref.plan_id
    OR v_task.agent_action_id IS DISTINCT FROM v_task_ref.agent_action_id
    OR v_task.approval_id IS DISTINCT FROM v_task_ref.approval_id
    OR v_task.event_id IS DISTINCT FROM v_task_ref.event_id
  THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_identity_conflict'
      USING ERRCODE = '40001';
  END IF;

  IF v_task.status = 'cancelled' THEN
    RETURN v_task;
  END IF;
  IF v_task.status = 'complete' THEN
    RAISE EXCEPTION 'cancel_admin_task_execution_task_complete'
      USING ERRCODE = '23514';
  END IF;

  v_before_task := to_jsonb(v_task);

  IF v_task.agent_action_id IS NOT NULL THEN
    IF v_action.status NOT IN ('approved', 'executing', 'cancelled') THEN
      RAISE EXCEPTION 'cancel_admin_task_execution_action_not_cancellable'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.admin_tasks AS task_row
  SET status = 'cancelled',
      outcome_payload = jsonb_build_object(
        'outcome', 'cancelled',
        'reason', NULLIF(btrim(p_reason), ''),
        'cancelled_at', v_now,
        'cancelled_by', p_actor_id
      ),
      notes = CASE
        WHEN NULLIF(btrim(p_reason), '') IS NULL THEN task_row.notes
        ELSE concat_ws(
          E'\n\n',
          NULLIF(btrim(task_row.notes), ''),
          '[' || v_now::TEXT || '] cancelled' || E'\n' || btrim(p_reason)
        )
      END
  WHERE task_row.id = p_task_id
  RETURNING * INTO v_task;

  IF v_task.agent_action_id IS NOT NULL AND v_action.status <> 'cancelled' THEN
    UPDATE public.agent_actions AS action_row
    SET status = 'cancelled',
        result_metadata = COALESCE(action_row.result_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'execution_mode', 'concierge_admin_queue',
            'handoff_status', 'cancelled',
            'cancelled_at', v_now,
            'outbound_message_sent', false
          )
    WHERE action_row.id = v_action.id;

    INSERT INTO public.agent_action_audit_log (
      action_id, plan_id, from_status, to_status, actor_id, actor_role, reason, metadata
    ) VALUES (
      v_action.id,
      v_action.plan_id,
      v_action.status,
      'cancelled',
      p_actor_id,
      CASE WHEN p_actor_id = v_plan.user_id
        THEN 'user' ELSE 'admin' END,
      'concierge.task_cancelled',
      jsonb_build_object('task_id', v_task.id, 'reason', NULLIF(btrim(p_reason), ''))
    );
  END IF;

  v_host_message := COALESCE(
    NULLIF(btrim(p_host_message), ''),
    'The queued 3rdPlace operator request was cancelled. Nothing was sent, booked, or paid.'
  );

  INSERT INTO public.plan_messages (
    plan_id, role, content, message_type, metadata
  ) VALUES (
    v_task.plan_id,
    'agent',
    left(v_host_message, 1000),
    'status_update',
    jsonb_build_object(
      'state', 'concierge_task_cancelled',
      'status', 'cancelled',
      'agent_action_id', v_task.agent_action_id,
      'approval_id', v_task.approval_id,
      'event_id', v_task.event_id,
      'outbound_message_sent', false
    )
  );

  INSERT INTO public.admin_audit_log (
    admin_user_id, action, entity_type, entity_id, before_state, after_state, metadata
  ) VALUES (
    p_actor_id,
    'admin_tasks.cancel',
    'admin_task',
    v_task.id,
    v_before_task,
    to_jsonb(v_task),
    jsonb_build_object('host_message_written', true)
  );

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_admin_task_execution(
  UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_admin_task_execution(
  UUID, UUID, TEXT, TEXT
) TO service_role;

-- Host-initiated approval cancellation knows the action/approval identity, not
-- the internal task id. Resolve that link server-side and reuse the same locked,
-- idempotent cancellation command used by the admin queue.
CREATE OR REPLACE FUNCTION public.cancel_approved_admin_task(
  p_plan_id UUID,
  p_action_id UUID,
  p_approval_id UUID,
  p_actor_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_host_message TEXT DEFAULT NULL
)
RETURNS public.admin_tasks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_task public.admin_tasks%ROWTYPE;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'cancel_approved_admin_task_requires_service_role'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans AS plan_row
    JOIN public.agent_actions AS action_row
      ON action_row.plan_id = plan_row.id
     AND action_row.id = p_action_id
    JOIN public.approvals AS approval_row
      ON approval_row.id = p_approval_id
     AND approval_row.plan_id = plan_row.id
     AND approval_row.agent_action_id = action_row.id
    WHERE plan_row.id = p_plan_id
      AND plan_row.user_id = p_actor_id
      AND action_row.approval_id = approval_row.id
  ) THEN
    RAISE EXCEPTION 'cancel_approved_admin_task_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT task_row.*
  INTO v_task
  FROM public.admin_tasks AS task_row
  WHERE task_row.plan_id = p_plan_id
    AND task_row.agent_action_id = p_action_id
    AND task_row.approval_id = p_approval_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_approved_admin_task_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT command_row.*
  INTO v_task
  FROM public.cancel_admin_task_execution(
    v_task.id,
    p_actor_id,
    p_reason,
    p_host_message
  ) AS command_row;

  RETURN v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_approved_admin_task(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_approved_admin_task(
  UUID, UUID, UUID, UUID, TEXT, TEXT
) TO service_role;
