-- Run only inside the representative disposable ACTIVATE fixture transaction.
-- The preceding real-RPC extension supplies the actual action column names.
-- No fixture claims that an operational reason is a venue-derived fact.
DO $operational_reason_contract$
DECLARE
  v_venue UUID := '00000000-0000-0000-0000-000000000001';
  v_action UUID; v_saved JSONB; v_metadata JSONB; v_bad JSONB; v_label TEXT; v_error TEXT;
  v_reapproval JSONB := jsonb_build_object(
    'approval_id','00000000-0000-0000-0000-000000000201',
    'snapshot_hash',repeat('a',64),'reason','approval_expired','required_at','2026-09-24T00:00:00+00:00');
  v_decline JSONB := jsonb_build_object(
    'booking_id','00000000-0000-0000-0000-000000000202','booking_kind','venue',
    'approval_id','00000000-0000-0000-0000-000000000201',
    'approval_snapshot_hash',repeat('a',64),'declined_by','00000000-0000-0000-0000-000000000203',
    'declined_at','2026-09-24T00:00:00Z','reason','Unavailable',
    'context',jsonb_build_object('source','partner_route','route_confirmed',true));
BEGIN
  v_metadata := jsonb_build_object('canonical_quote_reapproval',v_reapproval);
  INSERT INTO public.agent_actions(target_type,target_id,result_metadata,status)
    VALUES('discovery_venue',v_venue,v_metadata,'pending') RETURNING id,result_metadata INTO v_action,v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_metadata,'operational expired reason INSERT retains exact evidence');
  v_metadata := jsonb_set(v_metadata,'{canonical_quote_reapproval,reason}','"approval_stale"');
  UPDATE public.agent_actions SET result_metadata=v_metadata WHERE id=v_action RETURNING result_metadata INTO v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_metadata,'operational stale reason UPDATE retains exact evidence');

  v_metadata := jsonb_build_object('canonical_booking_decline',v_decline);
  INSERT INTO public.agent_actions(target_type,target_id,result_metadata,status)
    VALUES('discovery_venue',v_venue,v_metadata,'pending') RETURNING id,result_metadata INTO v_action,v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_metadata,'partner decline reason INSERT retains exact evidence');
  v_metadata := jsonb_set(v_metadata,'{canonical_booking_decline,reason}','"Terminal plan unavailable"');
  UPDATE public.agent_actions SET result_metadata=v_metadata WHERE id=v_action RETURNING result_metadata INTO v_saved;
  PERFORM pg_temp.assert_true(v_saved=v_metadata,'partner decline reason UPDATE retains exact evidence');

  FOR v_label,v_bad IN SELECT label,payload FROM (VALUES
    ('standalone operational-looking reason',jsonb_build_object('reason','approval_expired')),
    ('unproven ranking reason',jsonb_build_object('reason','Highly rated nearby venue')),
    ('unproven ranking score',jsonb_build_object('fit_score',99)),
    ('wrong nested marker path',jsonb_build_object('nested',jsonb_build_object('canonical_quote_reapproval',v_reapproval))),
    ('array marker',jsonb_build_object('canonical_quote_reapproval',jsonb_build_array(v_reapproval))),
    ('array metadata',jsonb_build_array(jsonb_build_object('canonical_quote_reapproval',v_reapproval))),
    ('scope key impersonation',jsonb_build_object('agent_actions.result_metadata.canonical_quote_reapproval',v_reapproval)),
    ('invalid reapproval enum',jsonb_build_object('canonical_quote_reapproval',jsonb_set(v_reapproval,'{reason}','"great venue"'))),
    ('missing reapproval evidence',jsonb_build_object('canonical_quote_reapproval',v_reapproval-'snapshot_hash')),
    ('invalid reapproval identity',jsonb_build_object('canonical_quote_reapproval',jsonb_set(v_reapproval,'{approval_id}','"not-an-id"'))),
    ('invalid reapproval timestamp',jsonb_build_object('canonical_quote_reapproval',jsonb_set(v_reapproval,'{required_at}','"yesterday"'))),
    ('unexpected marker sibling',jsonb_build_object('canonical_quote_reapproval',v_reapproval || '{"unreviewed":"value"}'::JSONB)),
    ('provider sibling beside valid reason',jsonb_build_object('canonical_quote_reapproval',v_reapproval || '{"googleLive":{"displayName":"Unsafe"}}'::JSONB)),
    ('nested provider content in decline context',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{context}','{"googleLive":{"displayName":"Unsafe"}}'))),
    ('nested ranking reason in decline context',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{context}','{"reason":"Highly rated"}'))),
    ('invalid decline actor',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{declined_by}','"not-an-id"'))),
    ('missing decline evidence',jsonb_build_object('canonical_booking_decline',v_decline-'approval_snapshot_hash')),
    ('invalid decline context shape',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{context}','[]'))),
    ('blank decline reason',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{reason}','"  "'))),
    ('overlong decline reason',jsonb_build_object('canonical_booking_decline',jsonb_set(v_decline,'{reason}',to_jsonb(repeat('x',1001)))))
  ) AS cases(label,payload) LOOP
    BEGIN
      UPDATE public.agent_actions SET result_metadata=v_bad WHERE id=v_action;
      RAISE EXCEPTION 'FAIL accepted %',v_label;
    EXCEPTION WHEN invalid_parameter_value THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      PERFORM pg_temp.assert_true(v_error LIKE 'venue_boundary_%','invalid operational shape rejected by venue boundary');
      RAISE NOTICE 'PASS: operational reason contract rejects %',v_label;
    END;
    PERFORM pg_temp.assert_true((SELECT result_metadata=v_metadata FROM public.agent_actions WHERE id=v_action),
      'rejected operational marker leaves existing evidence unchanged');
  END LOOP;

  BEGIN
    INSERT INTO public.agent_actions(target_type,target_id,payload_json)
      VALUES('discovery_venue',v_venue,jsonb_build_object('canonical_quote_reapproval',v_reapproval));
    RAISE EXCEPTION 'FAIL accepted operational marker inside action payload';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'PASS: payload_json cannot borrow the result_metadata reason exemption';
  END;
  BEGIN
    INSERT INTO public.agent_actions(target_type,target_id,payload_json)
      VALUES('discovery_venue',v_venue,jsonb_build_object('agent_actions.result_metadata.canonical_quote_reapproval',v_reapproval));
    RAISE EXCEPTION 'FAIL JSON key forged an internal reason scope';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'PASS: JSON object keys cannot forge internal operational reason scope';
  END;
  BEGIN
    INSERT INTO public.plan_messages(metadata)
      VALUES(jsonb_build_object('target_type','discovery_venue','target_id',v_venue,
        'result_metadata',jsonb_build_object('canonical_quote_reapproval',v_reapproval)));
    RAISE EXCEPTION 'FAIL wrong durable sink borrowed operational reason scope';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'PASS: another durable sink cannot borrow the action reason exemption';
  END;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='private'::regnamespace
    AND proname IN ('assert_venue_durable_json','fence_venue_durable_sink')
    AND prosrc ~* 'EXCEPTION[[:space:]]+WHEN'),'operational reason amendment has no per-node exception handlers');
END;
$operational_reason_contract$;
