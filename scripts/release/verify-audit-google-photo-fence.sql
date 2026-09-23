\set ON_ERROR_STOP on
-- Run only in an empty disposable PostgreSQL database. CREATE TABLE intentionally
-- fails if real audit tables exist; this script must never target an application DB.
BEGIN;
CREATE TABLE public.users (id UUID PRIMARY KEY);
CREATE TABLE public.plans (id UUID PRIMARY KEY, metadata JSONB);
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  plan_id UUID REFERENCES public.plans(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_state JSONB,
  after_state JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.photo_fence_test_commitments (id UUID PRIMARY KEY, amount_cents INTEGER, status TEXT, approved_snapshot JSONB);
CREATE ROLE photo_fence_test_writer NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
-- Exercise explicit revocation even when deployment defaults grant function use.
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO authenticated;

INSERT INTO public.users VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.plans VALUES (
  '00000000-0000-0000-0000-000000000002',
  '{"photos":[{"name":"places/fixture/photos/old-plan-token"}],"agreed_price_cents":25000}'
);
INSERT INTO public.audit_logs (id,user_id,plan_id,action,entity_type,before_state,after_state)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'legacy', 'plan',
  '{"photoName":"opaque-legacy-token"}',
  '{"photos":[{"name":"places/fixture/photos/old-history-token"}]}'
);

\ir ../../supabase/migrations/20260922000001_fence_new_audit_google_photo_snapshots.sql
-- Reapplying the migration is safe and does not sanitize old rows.
\ir ../../supabase/migrations/20260922000001_fence_new_audit_google_photo_snapshots.sql

DO $single_boundary_test$
DECLARE
  v_helper TEXT;
  v_trigger TEXT;
  v_helper_handlers INTEGER;
  v_trigger_handlers INTEGER;
BEGIN
  SELECT prosrc INTO STRICT v_helper FROM pg_proc
    WHERE oid = 'private.strip_google_photo_audit_json(jsonb)'::REGPROCEDURE;
  SELECT prosrc INTO STRICT v_trigger FROM pg_proc
    WHERE oid = 'private.fence_new_audit_google_photos()'::REGPROCEDURE;
  -- Match statement-leading EXCEPTION clauses, not comments or RAISE EXCEPTION.
  SELECT count(*) INTO v_helper_handlers
    FROM regexp_matches(v_helper, '^[[:blank:]]*EXCEPTION([[:blank:]]|$)', 'gin');
  SELECT count(*) INTO v_trigger_handlers
    FROM regexp_matches(v_trigger, '^[[:blank:]]*EXCEPTION([[:blank:]]|$)', 'gin');
  IF v_helper_handlers <> 0 OR v_trigger_handlers <> 1 THEN
    RAISE EXCEPTION 'Expected zero recursive-helper EXCEPTION clauses and one trigger boundary; found helper=%, trigger=%',
      v_helper_handlers, v_trigger_handlers;
  END IF;
  RAISE NOTICE 'PASS: recursive helper has zero EXCEPTION clauses; trigger has exactly one';
END;
$single_boundary_test$;

INSERT INTO public.audit_logs (user_id,plan_id,action,entity_type,before_state,after_state)
SELECT '00000000-0000-0000-0000-000000000001', id, 'new.snapshot', 'plan', to_jsonb(p),
  '{"amount_cents":25000,"approved":true,"independent_image":"https://example.com/host.jpg","nested":{"google_photo_names":["opaque-legacy-token"],"id":"place-id-retained"},"prose":"See places/fixture/photos/new-token","encoded":"places%2Ffixture%2Fphotos%2Fencoded-token","legacy_url":"https://maps.googleapis.com/maps/api/place/photo?photoreference=secret","photoUri":"https://lh3.googleusercontent.com/p/signed-token","serialized":"{\"photoName\":\"opaque-token\",\"amount_cents\":25000}","source":"google_places","photos":["opaque-token","https://example.com/host.jpg",{"url":"https://example.com/partner.jpg"},{"name":"places/fixture/photos/new-token"}],"nulls":[null,1,false]}'::JSONB
FROM public.plans p;

INSERT INTO public.audit_logs (user_id,action,entity_type,after_state)
VALUES (
  '00000000-0000-0000-0000-000000000001','mixed.business','commitment',
  '{"records":[{"partner_id":"partner-1","amount_cents":25000,"url":"https://places.googleapis.com/v1/places/fixture/photos/token/media"},{"partner_id":"partner-2","amount_cents":50000,"dataUrl":"data:image/png;base64,AAAA","attribution":{"googleMapsUri":"https://www.google.com/maps/photo/x","authorAttributions":[]}},{"partner_id":"partner-3","amount_cents":75000,"googleMapsUri":"https://www.google.com/maps/photo/x","authorAttributions":[]}]}'
);

-- A legitimate write role may insert an audit record without being able to call
-- private helpers. A photo-bearing snapshot cannot block this mock commitment.
GRANT INSERT ON public.audit_logs, public.photo_fence_test_commitments TO photo_fence_test_writer;
SET LOCAL ROLE photo_fence_test_writer;
INSERT INTO public.photo_fence_test_commitments VALUES (
  '00000000-0000-0000-0000-000000000004', 25000, 'confirmed',
  '{"hash":"existing-consent-hash","amount_cents":25000}'
);
INSERT INTO public.audit_logs (user_id,action,entity_type,before_state,after_state)
VALUES (
  '00000000-0000-0000-0000-000000000001','commitment.confirmed','commitment', NULL,
  '{"photoName":"opaque-token","amount_cents":25000,"status":"confirmed"}'
);
RESET ROLE;

DO $test$
DECLARE
  v_new public.audit_logs;
  v_result JSONB;
BEGIN
  SELECT * INTO STRICT v_new FROM public.audit_logs WHERE action = 'new.snapshot';
  IF v_new.before_state->'metadata'->'photos' IS DISTINCT FROM '[]'::JSONB
    OR v_new.before_state->'metadata'->>'agreed_price_cents' IS DISTINCT FROM '25000' THEN
    RAISE EXCEPTION 'Full-plan new audit copy did not sanitize photos/preserve money';
  END IF;
  IF (v_new.after_state->'nested') ? 'google_photo_names'
    OR v_new.after_state ? 'photoUri'
    OR v_new.after_state->>'prose' IS DISTINCT FROM 'See [Google photo omitted]'
    OR v_new.after_state->>'encoded' IS DISTINCT FROM '[Google photo omitted]'
    OR v_new.after_state->>'legacy_url' IS DISTINCT FROM '[Google photo omitted]'
    OR (v_new.after_state->>'serialized')::JSONB IS DISTINCT FROM '{"amount_cents":25000}'::JSONB THEN
    RAISE EXCEPTION 'Nested, prose, encoded, legacy URL or serialized token survived';
  END IF;
  IF v_new.after_state->'photos' IS DISTINCT FROM '["https://example.com/host.jpg",{"url":"https://example.com/partner.jpg"}]'::JSONB
    OR v_new.after_state->>'independent_image' IS DISTINCT FROM 'https://example.com/host.jpg'
    OR v_new.after_state->>'amount_cents' IS DISTINCT FROM '25000'
    OR v_new.after_state->'approved' IS DISTINCT FROM 'true'::JSONB
    OR v_new.after_state->'nulls' IS DISTINCT FROM '[null,1,false]'::JSONB
    OR v_new.after_state->'nested'->>'id' IS DISTINCT FROM 'place-id-retained' THEN
    RAISE EXCEPTION 'Independent images, identities, money or scalar JSON changed';
  END IF;
  SELECT after_state INTO STRICT v_result FROM public.audit_logs WHERE action = 'mixed.business';
  IF v_result IS DISTINCT FROM '{"records":[{"partner_id":"partner-1","amount_cents":25000,"url":"[Google photo omitted]"},{"partner_id":"partner-2","amount_cents":50000,"attribution":null},{"partner_id":"partner-3","amount_cents":75000}]}'::JSONB THEN
    RAISE EXCEPTION 'Mixed business identifiers/amounts were lost or incidental photo data survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'legacy'
    AND before_state = '{"photoName":"opaque-legacy-token"}'::JSONB
    AND after_state = '{"photos":[{"name":"places/fixture/photos/old-history-token"}]}'::JSONB) THEN
    RAISE EXCEPTION 'Historical audit row changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE metadata =
    '{"photos":[{"name":"places/fixture/photos/old-plan-token"}],"agreed_price_cents":25000}'::JSONB) THEN
    RAISE EXCEPTION 'Original plan changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_fence_test_commitments WHERE status = 'confirmed'
    AND amount_cents = 25000 AND approved_snapshot = '{"hash":"existing-consent-hash","amount_cents":25000}'::JSONB)
    OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'commitment.confirmed'
      AND before_state IS NULL AND after_state = '{"amount_cents":25000,"status":"confirmed"}'::JSONB) THEN
    RAISE EXCEPTION 'Commitment or consent was blocked/modified';
  END IF;
  IF has_function_privilege('photo_fence_test_writer', 'private.strip_google_photo_audit_json(jsonb)', 'EXECUTE')
    OR has_function_privilege('photo_fence_test_writer', 'private.fence_new_audit_google_photos()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.strip_google_photo_audit_json(jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.fence_new_audit_google_photos()', 'EXECUTE')
    OR has_function_privilege('anon', 'private.strip_google_photo_audit_json(jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'private.strip_google_photo_audit_json(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Private implementation unexpectedly callable by app role';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.audit_logs'::REGCLASS
      AND NOT tgisinternal AND (tgtype & 4) = 4 AND (tgtype & 16) = 0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one INSERT-only audit fence';
  END IF;
  v_result := private.strip_google_photo_audit_json('{"dataUrl":"data:image/png;base64,AAAA","attribution":{"googleMapsUri":"https://www.google.com/maps/photo/x","authorAttributions":[]}}');
  IF v_result IS DISTINCT FROM 'null'::JSONB THEN RAISE EXCEPTION 'Transient photo bytes retained'; END IF;
  IF private.strip_google_photo_audit_json('{"photos":["https://example.com/upload.jpg"],"name":"Independent business"}')
    IS DISTINCT FROM '{"photos":["https://example.com/upload.jpg"],"name":"Independent business"}'::JSONB THEN
    RAISE EXCEPTION 'Independent photo data changed';
  END IF;
  IF private.strip_google_photo_audit_json(v_new.after_state) IS DISTINCT FROM v_new.after_state THEN
    RAISE EXCEPTION 'New-copy sanitation is not idempotent';
  END IF;
  IF private.strip_google_photo_audit_json(to_jsonb('[Google photo omitted] then places/fixture/photos/next-token'::TEXT))
    IS DISTINCT FROM to_jsonb('[Google photo omitted] then [Google photo omitted]'::TEXT) THEN
    RAISE EXCEPTION 'Existing redaction marker was reparsed or prevented later photo-token removal';
  END IF;
  RAISE NOTICE 'PASS: insert-only audit photo fence; old rows/plans/consent unchanged; independent facts preserved; restricted-role commitment succeeds';
END;
$test$;

-- Each payload is valid outer JSONB containing a serialized JSON string. Parsing
-- the inner string as JSONB can raise numeric overflow or unsupported Unicode;
-- the trigger must restore BOTH original snapshots instead of blocking work.
SET LOCAL ROLE photo_fence_test_writer;
INSERT INTO public.photo_fence_test_commitments (id,amount_cents,status,approved_snapshot)
VALUES
  ('00000000-0000-0000-0000-000000000005',25000,'confirmed','{"hash":"overflow-consent","amount_cents":25000}'),
  ('00000000-0000-0000-0000-000000000006',25000,'confirmed','{"hash":"unicode-consent","amount_cents":25000}'),
  ('00000000-0000-0000-0000-000000000007',25000,'confirmed','{"hash":"mixed-consent","amount_cents":25000}'),
  ('00000000-0000-0000-0000-000000000008',25000,'confirmed','{"hash":"malformed-consent","amount_cents":25000}'),
  ('00000000-0000-0000-0000-000000000009',25000,'confirmed','{"hash":"after-overflow-consent","amount_cents":25000}'),
  ('00000000-0000-0000-0000-000000000010',25000,'confirmed','{"hash":"after-unicode-consent","amount_cents":25000}');
INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,before_state,after_state)
SELECT '00000000-0000-0000-0000-000000000001', fixture.action, 'commitment', fixture.entity_id,
  jsonb_build_object('serialized',fixture.payload,'amount_cents',25000,'status','pending'),
  jsonb_build_object('serialized',fixture.payload,'amount_cents',25000,'status','confirmed')
FROM (VALUES
  ('pathological.numeric','00000000-0000-0000-0000-000000000005'::UUID,$payload${"x":1e1000000}$payload$),
  ('pathological.unicode','00000000-0000-0000-0000-000000000006'::UUID,$payload${"x":"\u0000"}$payload$),
  ('pathological.malformed','00000000-0000-0000-0000-000000000008'::UUID,$payload${"x":"https://places.googleapis.com/v1/places/fixture/photos/token/media"$payload$)
) AS fixture(action,entity_id,payload);
INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,before_state,after_state)
SELECT '00000000-0000-0000-0000-000000000001', 'pathological.mixed', 'commitment',
  '00000000-0000-0000-0000-000000000007',
  fixture.payload || '{"status":"pending"}'::JSONB,
  fixture.payload || '{"status":"confirmed"}'::JSONB
FROM (SELECT jsonb_build_object(
  'overflow_serialized',$payload${"x":1e1000000}$payload$,
  'unicode_serialized',$payload${"x":"\u0000"}$payload$,
  'amount_cents',25000,
  'photoName','opaque-token',
  'photo_prose','See places/fixture/photos/mixed-token',
  'serialized_photo',$payload${"photoName":"opaque-token","amount_cents":25000}$payload$,
  'independent_image','https://example.com/host.jpg'
) AS payload) AS fixture;
-- Real errors in the second helper call must undo successful before sanitation.
INSERT INTO public.audit_logs (user_id,action,entity_type,entity_id,before_state,after_state)
SELECT '00000000-0000-0000-0000-000000000001', fixture.action, 'commitment', fixture.entity_id,
  '{"photoName":"original-before-token","amount_cents":25000,"status":"pending"}'::JSONB,
  jsonb_build_object('serialized',fixture.payload,'amount_cents',25000,'status','confirmed')
FROM (VALUES
  ('pathological.after_numeric','00000000-0000-0000-0000-000000000009'::UUID,$payload${"x":1e1000000}$payload$),
  ('pathological.after_unicode','00000000-0000-0000-0000-000000000010'::UUID,$payload${"x":"\u0000"}$payload$)
) AS fixture(action,entity_id,payload);
RESET ROLE;

DO $pathological_test$
DECLARE
  v_case RECORD;
  v_audit public.audit_logs;
  v_expected JSONB;
BEGIN
  FOR v_case IN SELECT * FROM (VALUES
    ('pathological.numeric','00000000-0000-0000-0000-000000000005'::UUID,$payload${"x":1e1000000}$payload$,'overflow-consent'),
    ('pathological.unicode','00000000-0000-0000-0000-000000000006'::UUID,$payload${"x":"\u0000"}$payload$,'unicode-consent'),
    ('pathological.malformed','00000000-0000-0000-0000-000000000008'::UUID,$payload${"x":"https://places.googleapis.com/v1/places/fixture/photos/token/media"$payload$,'malformed-consent')
  ) AS fixture(action,entity_id,payload,consent_hash)
  LOOP
    SELECT * INTO STRICT v_audit FROM public.audit_logs WHERE action = v_case.action;
    IF v_audit.entity_id IS DISTINCT FROM v_case.entity_id
      OR v_audit.before_state IS DISTINCT FROM jsonb_build_object('serialized',v_case.payload,'amount_cents',25000,'status','pending')
      OR v_audit.after_state IS DISTINCT FROM jsonb_build_object('serialized',v_case.payload,'amount_cents',25000,'status','confirmed') THEN
      RAISE EXCEPTION 'Pathological serialized value changed in before/after snapshot: %', v_case.action;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.photo_fence_test_commitments WHERE id = v_case.entity_id
      AND amount_cents = 25000 AND status = 'confirmed'
      AND approved_snapshot = jsonb_build_object('hash',v_case.consent_hash,'amount_cents',25000)) THEN
      RAISE EXCEPTION 'Restricted-role business transaction or consent did not survive: %', v_case.action;
    END IF;
  END LOOP;

  FOR v_case IN SELECT * FROM (VALUES
    ('pathological.after_numeric','00000000-0000-0000-0000-000000000009'::UUID,$payload${"x":1e1000000}$payload$,'after-overflow-consent'),
    ('pathological.after_unicode','00000000-0000-0000-0000-000000000010'::UUID,$payload${"x":"\u0000"}$payload$,'after-unicode-consent')
  ) AS fixture(action,entity_id,payload,consent_hash)
  LOOP
    SELECT * INTO STRICT v_audit FROM public.audit_logs WHERE action = v_case.action;
    IF v_audit.entity_id IS DISTINCT FROM v_case.entity_id
      OR v_audit.before_state IS DISTINCT FROM '{"photoName":"original-before-token","amount_cents":25000,"status":"pending"}'::JSONB
      OR v_audit.after_state IS DISTINCT FROM jsonb_build_object('serialized',v_case.payload,'amount_cents',25000,'status','confirmed') THEN
      RAISE EXCEPTION 'Real second-call error failed to restore both original snapshots: %', v_case.action;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.photo_fence_test_commitments WHERE id = v_case.entity_id
      AND amount_cents = 25000 AND status = 'confirmed'
      AND approved_snapshot = jsonb_build_object('hash',v_case.consent_hash,'amount_cents',25000)) THEN
      RAISE EXCEPTION 'Real second-call error blocked or modified business transaction: %', v_case.action;
    END IF;
  END LOOP;

  SELECT * INTO STRICT v_audit FROM public.audit_logs WHERE action = 'pathological.mixed';
  v_expected := jsonb_build_object(
    'overflow_serialized',$payload${"x":1e1000000}$payload$,
    'unicode_serialized',$payload${"x":"\u0000"}$payload$,
    'amount_cents',25000,
    'photoName','opaque-token',
    'photo_prose','See places/fixture/photos/mixed-token',
    'serialized_photo',$payload${"photoName":"opaque-token","amount_cents":25000}$payload$,
    'independent_image','https://example.com/host.jpg'
  );
  -- Accepted fail-open tradeoff: one bad field restores BOTH whole snapshots,
  -- including otherwise removable sibling photo fields; no partial sanitation.
  IF v_audit.entity_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000007'::UUID
    OR v_audit.before_state IS DISTINCT FROM (v_expected || '{"status":"pending"}'::JSONB)
    OR v_audit.after_state IS DISTINCT FROM (v_expected || '{"status":"confirmed"}'::JSONB) THEN
    RAISE EXCEPTION 'Mixed payload did not restore both whole original snapshots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.photo_fence_test_commitments
    WHERE id = '00000000-0000-0000-0000-000000000007' AND amount_cents = 25000 AND status = 'confirmed'
      AND approved_snapshot = '{"hash":"mixed-consent","amount_cents":25000}'::JSONB) THEN
    RAISE EXCEPTION 'Mixed payload rolled back or modified the restricted-role business transaction';
  END IF;
  RAISE NOTICE 'PASS: overflow, escaped-NUL and malformed serialized strings restore both whole snapshots; restricted-role business writes/consent survive';
END;
$pathological_test$;

-- A normal large/deep snapshot must sanitize completely, never silently pass by
-- taking the trigger fallback. Expected JSON is built independently of the helper.
DO $large_payload_test$
DECLARE
  v_input JSONB;
  v_expected JSONB;
  v_audit public.audit_logs;
  v_level INTEGER;
  v_input_nodes INTEGER;
  v_max_depth INTEGER;
BEGIN
  SELECT jsonb_build_object('records',jsonb_agg(jsonb_build_object(
    'partner_id','partner-' || i,
    'amount_cents',25000 + i,
    'consent',jsonb_build_object('hash','consent-' || i,'approved',true),
    'photoName','opaque-token-' || i,
    'prose','See places/fixture/photos/large-token-' || i,
    'independent_image','https://example.com/host-' || i || '.jpg'
  ) ORDER BY i)) INTO v_input FROM generate_series(1,200) AS g(i);
  SELECT jsonb_build_object('records',jsonb_agg(jsonb_build_object(
    'partner_id','partner-' || i,
    'amount_cents',25000 + i,
    'consent',jsonb_build_object('hash','consent-' || i,'approved',true),
    'prose','See [Google photo omitted]',
    'independent_image','https://example.com/host-' || i || '.jpg'
  ) ORDER BY i)) INTO v_expected FROM generate_series(1,200) AS g(i);
  FOR v_level IN 1..32 LOOP
    v_input := jsonb_build_object('nested',v_input);
    v_expected := jsonb_build_object('nested',v_expected);
  END LOOP;

  -- Count JSON values (objects/arrays/scalars; keys excluded), root at depth zero.
  WITH RECURSIVE nodes(value,depth) AS (
    SELECT v_input, 0
    UNION ALL
    SELECT child.value, nodes.depth + 1
    FROM nodes CROSS JOIN LATERAL (
      SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::JSONB END)
      UNION ALL
      SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value ELSE '[]'::JSONB END)
    ) AS child
  ) SELECT count(*),max(depth) INTO v_input_nodes,v_max_depth FROM nodes;
  IF v_input_nodes <> 1834 OR v_max_depth <> 36 OR v_input IS NOT DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Large fixture shape drifted: nodes=%, max depth=%', v_input_nodes,v_max_depth;
  END IF;

  INSERT INTO public.audit_logs (user_id,action,entity_type,before_state,after_state)
  VALUES ('00000000-0000-0000-0000-000000000001','large.deep.snapshot','plan',v_input,v_input);
  SELECT * INTO STRICT v_audit FROM public.audit_logs WHERE action = 'large.deep.snapshot';
  IF v_audit.before_state IS DISTINCT FROM v_expected OR v_audit.after_state IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Large snapshot was partly sanitized, changed money/consent, or silently fell back to originals';
  END IF;
  RAISE NOTICE 'PASS: large snapshot sanitized in full; records=200, object wrappers=32, input value nodes=%, max depth=% (root=0)',
    v_input_nodes,v_max_depth;
END;
$large_payload_test$;

-- Exercise the trigger's sole exception guard with an injected unexpected error:
-- the first call rewrites before_state, then the second unexpectedly throws.
-- Replace the helper only inside this disposable transaction and restore it.
DO $trigger_fallback_test$
DECLARE
  v_helper_definition TEXT := pg_get_functiondef('private.strip_google_photo_audit_json(jsonb)'::REGPROCEDURE);
  v_before JSONB := '{"photoName":"original-before-token","amount_cents":25000}';
  v_after JSONB := '{"force_fixture_error":true,"amount_cents":25000}';
  v_audit public.audit_logs;
BEGIN
  EXECUTE $stub$
    CREATE OR REPLACE FUNCTION private.strip_google_photo_audit_json(p_value JSONB)
    RETURNS JSONB LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
    AS $body$
    BEGIN
      IF p_value ? 'force_fixture_error' THEN
        RAISE EXCEPTION 'Disposable fixture: unexpected second-call error';
      END IF;
      RETURN '{"first_call_rewritten":true}'::JSONB;
    END;
    $body$;
  $stub$;

  INSERT INTO public.audit_logs (user_id,action,entity_type,before_state,after_state)
  VALUES ('00000000-0000-0000-0000-000000000001','wrapper.fallback','plan',v_before,v_after);
  SELECT * INTO STRICT v_audit FROM public.audit_logs WHERE action = 'wrapper.fallback';
  IF v_audit.before_state IS DISTINCT FROM v_before OR v_audit.after_state IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Unexpected second-call error left a partially rewritten or missing audit row';
  END IF;
  EXECUTE v_helper_definition;
  IF private.strip_google_photo_audit_json(v_before) IS DISTINCT FROM '{"amount_cents":25000}'::JSONB THEN
    RAISE EXCEPTION 'Real sanitizer was not restored after disposable fault injection';
  END IF;
  RAISE NOTICE 'PASS: unexpected second-call failure restores both original snapshots; real sanitizer restored';
END;
$trigger_fallback_test$;
ROLLBACK;
