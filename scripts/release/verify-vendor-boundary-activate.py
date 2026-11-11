#!/usr/bin/env python3
"""C2 ACTIVATE: disposable native PG17 boundary and concurrency proofs.

Creates its own socket-only cluster, never accepts a target connection, and
ignores ambient PostgreSQL configuration. This representative schema proof is
separate from the required complete Supabase replay and realized RLS workflow.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('expand_proof', Path(__file__).with_name('verify-vendor-boundary-expand.py'))
expand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(expand)
MIGRATION = ROOT / 'supabase/migrations/20260922000006_activate_vendor_discovery_boundary.sql'
SETUP = Path(__file__).with_suffix('.sql')
CHECKS = Path(__file__).with_name('verify-vendor-boundary-activate-checks.sql')
AT_RISK = ('admin_audit_log','admin_tasks','agent_actions','agent_runs','approvals','audit_logs',
           'discovery_change_log','discovery_vendors','outreach_messages','outreach_threads',
           'plan_messages','plan_revisions','plan_versions','plans','recommendations','templates','vendor_bookings')


class Proof(expand.Proof):
    def __init__(self, pg):
        self.pg = pg.resolve()
        self.tmp = Path(tempfile.mkdtemp(prefix='3p-c2-activate-', dir='/tmp'))
        self.sock = self.tmp / 'socket'
        self.sock.mkdir(mode=0o700)
        for name in ('empty.pgpass','empty.pg_service.conf'):
            (self.tmp/name).touch(mode=0o600)
        self.env = {'PATH':f'{self.pg}:/usr/bin:/bin','LC_ALL':'C',
                    'PGPASSFILE':str(self.tmp/'empty.pgpass'),'PGSERVICEFILE':str(self.tmp/'empty.pg_service.conf')}
        self.out = ROOT/'test-results/ws2a-b3-c2-activate-resume/focused'
        self.out.mkdir(parents=True,exist_ok=True)
        self.log = (self.out/'disposable-pg.log').open('w')
        self.db = 'postgres'; self.started = False; self.processes = []; self.hashes = {}
        self.result = {'status':'FAIL','local_only':True,'tcp_listener':False,
                       'representative_schema_real_functions':True,'checks':[]}

    def clone(self, name):
        self.db = 'postgres'
        self.query(f'CREATE DATABASE {name} TEMPLATE c2_baseline;')
        self.db = name

    def apply(self, migration, expected=None, suffix=''):
        return self.query('BEGIN;\n'+migration+"\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20260922000006','activate_vendor_discovery_boundary') ON CONFLICT(version) DO NOTHING;\n"+suffix+'\nCOMMIT;',expected)

    def bootstrap_races(self, migration):
        self.clone('c2_insert_after_lock')
        apply = self.async_sql('c2_empty_apply', 'BEGIN;\n'+migration+'\nSELECT pg_sleep(2); COMMIT;')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_empty_apply' AND wait_event='PgSleep');")
        insert = self.async_sql('c2_empty_insert', "INSERT INTO public.plans(metadata) VALUES('{\"target_type\":\"discovery_vendor\",\"target_id\":\"cccccccc-cccc-4ccc-8ccc-cccccccccccc\",\"provider\":\"Unproven\"}');")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_empty_insert' AND wait_event_type='Lock');")
        self.finish(apply)
        self.finish(insert, 'vendor_boundary_unproven_vendor_fact')
        self.query("SELECT fixture.assert_true(NOT EXISTS(SELECT FROM public.plans),'blocked insert sees installed guard and leaves no row');")
        self.mark('empty replay locks tables through commit; a waiting unsafe insert sees the new boundary')

        self.clone('c2_insert_before_lock')
        writer = self.async_sql('c2_prelock_writer', 'BEGIN; INSERT INTO public.plans(id) VALUES(gen_random_uuid()); SELECT pg_sleep(2); COMMIT;')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_prelock_writer' AND wait_event='PgSleep');")
        apply = self.async_sql('c2_prelock_apply', 'BEGIN;\n'+migration+'\nCOMMIT;')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_prelock_apply' AND wait_event_type='Lock');")
        self.finish(writer)
        self.finish(apply, '55000')
        self.query("SELECT fixture.assert_true(has_table_privilege('service_role','public.discovery_vendors','UPDATE'),'pre-lock committed writer makes apply refuse before ACL changes');")
        self.mark('writer committed while empty replay waited is visible to the post-lock EXISTS discriminator')

        self.clone('c2_reopen_race')
        self.query("UPDATE public.release_runtime_controls SET state='paused' WHERE control_key='write_pause';")
        apply = self.async_sql('c2_pause_apply', 'BEGIN;\n'+migration+'\nSELECT pg_sleep(2); COMMIT;')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_pause_apply' AND wait_event='PgSleep');")
        reopen = self.async_sql('c2_pause_reopen', "UPDATE public.release_runtime_controls SET state='open' WHERE control_key='write_pause';")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_pause_reopen' AND wait_event_type='Lock');")
        self.finish(apply)
        self.finish(reopen)
        self.query("SELECT fixture.assert_true((SELECT state='open' FROM public.release_runtime_controls WHERE control_key='write_pause'),'waiting reopen finishes only after migration commits');")
        self.mark('FOR SHARE on pause control blocks concurrent reopen until the atomic apply commits')

    def execute(self):
        try:
            version = self.run([self.pg/'postgres','--version'])
            self.result['postgres_version'] = version
            if not re.search(r'PostgreSQL\) 17\.',version): raise RuntimeError('PG17 required')
            baseline = self.flatten(expand.BASELINE)
            if not baseline.rstrip().endswith('ROLLBACK;'): raise RuntimeError('C1 fixture rollback boundary changed')
            baseline = baseline.rstrip()[:-len('ROLLBACK;')]+'COMMIT;\n'
            setup, checks, migration = self.flatten(SETUP), self.flatten(CHECKS), self.read(MIGRATION)
            self.run([self.pg/'initdb','-D',self.tmp/'data','-U','postgres','--auth=trust','--no-locale','--encoding=UTF8'])
            self.run([self.pg/'pg_ctl','-D',self.tmp/'data','-l',self.tmp/'server.log','-o',
                      f"-c listen_addresses='' -c unix_socket_permissions=0700 -k {self.sock} -p 55443",'-w','start'])
            self.started = True
            if self.query('SHOW listen_addresses;'): raise RuntimeError('Unexpected TCP listener')
            self.query('CREATE DATABASE c2_baseline;'); self.db='c2_baseline'
            self.query(baseline)
            self.query("SELECT set_config('fixture.repo_root','"+str(ROOT).replace("'","''")+"',false);\n"+setup)
            # Every table is tested independently. No inferred production marker
            # or fixture-controlled feature flag substitutes for actual rows.
            for index,table in enumerate(AT_RISK):
                self.clone(f'c2_populated_{index}')
                self.query(f'INSERT INTO public.{table}(id) VALUES(gen_random_uuid());')
                self.apply(migration,'55000')
                self.query("SELECT fixture.assert_true(NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20260922000006'),'failed populated apply leaves ledger unchanged');")
                self.mark(f'{table}: sole populated table rejects unpaused ACTIVATE with 55000')
            self.clone('c2_empty')
            # Simulate inherited column grants: table-only REVOKE is insufficient.
            self.query('GRANT SELECT(name),UPDATE(name),INSERT(name),REFERENCES(name) ON public.discovery_vendors TO PUBLIC,anon,authenticated,service_role;')
            self.apply(migration)
            self.mark('fresh empty unpaused representative schema applies atomically')
            self.query(checks)
            self.query("UPDATE public.release_runtime_controls SET state='paused' WHERE control_key='write_pause';")
            catalog = "SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND prokind='f';"
            before = self.query(catalog); self.apply(migration); after = self.query(catalog)
            if before != after: raise RuntimeError('Idempotence changed definitions or ACLs')
            self.mark('paused populated reapplication preserves all routine definitions and ACLs')
            self.clone('c2_rollback')
            self.apply(migration,'22012','SELECT 1/0;')
            self.query("SELECT fixture.assert_true(has_table_privilege('service_role','public.discovery_vendors','UPDATE') AND NOT EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE version='20260922000006') AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='fence_vendor_booking_durable_snapshot'),'injected outer-transaction failure rolls back DDL ACL and ledger');")
            self.mark('injected failure rolls back complete migration and ledger')
            self.bootstrap_races(migration)
            self.result['status']='PASS'
        except Exception as exc:
            self.result['error']=str(exc)
        finally:
            for process in self.processes:
                if process.poll() is None: process.terminate(); process.wait(timeout=5)
                if process.stdout: self.log.write(process.stdout.read())
            stopped=not self.started
            if self.started:
                try: self.run([self.pg/'pg_ctl','-D',self.tmp/'data','-m','fast','-w','stop']); stopped=True
                except Exception as exc: self.result['cleanup_error']=str(exc); self.result['status']='FAIL'
            self.log.close()
            if stopped: shutil.rmtree(self.tmp)
            self.result['cluster_stopped_removed']=stopped and not self.tmp.exists()
            self.result['source_sha256']=self.hashes
            self.result['fixture_pass_labels']=(self.out/'disposable-pg.log').read_text().count('PASS:')
            (self.out/'disposable-pg-results.json').write_text(json.dumps(self.result,indent=2)+'\n')
        print(json.dumps({k:v for k,v in self.result.items() if k!='source_sha256'},indent=2))
        return 0 if self.result['status']=='PASS' else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin',type=Path,default=Path('/opt/homebrew/opt/postgresql@17/bin'))
    raise SystemExit(Proof(parser.parse_args().pg_bin).execute())
