-- Use the actual Phase-4 control table, coherence trigger, RLS and ACL definition.
-- Business pause triggers are outside this representative fixture; C1 does not change them.
DO $load_pause$
DECLARE v_source text;
BEGIN
  v_source := pg_read_file(current_setting('fixture.repo_root') || '/supabase/migrations/20260709100000_add_write_pause_control.sql');
  IF strpos(v_source,'-- Middleware is the user-facing chokepoint')=0 THEN RAISE EXCEPTION 'Pause definition changed'; END IF;
  EXECUTE split_part(v_source,'-- Middleware is the user-facing chokepoint',1);
  v_source := substr(v_source, strpos(v_source,'CREATE OR REPLACE FUNCTION public.transition_release_runtime_control('));
  EXECUTE split_part(v_source, '$$;', 1) || '$$;';
END;
$load_pause$;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20260922000001','fence_new_audit_google_photo_snapshots');
