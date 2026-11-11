#!/usr/bin/env python3
"""C2 EXPAND proof: local disposable PG17 only, no connection target/ambient secrets.

Builds on C1's representative schema and REAL production function definitions.
This is not a full Supabase migration replay, hosted proof, or provider test.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20260922000005_expand_vendor_discovery_boundary.sql'
BASELINE = ROOT / 'scripts/release/verify-venue-persistence-boundary.sql'
SETUP = ROOT / 'scripts/release/verify-vendor-boundary-expand.sql'
CHECKS = ROOT / 'scripts/release/verify-vendor-boundary-expand-checks.sql'
INCLUDE = re.compile(r'(?m)^\\ir\s+(.+?)\s*$')


class Proof:
    def __init__(self, pg):
        self.pg = pg.resolve()
        self.tmp = Path(tempfile.mkdtemp(prefix='3p-c2-expand-', dir='/tmp'))
        self.sock = self.tmp / 'socket'
        self.sock.mkdir(mode=0o700)
        for name in ('empty.pgpass', 'empty.pg_service.conf'):
            (self.tmp / name).touch(mode=0o600)
        self.env = {'PATH': f'{self.pg}:/usr/bin:/bin', 'LC_ALL': 'C',
                    'PGPASSFILE': str(self.tmp / 'empty.pgpass'),
                    'PGSERVICEFILE': str(self.tmp / 'empty.pg_service.conf')}
        self.out = ROOT / 'test-results/ws2a-b3-c2-part1/expand'
        self.out.mkdir(parents=True, exist_ok=True)
        self.log = (self.out / 'disposable-pg.log').open('w')
        self.db = 'postgres'
        self.started = False
        self.processes = []
        self.hashes = {}
        self.result = {'status': 'FAIL', 'local_only': True, 'tcp_listener': False,
                       'representative_schema_real_functions': True, 'checks': []}

    def read(self, path):
        path = path.resolve()
        text = path.read_text()
        self.hashes[str(path.relative_to(ROOT))] = hashlib.sha256(text.encode()).hexdigest()
        return text

    def flatten(self, path):
        text = self.read(path)
        return INCLUDE.sub(lambda m: self.flatten((path.parent / m.group(1).strip("'\"")).resolve()), text)

    def run(self, args, sql=None, expected=None):
        p = subprocess.run([str(a) for a in args], input=sql, cwd=ROOT, env=self.env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
        self.log.write(p.stdout)
        self.log.flush()
        if expected:
            if p.returncode == 0 or expected not in p.stdout:
                raise RuntimeError(f'Expected {expected}: see disposable-pg.log')
        elif p.returncode:
            raise RuntimeError('Disposable command failed: see disposable-pg.log')
        return p.stdout.strip()

    def psql(self):
        return [self.pg / 'psql', '-X', '--no-password', '-h', self.sock, '-p', '55443', '-U', 'postgres',
                '-d', self.db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-Atq']

    def query(self, sql, expected=None):
        return self.run(self.psql(), sql, expected)

    def mark(self, label):
        self.result['checks'].append(label)
        self.log.write(f'PASS: {label}\n')
        self.log.flush()

    def async_sql(self, name, sql):
        p = subprocess.Popen([str(a) for a in self.psql()], cwd=ROOT, env=self.env,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        p.stdin.write(f"SET application_name='{name}';\n" + sql)
        p.stdin.close()
        self.processes.append(p)
        return p

    def wait_for(self, sql):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if self.query(sql) == 't':
                return
            time.sleep(.05)
        raise RuntimeError('Bounded concurrency condition not reached')

    def finish(self, p, expected=None):
        p.wait(timeout=12)
        output = p.stdout.read()
        self.log.write(output)
        self.log.flush()
        if expected:
            if p.returncode == 0 or expected not in output:
                raise RuntimeError(f'Concurrency expected {expected}')
        elif p.returncode:
            raise RuntimeError('Concurrency command failed')

    def race(self, case_id, direct):
        kind = 'direct_nonkey' if direct else 'rpc_facts'
        name = 'c2_' + kind
        holder = self.async_sql(name + '_stage', f"""BEGIN;
SET LOCAL ROLE service_role;
SELECT fixture.stage({case_id});
SELECT pg_sleep(3);
COMMIT;
""")
        self.wait_for(f"SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='{name}_stage' AND wait_event='PgSleep');")
        change = ("UPDATE public.discovery_vendors SET name='Changed after stage' WHERE source_external_id='c2_fixture';" if direct else
                  "SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),"
                  "'{\"name\":\"Changed after stage\"}',jsonb_build_object('name',fixture.evidence()));")
        writer = self.async_sql(name + '_writer', 'SET ROLE service_role;\n' + change)
        self.wait_for(f"SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='{name}_writer' AND wait_event_type='Lock');")
        self.finish(holder)
        self.finish(writer)
        self.query(f"SELECT fixture.assert_true((SELECT provider='Independent DJ' FROM public.approvals WHERE id=(SELECT approval_id FROM fixture.stage_inputs WHERE case_id={case_id})), 'stage retained checked value while writer blocked');")
        stale_case = case_id + 1
        self.query(f'SELECT fixture.stage({stale_case});', 'vendor_boundary_stage_fact_changed')
        self.query(f"SELECT fixture.assert_true(NOT EXISTS(SELECT FROM public.agent_actions WHERE plan_id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id={stale_case})) AND NOT EXISTS(SELECT FROM public.approvals WHERE plan_id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id={stale_case})) AND NOT EXISTS(SELECT FROM public.plan_messages WHERE plan_id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id={stale_case})), 'stale concurrent input made no durable action');")
        self.query("SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),'{\"name\":\"Independent DJ\"}',jsonb_build_object('name',fixture.evidence()));")
        self.mark(f'{kind}: fact writer blocks through delegated staging; stale reviewed input rejected before mutation')

    def writer_first(self, case_id, direct):
        name = 'c2_first_' + ('direct' if direct else 'rpc')
        change = ("UPDATE public.discovery_vendors SET name='Changed before stage' WHERE source_external_id='c2_fixture';" if direct else
                  "SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),"
                  "'{\"name\":\"Changed before stage\"}',jsonb_build_object('name',fixture.evidence()));")
        writer = self.async_sql(name + '_writer', 'BEGIN; SET LOCAL ROLE service_role;\n' + change + '\nSELECT pg_sleep(3); COMMIT;')
        self.wait_for(f"SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='{name}_writer' AND wait_event='PgSleep');")
        stage = self.async_sql(name + '_stage', f'SET ROLE service_role; SELECT fixture.stage({case_id});')
        self.wait_for(f"SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='{name}_stage' AND wait_event_type='Lock');")
        self.finish(writer)
        self.finish(stage, 'vendor_boundary_stage_fact_changed')
        self.query(f"SELECT fixture.assert_true(NOT EXISTS(SELECT FROM public.agent_actions WHERE plan_id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id={case_id})), 'writer-first stage rejected before action');")
        self.query("SELECT public.write_discovery_vendor_independent_facts((SELECT id FROM public.discovery_vendors WHERE source_external_id='c2_fixture'),'{\"name\":\"Independent DJ\"}',jsonb_build_object('name',fixture.evidence()));")
        self.mark(f'{name}: in-flight fact change blocks stage then changed evidence fails before mutation')

    def plan_first(self):
        holder = self.async_sql('c2_plan_holder', "BEGIN; SELECT id FROM public.plans WHERE id=(SELECT plan_id FROM fixture.stage_inputs WHERE case_id=12) FOR UPDATE; SELECT pg_sleep(3); COMMIT;")
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_plan_holder' AND wait_event='PgSleep');")
        stage = self.async_sql('c2_plan_stage', 'SET ROLE service_role; SELECT fixture.stage(12);')
        self.wait_for("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='c2_plan_stage' AND wait_event_type='Lock');")
        self.query("SET lock_timeout='500ms'; SET ROLE service_role; UPDATE public.discovery_vendors SET name='Changed while plan locked' WHERE source_external_id='c2_fixture';")
        self.finish(holder)
        self.finish(stage, 'vendor_boundary_stage_fact_changed')
        self.mark('plan-first ordering: vendor remains unlocked while gateway waits for plan; latest changed fact rejected')

    def execute(self):
        try:
            version = self.run([self.pg / 'postgres', '--version'])
            self.result['postgres_version'] = version
            if not re.search(r'PostgreSQL\) 17\.', version):
                raise RuntimeError('PG17 required')
            baseline = self.flatten(BASELINE)
            if not baseline.rstrip().endswith('ROLLBACK;'):
                raise RuntimeError('C1 fixture rollback boundary changed')
            baseline = baseline.rstrip()[:-len('ROLLBACK;')] + 'COMMIT;\n'
            setup, checks, migration = self.read(SETUP), self.read(CHECKS), self.read(MIGRATION)
            for referenced in re.findall(r"'(/supabase/migrations/[^']+\.sql)'", baseline + setup):
                self.read(ROOT / referenced.lstrip('/'))
            self.run([self.pg / 'initdb', '-D', self.tmp / 'data', '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8'])
            self.run([self.pg / 'pg_ctl', '-D', self.tmp / 'data', '-l', self.tmp / 'server.log', '-o',
                      f"-c listen_addresses='' -c unix_socket_permissions=0700 -k {self.sock} -p 55443", '-w', 'start'])
            self.started = True
            if self.query('SHOW listen_addresses;'):
                raise RuntimeError('Unexpected TCP listener')
            self.query(baseline)
            self.query("SELECT set_config('fixture.repo_root','" + str(ROOT).replace("'", "''") + "',false);\n" + setup)
            self.query('BEGIN;\n' + migration + '\nCOMMIT;')
            self.mark('EXPAND applies to empty vendor schema with actual C1 functions present')
            self.query(checks)
            self.mark('populated old/new compatibility, permissions, provenance, exact retry and signed snapshot checks')
            before = self.query("SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND prokind='f';")
            self.query('BEGIN;\n' + migration + '\nCOMMIT;')
            after = self.query("SELECT md5(string_agg(pg_get_functiondef(oid)||coalesce(proacl::text,''),'' ORDER BY oid)) FROM pg_proc WHERE pronamespace IN ('public'::regnamespace,'private'::regnamespace) AND prokind='f';")
            if before != after:
                raise RuntimeError('Idempotent reapply changed routine definitions/ACLs')
            self.mark('populated migration reapplication idempotent; existing C1 definitions/grants remain byte-identical')
            for role in ('anon', 'authenticated'):
                for call in ('SELECT * FROM public.discovery_vendors_safe LIMIT 1;',
                             "SELECT public.upsert_discovery_vendor_identity('denied');",
                             "SELECT public.write_discovery_vendor_independent_facts(null,'{}','{}');",
                             "SELECT public.stage_vendor_quote_booking_checked(null,null,'vendor',null,null,null,null,'{}','{}',null);"):
                    self.query(f'SET ROLE {role};\n' + call, '42501')
            self.mark('real anon/authenticated safe-view and all 3 RPC calls denied with clean 42501')
            self.race(4, True)
            self.race(6, False)
            self.writer_first(8, True)
            self.writer_first(10, False)
            self.plan_first()
            catalog = self.query("SELECT jsonb_build_object('columns',(SELECT jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udt_name',udt_name,'nullable',is_nullable='YES') ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='discovery_vendors_safe'),'functions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid),'security_definer',prosecdef,'search_path',proconfig) ORDER BY proname) FROM pg_proc WHERE proname IN ('upsert_discovery_vendor_identity','write_discovery_vendor_independent_facts','stage_vendor_quote_booking_checked')));")
            (self.out / 'catalog.json').write_text(json.dumps(json.loads(catalog), indent=2)+'\n')
            # A separate database proves FIRST application with retained vendor
            # rows; this is not merely applying twice after the empty case.
            self.query('CREATE DATABASE c2_populated;')
            self.db = 'c2_populated'
            shared_roles_baseline = re.sub(r'(?m)^CREATE ROLE (anon|authenticated|service_role);$', '', baseline)
            self.query(shared_roles_baseline)
            self.query("SELECT set_config('fixture.repo_root','" + str(ROOT).replace("'", "''") + "',false);\n" + setup)
            self.query("INSERT INTO public.discovery_vendors(source,source_external_id,name,service_type,photos,website) VALUES('google_places','retained_legacy','Retained old name','dj','[{\"name\":\"places/legacy/photos/token\"}]','https://old.example'); CREATE TABLE fixture.retained AS SELECT to_jsonb(v) value FROM public.discovery_vendors v;")
            self.query('BEGIN;\n' + migration + '\nCOMMIT;')
            self.query("SELECT fixture.assert_true((SELECT to_jsonb(v)-'field_provenance'=(SELECT value FROM fixture.retained) FROM public.discovery_vendors v WHERE source_external_id='retained_legacy'), 'populated first apply retains legacy values without purge'); SELECT fixture.assert_true((SELECT name IS NULL AND website IS NULL AND photos='[]'::jsonb FROM public.discovery_vendors_safe WHERE source_external_id='retained_legacy'), 'populated first apply masks retained Google fields');")
            self.query(checks)
            self.mark('separate populated FIRST apply preserves historical values; old and new paths pass with C1 boundary present')
            self.result['status'] = 'PASS'
        except Exception as exc:
            self.result['error'] = str(exc)
        finally:
            for p in self.processes:
                if p.poll() is None:
                    p.terminate()
                    p.wait(timeout=5)
                if p.stdout:
                    self.log.write(p.stdout.read())
            stopped = not self.started
            if self.started:
                try:
                    self.run([self.pg / 'pg_ctl', '-D', self.tmp / 'data', '-m', 'fast', '-w', 'stop'])
                    stopped = True
                except Exception as exc:
                    self.result['status'] = 'FAIL'
                    self.result['cleanup_error'] = str(exc)
            self.log.close()
            if stopped:
                shutil.rmtree(self.tmp)
            self.result['cluster_stopped_removed'] = stopped and not self.tmp.exists()
            self.result['source_sha256'] = self.hashes
            self.result['fixture_pass_labels'] = (self.out / 'disposable-pg.log').read_text().count('PASS:')
            (self.out / 'disposable-pg-results.json').write_text(json.dumps(self.result, indent=2)+'\n')
        print(json.dumps({k: v for k, v in self.result.items() if k != 'source_sha256'}, indent=2))
        return 0 if self.result['status'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, default=Path('/opt/homebrew/opt/postgresql@17/bin'))
    args = parser.parse_args()
    raise SystemExit(Proof(args.pg_bin).execute())
