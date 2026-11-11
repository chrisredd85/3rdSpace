-- Actual canonical booking copies, with immutable pre161 unsafe signed evidence.
\if :setup
BEGIN;
DO $seed$
DECLARE c c2_activate_proof.stage_cases; v_payload jsonb; v_snapshot jsonb;
BEGIN
 SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=12;
 v_payload:=c.payload-'vendor_data';
 v_snapshot:=jsonb_set(c.snapshot,'{action,payload_json}',v_payload);
 UPDATE c2_activate_proof.stage_cases SET payload=v_payload,snapshot=v_snapshot WHERE case_number=12;
 PERFORM c2_activate_proof.stage(12,false);
 UPDATE public.approvals SET status='authorized',authorized_by='c2160000-0000-4000-8000-000000000001',authorized_at=now(),authorized_amount_cents=70000,
 approved_by='c2160000-0000-4000-8000-000000000001',approved_at=now() WHERE id=c.approval_id;
 UPDATE public.agent_actions SET status='approved' WHERE id=c.action_id;
 PERFORM public.materialize_plan_event(c.plan_id,'c2160000-0000-4000-8000-000000000001','founder_operator_dinner',current_date+30,'18:00'::time,120,'America/Los_Angeles');
 INSERT INTO c2_activate_proof.saved_approval SELECT id,snapshot_json,snapshot_hash,authorized_at,authorized_by,authorized_amount_cents FROM public.approvals WHERE id IN(SELECT approval_id FROM c2_activate_proof.stage_cases WHERE case_number IN(11,12));
END;
$seed$;
COMMIT;
\else
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.role='service_role';
DO $booking$
DECLARE c c2_activate_proof.stage_cases; result jsonb; replay jsonb;
BEGIN
 SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=11;
 result:=public.create_canonical_booking_from_approval(c.plan_id,c.action_id,c.approval_id,'c2160000-0000-4000-8000-000000000001');
 replay:=public.create_canonical_booking_from_approval(c.plan_id,c.action_id,c.approval_id,'c2160000-0000-4000-8000-000000000001');
 PERFORM c2_activate_proof.assert_true(result->>'booking_kind'='vendor' AND result->>'existing'='false' AND replay->>'existing'='true','canonical vendor booking and exact retry pass');
 PERFORM c2_activate_proof.assert_true((SELECT count(*)=1 AND bool_and(b.approved_terms_snapshot=c.snapshot AND a.snapshot_hash=repeat('d',64)) FROM public.vendor_bookings b JOIN public.approvals a ON a.id=b.approval_id WHERE b.approval_id=c.approval_id),'booking copies exact signed terms/hash once');
 PERFORM c2_activate_proof.expect_error(format('UPDATE public.vendor_bookings SET approved_terms_snapshot=jsonb_set(approved_terms_snapshot,%L,%L::jsonb) WHERE approval_id=%L','{approval,provider}','"Tampered"',c.approval_id),'23514','booking rejects changed signed copy');
 SELECT * INTO STRICT c FROM c2_activate_proof.stage_cases WHERE case_number=12;
 PERFORM c2_activate_proof.expect_error(format('SELECT public.create_canonical_booking_from_approval(%L,%L,%L,%L)',c.plan_id,c.action_id,c.approval_id,'c2160000-0000-4000-8000-000000000001'),'22023','legacy unsafe signed snapshot cannot be recopied to booking');
 PERFORM c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM public.vendor_bookings WHERE approval_id=c.approval_id),'unsafe booking rejection leaves no booking');
 PERFORM c2_activate_proof.assert_true(NOT EXISTS(SELECT FROM c2_activate_proof.saved_approval b JOIN public.approvals a USING(id) WHERE (a.snapshot_json,a.snapshot_hash,a.authorized_at,a.authorized_by,a.authorized_amount_cents) IS DISTINCT FROM (b.snapshot_json,b.snapshot_hash,b.authorized_at,b.authorized_by,b.authorized_amount_cents)),'booking never repairs signed source evidence');
END;
$booking$;
COMMIT;
\endif
