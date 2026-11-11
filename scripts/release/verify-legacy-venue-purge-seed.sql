-- LOCAL DISPOSABLE DATABASE ONLY. Seed at ledger157, then install real158-161.
-- No guard/trigger disablement. No production data or provider requests.
BEGIN;
CREATE SCHEMA d_purge_fixture;
CREATE TABLE d_purge_fixture.inputs(value jsonb NOT NULL);
-- The runner replaces only this data-only placeholder with the committed fake fixture.
INSERT INTO d_purge_fixture.inputs(value) VALUES (__SYNTHETIC_FIXTURE_JSON__::jsonb);

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at)
VALUES('d1620000-0000-4000-8000-000000000001','authenticated','authenticated','d-purge-host@example.com',now(),now());
INSERT INTO public.users(id,email,role,user_type)
VALUES('d1620000-0000-4000-8000-000000000001','d-purge-host@example.com','builder','community_builder');
INSERT INTO public.builder_profiles(id,user_id,name)
VALUES('d1620000-0000-4000-8000-000000000002','d1620000-0000-4000-8000-000000000001','Synthetic purge host');
INSERT INTO public.venues(id,owner_id,venue_name,venue_type,hourly_rate_cents)
VALUES('d1620000-0000-4000-8000-000000000003','d1620000-0000-4000-8000-000000000001','Independent native venue','event_space',70000);
INSERT INTO public.vendor_profiles(id,user_id,name,vendor_type,service_type)
VALUES('d1620000-0000-4000-8000-000000000004','d1620000-0000-4000-8000-000000000001','Independent native vendor','DJ / Music','dj');
INSERT INTO public.events(id,builder_id,event_name,event_type,event_date,start_time,end_time,duration_hours,status)
VALUES('d1620000-0000-4000-8000-000000000005','d1620000-0000-4000-8000-000000000002','Synthetic financial history','networking','2026-10-01','18:00','20:00',2,'completed');
INSERT INTO public.plans(id,user_id,title,status,guest_count,budget_cap_cents,metadata)
SELECT DISTINCT (c#>>'{row,plan_id}')::uuid,'d1620000-0000-4000-8000-000000000001'::uuid,'Synthetic host plan','ready'::public.planner_plan_status,30,220000,
'{"host_input":"KEEP host intent", "ticket_price_target_cents":2500,"archived_budget_cents":900719925474099312345}'::jsonb
FROM d_purge_fixture.inputs i CROSS JOIN LATERAL jsonb_array_elements(i.value->'copies') c;

DO $source$
DECLARE item jsonb; cols text; vals text;
BEGIN
 FOR item IN SELECT x.value FROM d_purge_fixture.inputs i,jsonb_array_elements(i.value->'source') x LOOP
  SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('n.%I',key),',' ORDER BY key)
    INTO cols,vals FROM jsonb_object_keys(item) key;
  EXECUTE format('INSERT INTO public.discovery_venues(%s) SELECT %s FROM jsonb_populate_record(NULL::public.discovery_venues,$1) n',cols,vals) USING item;
 END LOOP;
END;
$source$;

DO $copies$
DECLARE item jsonb; tab text;
BEGIN
 FOR item IN SELECT x.value FROM d_purge_fixture.inputs i,jsonb_array_elements(i.value->'copies') x LOOP
  tab:=item->>'table';
  IF tab NOT IN('plan_discovery_venue_candidates','recommendations','plan_messages','agent_runs') THEN RAISE EXCEPTION 'Unexpected fixture table'; END IF;
  EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',tab,tab) USING item->'row';
 END LOOP;
END;
$copies$;

-- Independent and host-authored canaries are deliberately outside the113 selector.
DO $outside$
DECLARE v uuid; p uuid;
BEGIN
 SELECT (public.upsert_discovery_venue_identity('independent-fixture-place')->>'id')::uuid INTO v;
 PERFORM public.write_discovery_venue_independent_facts(v,'{"name":"KEEP independently evidenced venue"}',
  '{"name":{"resolution":"resolved","source":"host_input","evidence_reference":"fixture:host","collected_at":"2026-11-11T00:00:00Z","confidence":null,"confirmation_status":"unconfirmed","lineage":[]}}','{}');
 SELECT id INTO p FROM public.plans ORDER BY id LIMIT 1;
 INSERT INTO public.plan_messages(id,plan_id,role,content,metadata)
 VALUES('d1620000-0000-4000-8000-000000000007',p,'user','KEEP host-authored intent','{}');
END;
$outside$;

-- Protected records deliberately use independently authored native inventory.
DO $protected$
DECLARE i integer; p uuid; a uuid; approval uuid;
BEGIN
 SELECT id INTO p FROM public.plans ORDER BY id LIMIT 1;
 FOR i IN 1..39 LOOP
  a:=('d1621000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  approval:=('d1622000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  INSERT INTO public.agent_actions(id,plan_id,action_type,description,provider,amount_cents,status,payload_json)
  VALUES(a,p,'hold','KEEP independently authorized action','Native partner',70000+i,'proposed',jsonb_build_object('kind','fixture_native','amount_cents',70000+i));
  INSERT INTO public.approvals(id,root_approval_id,plan_id,agent_action_id,action_label,provider,price_cents,fees_cents,status,snapshot_hash,snapshot_json,snapshot_schema_version,notes)
  VALUES(approval,approval,p,a,'KEEP approval','Native partner',70000+i,CASE WHEN i%2=0 THEN NULL ELSE 123 END,'pending',
    CASE WHEN i<=20 THEN encode(sha256(convert_to('fixture-signed-'||i,'UTF8')),'hex') END,
    CASE WHEN i<=20 THEN jsonb_build_object('schema_version',2,'approval',jsonb_build_object('price_cents',70000+i,'notes','KEEP signed notes'),'action',jsonb_build_object('kind','native_fixture')) END,
    CASE WHEN i<=20 THEN 2 END,'KEEP operator notes');
 END LOOP;
 FOR i IN 1..9 LOOP
  INSERT INTO public.venue_bookings(id,venue_id,event_id,organizer_id,booking_date,status,total_amount,special_requests)
  VALUES(('d1623000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'d1620000-0000-4000-8000-000000000003','d1620000-0000-4000-8000-000000000005','d1620000-0000-4000-8000-000000000001','2026-10-01','confirmed',70000+i,'KEEP independently agreed cancellation consent');
 END LOOP;
 INSERT INTO public.vendor_bookings(id,vendor_id,event_id,organizer_id,booking_date,status,total_amount,notes)
 VALUES('d1624000-0000-4000-8000-000000000001','d1620000-0000-4000-8000-000000000004','d1620000-0000-4000-8000-000000000005','d1620000-0000-4000-8000-000000000001','2026-10-01','confirmed',35000,'KEEP vendor cancellation consent');
END;
$protected$;
INSERT INTO public.event_financial_summary(event_id,tickets_sold,gross_revenue,total_fees,total_refunds,net_revenue,current_attendance)
VALUES('d1620000-0000-4000-8000-000000000005',30,100000,NULL,5000,95000,27);
INSERT INTO public.event_sales_data(event_id,total_sales,data_source,entered_by,ticket_quantity,total_amount_cents,fees_cents,is_refund)
VALUES('d1620000-0000-4000-8000-000000000005',100000,'manual','d1620000-0000-4000-8000-000000000001',30,100000,NULL,false);

-- Cover every source FK class without placing unsupported facts in protected rows.
DO $dependencies$
DECLARE v uuid; p uuid;
BEGIN
 SELECT id INTO v FROM public.discovery_venues ORDER BY id LIMIT 1;
 SELECT id INTO p FROM public.plans ORDER BY id LIMIT 1;
 INSERT INTO public.discovery_venue_events(discovery_venue_id,event_type,metadata) VALUES(v,'fixture_identity_reference','{}');
 INSERT INTO public.discovery_venue_signals(discovery_venue_id,event_type) VALUES(v,'reply_received');
 INSERT INTO public.venue_contact_profiles(discovery_venue_id,email,sms_opted_out_at,voice_allowed) VALUES(v,'independent@example.com','2026-10-01',false);
 INSERT INTO public.venue_outreach_responses(plan_id,discovery_venue_id,quoted_price_cents,conditions,raw_response_excerpt)
 VALUES(p,v,12345,'{"signed_term":"KEEP cancellation consent"}','KEEP partner-reported commercial terms');
 INSERT INTO public.outreach_threads(plan_id,user_id,target_type,target_name,discovery_venue_id,target_source,target_email)
 VALUES(p,'d1620000-0000-4000-8000-000000000001','venue','Venue contact',v,'discovery','independent@example.com');
 INSERT INTO public.supply_scout_venue_leads(name,address,normalized_name,normalized_address,source_platform,evidence_summary,discovery_venue_id)
 VALUES('Independent seed','Independent address','independent seed','independent address','manual','KEEP host evidence',v);
 UPDATE public.plans SET committed_venue_id=v,committed_venue_quoted_price_cents=12345 WHERE id=p;
END;
$dependencies$;
COMMIT;
