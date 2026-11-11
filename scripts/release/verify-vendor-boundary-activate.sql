-- Representative local schema additions for the C2 ACTIVATE proof.
-- The runner alone creates the disposable socket-only cluster. Full Supabase
-- migration replay and the realized RLS workflow are separate required proofs.
\ir verify-vendor-boundary-expand.sql
\ir ../../supabase/migrations/20260922000005_expand_vendor_discovery_boundary.sql

-- Load the exact existing concierge bodies that ACTIVATE narrowly patches.
DO $load_concierge$
DECLARE src text; definition text; function_name text;
BEGIN
  src := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709160000_complete_concierge_execution.sql');
  FOREACH function_name IN ARRAY ARRAY['complete_admin_task_execution','cancel_admin_task_execution'] LOOP
    definition := split_part(substr(src,strpos(src,'CREATE OR REPLACE FUNCTION public.'||function_name||'(')),'$function$;',1)||'$function$;';
    EXECUTE definition;
  END LOOP;
END;
$load_concierge$;

ALTER TABLE public.vendor_bookings ADD discovery_vendor_id uuid,
  ADD status text, ADD metadata jsonb, ADD provider_name text,
  ADD plan_id uuid, ADD approved_terms_snapshot jsonb;
ALTER TABLE public.vendor_profiles ADD name text, ADD contact_email text, ADD user_id uuid;
ALTER TABLE public.outreach_threads ADD target_id uuid, ADD discovery_vendor_id uuid, ADD channel text;
ALTER TABLE public.outreach_messages ADD provider_message_id text, ADD provider_metadata_json jsonb,
  ADD body_html text, ADD attachments_json jsonb, ADD transcript_text text, ADD gmail_message_id text,
  ADD gmail_thread_id text, ADD sent_manually boolean, ADD delivery_status text, ADD sent_at timestamptz,
  ADD rfc_message_id text, ADD updated_at timestamptz;
CREATE TABLE public.creator_email_accounts(id uuid DEFAULT gen_random_uuid(),user_id uuid,
  provider text,email_address text,revoked_at timestamptz);
ALTER TABLE public.admin_tasks ADD plan_id uuid, ADD event_id uuid, ADD assigned_to uuid,
  ADD task_type text, ADD priority text, ADD due_at timestamptz, ADD completed_at timestamptz,
  ADD created_at timestamptz, ADD updated_at timestamptz, ADD metadata jsonb,
  ADD outcome_payload jsonb, ADD notes text, ADD description text;
GRANT ALL ON public.vendor_bookings TO service_role;

-- The retained C1 fixture has historical rows; an empty bootstrap proof must
-- genuinely remove them rather than quietly relying on an enabled pause.
TRUNCATE public.plans,public.plan_messages,public.plan_versions,public.plan_revisions,
 public.recommendations,public.approvals,public.agent_actions,public.admin_tasks,
 public.audit_logs,public.admin_audit_log,public.templates,public.agent_runs,
 public.discovery_change_log,public.outreach_threads,public.outreach_messages,
 public.discovery_vendors,public.vendor_bookings CASCADE;
UPDATE public.release_runtime_controls SET state='open' WHERE control_key='write_pause';

CREATE TABLE fixture.pre_activate_functions AS SELECT oid,pg_get_functiondef(oid) definition,proacl
 FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND prokind='f';
CREATE TABLE fixture.pre_activate_triggers AS SELECT tgrelid,tgname,pg_get_triggerdef(oid) definition
 FROM pg_trigger WHERE NOT tgisinternal;
CREATE TABLE fixture.sink_contract(table_name text PRIMARY KEY,column_name text);
INSERT INTO fixture.sink_contract VALUES
 ('plans','metadata'),('plan_messages','metadata'),('plan_versions','payload'),
 ('plan_revisions','trigger_payload'),('recommendations','metadata'),('approvals','snapshot_json'),
 ('agent_actions','payload_json'),('admin_tasks','payload'),('audit_logs','after_state'),
 ('admin_audit_log','payload'),('templates','payload'),('agent_runs','payload'),
 ('discovery_change_log','new_value'),('outreach_threads','channel_strategy'),('outreach_messages','headers_json');

CREATE FUNCTION fixture.expect_rejected(sql text,label text,expected text DEFAULT 'vendor_boundary_%') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE expected THEN RAISE; END IF;
    RAISE NOTICE 'PASS: % [%]',label,SQLERRM; RETURN;
  END;
  RAISE EXCEPTION 'FAIL: accepted %',label;
END;
$$;
