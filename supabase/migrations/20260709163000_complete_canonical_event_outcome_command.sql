-- Prompt 8: expose the existing guarded outcome transition as one idempotent,
-- host-visible command. The underlying record_plan_event_outcome function owns
-- event/plan locking and evidence validation; this wrapper adds the timeline
-- message in the same transaction without weakening any lifecycle check.

CREATE OR REPLACE FUNCTION public.record_plan_event_outcome_command(
  p_event_id UUID,
  p_actor_id UUID,
  p_outcome_summary JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_plan public.plans%ROWTYPE;
  v_message_id UUID;
BEGIN
  IF current_user <> 'postgres'
    AND NOT (current_user = 'service_role' AND auth.role() = 'service_role')
  THEN
    RAISE EXCEPTION 'record_plan_event_outcome_command_unauthorized'
      USING ERRCODE = '42501';
  END IF;

  v_event := public.record_plan_event_outcome(
    p_event_id,
    p_actor_id,
    p_outcome_summary
  );

  SELECT plan_row.*
  INTO STRICT v_plan
  FROM public.plans AS plan_row
  WHERE plan_row.id = v_event.plan_id
    AND plan_row.materialized_event_id = v_event.id
    AND plan_row.user_id = p_actor_id;

  SELECT message_row.id
  INTO v_message_id
  FROM public.plan_messages AS message_row
  WHERE message_row.plan_id = v_plan.id
    AND message_row.message_type = 'status_update'
    AND message_row.metadata ->> 'kind' = 'canonical_event_outcome_recorded'
    AND message_row.metadata ->> 'event_id' = v_event.id::TEXT
  ORDER BY message_row.created_at ASC, message_row.id ASC
  LIMIT 1;

  IF v_message_id IS NULL THEN
    INSERT INTO public.plan_messages (
      plan_id,
      role,
      content,
      message_type,
      metadata
    ) VALUES (
      v_plan.id,
      'system',
      'Event outcome recorded. This plan is complete and ready for analytics, templates, and rebooking.',
      'status_update',
      jsonb_build_object(
        'kind', 'canonical_event_outcome_recorded',
        'event_id', v_event.id,
        'plan_id', v_plan.id,
        'outcome_recorded_at', v_event.outcome_recorded_at,
        'outcome_summary', v_event.outcome_summary,
        'template_eligible', true
      )
    )
    RETURNING id INTO v_message_id;
  END IF;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'plan', to_jsonb(v_plan),
    'plan_message_id', v_message_id,
    'template_eligible', true
  );
END;
$function$;

COMMENT ON FUNCTION public.record_plan_event_outcome_command(UUID, UUID, JSONB) IS
  'Records guarded canonical event outcome evidence, completes the linked plan, and writes one host-visible timeline message atomically.';

REVOKE ALL ON FUNCTION public.record_plan_event_outcome_command(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_plan_event_outcome_command(UUID, UUID, JSONB)
  TO service_role;
