#!/usr/bin/env python3
"""Actual-PG D proofs. Only the named, disposable local Docker DB is accepted.

Synthetic cohort proof replaces hash literals only, never migration operations.
Empty historical-cohort replay also executes the original file byte-for-byte.
"""
import argparse
import copy
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results/d-historical-purge/disposable'
RUNTIME = OUT / 'fixture-runtime'
CONTAINER = 'supabase_db_d-historical-purge-fixture-20261111'
MIGRATION = ROOT / 'supabase/migrations/20260922000007_purge_legacy_venue_discovery_content.sql'
HASH_KEYS = ('prehash', 'posthash', 'preserved_hash')
ENV = {'PATH':'/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
       'DOCKER_HOST':'unix:///Users/chrisredd/.docker/run/docker.sock',
       'DOCKER_CONFIG':str(RUNTIME/'docker-config')}
TABLES = ('agent_runs','discovery_venues','plan_discovery_venue_candidates','plan_messages','recommendations')
PROTECTED = ('approvals','agent_actions','venue_bookings','vendor_bookings','event_financial_summary',
 'event_sales_data','events','plans','discovery_venue_events','discovery_venue_signals','venue_contact_profiles',
 'venue_outreach_responses','outreach_threads','supply_scout_venue_leads','discovery_change_log','audit_logs',
 'plan_derived_state','plan_versions','admin_tasks','template_runs','app_jobs')


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def js(value):
    return literal(json.dumps(value,separators=(',',':'))) + '::jsonb'


class Proof:
    def __init__(self):
        OUT.mkdir(parents=True,exist_ok=True)
        self.db = 'postgres'
        self.results = []
        self.serial = 0

    def command(self):
        assert self.db == 'postgres' or re.fullmatch('d162_[a-z0-9_]+',self.db)
        return ['docker','exec','-i',CONTAINER,'psql','-X','--no-password','-U','postgres',
                '-d',self.db,'-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']

    def sql(self, sql, expected=None, label='sql'):
        self.serial += 1
        p = subprocess.run(self.command(),input=sql,text=True,capture_output=True,env=ENV)
        self.last_error=p.stderr
        (OUT/f'{self.serial:03}-{label}.log').write_text(p.stdout+p.stderr)
        if expected:
            assert p.returncode != 0 and re.search(r'ERROR:\s+'+expected+r':',p.stderr),p.stderr[-3500:]
        else:
            assert p.returncode == 0,p.stderr[-3500:]
        return p.stdout.strip()

    def value(self, sql):
        return json.loads(self.sql(sql))

    def check(self, condition, label):
        assert condition,label
        self.results.append(label)
        print('PASS:',label,flush=True)

    def rows(self, table):
        assert table in TABLES+PROTECTED
        return self.value(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM public.{table} t;")

    def snapshot(self):
        entries=','.join(literal(table)+f",(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM public.{table} t)" for table in TABLES+PROTECTED)
        return self.value('SELECT jsonb_build_object('+entries+');')

    def canonical(self, values):
        return self.value(f"SELECT coalesce(jsonb_agg(v::text ORDER BY n),'[]') FROM jsonb_array_elements({js(values)}) WITH ORDINALITY e(v,n);")

    def hashes(self, values):
        return self.value(f"SELECT jsonb_agg(encode(sha256(convert_to((v-'updated_at')::text,'UTF8')),'hex') ORDER BY n) FROM jsonb_array_elements({js(values)}) WITH ORDINALITY e(v,n);")

    def clone(self,name,source='postgres'):
        assert re.fullmatch('d162_[a-z0-9_]+',name)
        assert source=='postgres' or re.fullmatch('d162_[a-z0-9_]+',source)
        command=['docker','exec','-i',CONTAINER,'psql','-X','--no-password','-U','supabase_admin',
                 '-d','template1','-Atq','-v','ON_ERROR_STOP=1']
        # Background pg_net/pg_cron connections otherwise prevent cloning.
        # All objects and settings belong solely to this disposable container.
        sql=f"ALTER DATABASE {source} ALLOW_CONNECTIONS false; SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{source}'; DROP DATABASE IF EXISTS {name} WITH (FORCE); CREATE DATABASE {name} TEMPLATE {source};"
        try:
            p=subprocess.run(command,input=sql,text=True,capture_output=True,env=ENV)
            assert p.returncode==0,p.stderr
        finally:
            subprocess.run(command,input=f'ALTER DATABASE {source} ALLOW_CONNECTIONS true;',text=True,capture_output=True,env=ENV,check=True)

    def render(self):
        original=MIGRATION.read_text()
        match=re.search(r'\$reviewed_manifest\$(.*?)\$reviewed_manifest\$',original,re.S)
        assert match
        manifest=json.loads(match.group(1))
        before={row['id']:row for table in TABLES for row in self.rows(table)}
        self.expected={};triplets=[]
        for spec in manifest:
            pre=before[spec['id']]
            post=copy.deepcopy(pre);kept=copy.deepcopy(pre)
            for serial in spec['serialized']:
                path=serial['path']
                write(post,path,json.loads(read(post,path)))
                write(kept,path,json.loads(read(kept,path)))
            for path in spec['remove']:
                erase(post,path);erase(kept,path)
            for operation in spec['set']:
                write(post,operation['path'],operation['value']);erase(kept,operation['path'])
            for serial in spec['serialized']:
                path=serial['path'];inner=read(post,path);keep=read(kept,path)
                for p in serial['remove']: erase(inner,p);erase(keep,p)
                for op in serial['set']: write(inner,op['path'],op['value']);erase(keep,op['path'])
                # PostgreSQL canonical JSON text is an intrinsic serialization,
                # not the migration's projection implementation.
                canonical=self.canonical([inner,keep])
                write(post,path,canonical[0]);write(kept,path,canonical[1])
            self.expected[spec['id']]=post
            triplets.extend((pre,post,kept))
        hashes=self.hashes(triplets)
        fake=match.group(1)
        for i,spec in enumerate(manifest):
            for n,key in enumerate(HASH_KEYS):
                old=spec[key];new=hashes[i*3+n]
                # Exact existing token replacement, all IDs/paths/values unchanged.
                needle='"'+key+'": "'+old+'"'
                assert fake.count(needle)==1,(key,spec['id'])
                fake=fake.replace(needle,'"'+key+'": "'+new+'"',1)
                spec[key]=new
        rendered=original[:match.start(1)]+fake+original[match.end(1):]
        erase_hashes=lambda text:re.sub(r'("(?:prehash|posthash|preserved_hash)": )"[0-9a-f]{64}"',r'\1"HASH"',text)
        self.check(erase_hashes(rendered)==erase_hashes(original),'only 339 reviewed manifest hash literals substituted')
        self.manifest=manifest;self.rendered=rendered
        (OUT/'synthetic162.sql').write_text(rendered)
        (OUT/'independent-expected-after.json').write_text(json.dumps(self.expected,indent=2))
        (OUT/'synthetic-manifest.json').write_text(json.dumps(manifest,indent=2))

    def apply(self, suffix='', expected=None, original=False):
        sql=MIGRATION.read_text() if original else self.rendered
        return self.sql('BEGIN;\n'+sql+"\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20260922000007','purge_legacy_venue_discovery_content') ON CONFLICT(version) DO NOTHING;\n"+suffix+'\nCOMMIT;',expected,label='apply162')

    def contacts(self):
        return self.value("SELECT jsonb_agg(jsonb_build_object('id',id,'emails',s->'extracted_emails','forms',s->'extracted_contact_forms','organizer',s->'organizer_provided_emails') ORDER BY id) FROM public.discovery_venues t CROSS JOIN LATERAL (SELECT private.discovery_venue_safe_json(to_jsonb(t)) s) q;")

    def catalog(self):
        return self.value("SET search_path=pg_catalog; SELECT jsonb_build_object('triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)) ORDER BY n.nspname,c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),'acl',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),'functions_hash',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl,p.prosecdef,p.proconfig) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))::text,'UTF8')),'hex') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'));")

    def new_case(self,label):
        self.clone('d162_'+label,'d162_before');self.db='d162_'+label

    def no_ledger(self):
        return self.sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20260922000007';")=='0'

    def failure(self,label,mutation,state='22023',suffix='',render=False,error='legacy_venue_purge_preimage_changed'):
        self.new_case(label)
        if mutation:self.sql(mutation,label=label+'-setup')
        old=self.rendered
        if render:self.render()
        before=self.snapshot()
        self.apply(suffix,expected=state)
        self.check(error in self.last_error,label+': exact '+error)
        self.check(before==self.snapshot() and self.no_ledger(),label+': exact atomic rollback, no ledger162')
        self.rendered=old

    def negatives(self):
        source=next(s['id'] for s in self.manifest if s['table']=='discovery_venues')
        rec=next(s['id'] for s in self.manifest if s['table']=='recommendations')
        self.failure('unpaused',"UPDATE public.release_runtime_controls SET state='open',enabled=false,enabled_at=NULL WHERE control_key='write_pause';",'55000',error='legacy_venue_purge_requires_write_pause')
        self.failure('changed_money',f"UPDATE public.discovery_venues SET price_hint_cents_low=69999 WHERE id={literal(source)};")
        self.failure('added_protected_field',f"UPDATE public.discovery_venues SET metadata=metadata || '{{\"approval_snapshot_hash\":\"KEEP new signed evidence\"}}'::jsonb WHERE id={literal(source)};")
        self.failure('selected_rec',f"UPDATE public.recommendations SET status='selected' WHERE id={literal(rec)};",state='22023')
        self.failure('late_failure','',state='22012',suffix='SELECT 1/0;',error='division by zero')
        self.failure('derived_cache',f"INSERT INTO public.plan_derived_state(plan_id,profit_assumptions) SELECT plan_id,'{{}}' FROM public.recommendations WHERE id={literal(rec)} ON CONFLICT(plan_id) DO NOTHING;",error='legacy_venue_purge_derived_cache_requires_review')
        self.failure('commercial_reference',f"UPDATE public.approvals SET notes='KEEP commercial receipt {rec}' WHERE id='d1622000-0000-4000-8000-000000000021';",error='legacy_venue_purge_commercial_reference_requires_review')
        self.failure('audit_capture',"CREATE TABLE d_purge_fixture.captured(value jsonb); CREATE FUNCTION d_purge_fixture.capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO d_purge_fixture.captured VALUES(to_jsonb(NEW)); RETURN NEW; END $$; CREATE TRIGGER unexpected_audit_capture AFTER UPDATE ON public.discovery_venues FOR EACH ROW EXECUTE FUNCTION d_purge_fixture.capture();",error='legacy_venue_purge_trigger_contract_changed')
        self.check(self.sql('SELECT count(*) FROM d_purge_fixture.captured;')=='0','unexpected audit capture receives zero snapshots')
        self.new_case('invalid_serialized')
        run=next(s for s in self.manifest if s['table']=='agent_runs')
        self.sql(f"UPDATE public.agent_runs SET raw_model_output='{{\"broken\":' WHERE id={literal(run['id'])};")
        malformed_before=self.snapshot();saved=self.rendered
        prehash=self.sql(f"SELECT encode(sha256(convert_to((to_jsonb(t)-'updated_at')::text,'UTF8')),'hex') FROM public.agent_runs t WHERE id={literal(run['id'])};")
        # Change only the failing row's reviewed preimage hash, so this case
        # reaches the typed parser instead of stopping at generic drift.
        match=re.search(r'\$reviewed_manifest\$(.*?)\$reviewed_manifest\$',saved,re.S)
        spec=next(s for s in json.loads(match.group(1)) if s['id']==run['id'])
        self.rendered=saved.replace('"prehash": "'+spec['prehash']+'"','"prehash": "'+prehash+'"',1)
        self.apply(expected='22023')
        self.check('legacy_venue_purge_invalid_serialized_object' in self.last_error,'malformed raw JSON reaches exact typed parser refusal')
        self.check(malformed_before==self.snapshot() and self.no_ledger(),'malformed JSON preserves all rows and ledger')
        self.rendered=saved
        # This source metadata UPDATE is legal today, yet the migration refuses
        # excessive JSON depth before entering existing recursive validators.
        deep={}
        for _ in range(70):deep={'nested':deep}
        self.failure('deep_payload',f"UPDATE public.discovery_venues SET metadata=metadata || jsonb_build_object('host_archived_context',{js(deep)}) WHERE id={literal(source)};",render=True,error='legacy_venue_purge_payload_depth')
        self.new_case('partial_cohort')
        # Missing historical identity is simulated without deleting a referenced
        # source: an unreferenced agent-run row, retaining all financial history.
        run=next(s['id'] for s in self.manifest if s['table']=='agent_runs')
        self.sql(f'DELETE FROM public.agent_runs WHERE id={literal(run)};')
        before=self.snapshot();self.apply(expected='22023')
        self.check(before==self.snapshot() and self.no_ledger(),'partial cohort refuses with no partial projection')

    def concurrency(self):
        self.new_case('locking')
        holder=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        holder.stdin.write("SET application_name='d162-row-holder'; BEGIN; UPDATE public.discovery_venues SET price_hint_note='KEEP concurrent revised commercial term' WHERE id='0419d7e9-ca41-4532-a91c-5fe9a3e5055c'; SELECT pg_sleep(4); COMMIT;");holder.stdin.close()
        self.wait_activity("application_name='d162-row-holder' AND wait_event='PgSleep'")
        waiter=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        waiter.stdin.write("SET application_name='d162-apply-waiter'; BEGIN;\n"+self.rendered+'\nCOMMIT;');waiter.stdin.close()
        self.wait_activity("application_name='d162-apply-waiter' AND wait_event_type='Lock'")
        holder.wait(timeout=15)
        waiter.wait(timeout=15);err=waiter.stderr.read();(OUT/'concurrent-writer-refusal.log').write_text(err)
        self.check(holder.returncode==0 and waiter.returncode!=0 and 'legacy_venue_purge_preimage_changed' in err,'observed migration lock wait then refuses newly committed changed preimage')
        self.check(self.no_ledger() and self.sql("SELECT price_hint_note FROM public.discovery_venues WHERE id='0419d7e9-ca41-4532-a91c-5fe9a3e5055c';")=='KEEP concurrent revised commercial term','concurrent legitimate edit survives refusal, no ledger162')
        self.new_case('lock_timeout')
        holder=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        holder.stdin.write("SET application_name='d162-lock-holder'; BEGIN; LOCK TABLE public.discovery_venues IN ROW EXCLUSIVE MODE; SELECT pg_sleep(7); COMMIT;");holder.stdin.close()
        self.wait_activity("application_name='d162-lock-holder' AND wait_event='PgSleep'")
        before=self.snapshot();self.apply(expected='55P03')
        self.check(before==self.snapshot() and self.no_ledger(),'bounded lock timeout rolls back data and ledger')
        holder.wait(timeout=15);assert holder.returncode==0
        self.new_case('pause_lock')
        proc=subprocess.Popen(self.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        proc.stdin.write("SET application_name='d162-apply-holder'; BEGIN;\n"+self.rendered+"\nSELECT pg_sleep(4); COMMIT;");proc.stdin.close()
        self.wait_activity("application_name='d162-apply-holder' AND wait_event='PgSleep'")
        self.sql("SET lock_timeout='500ms'; UPDATE public.release_runtime_controls SET state='open',enabled=false,enabled_at=NULL WHERE control_key='write_pause';",expected='55P03',label='reopen-blocked')
        proc.wait(timeout=15);assert proc.returncode==0,proc.stderr.read()
        self.check(self.sql("SELECT state FROM public.release_runtime_controls WHERE control_key='write_pause';")=='paused','migration FOR SHARE prevents reopening before outer commit')

    def wait_activity(self,predicate):
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if self.sql(f"SELECT exists(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND {predicate});")=='t':return
            time.sleep(.1)
        raise AssertionError('expected observed database wait: '+predicate)

    def run(self):
        self.new_case('success')
        self.render()
        before=self.snapshot()
        contacts=self.contacts();catalog=self.catalog()
        self.check(sum(bool(r['emails']) for r in contacts)==58 and sum(bool(r['forms']) for r in contacts)==20,'independent contacts present on58 email /20 form source rows')
        self.check(sum(len(r['emails']) for r in contacts)==182 and sum(len(r['forms']) for r in contacts)==868,'182 independently accepted emails and868 forms actually exercise safe readers')
        self.check(sum(e.get('is_likely_booking_contact') is True for r in before['discovery_venues'] for e in r['extracted_emails'])==59,'all59 reviewed Google-context contact flags are present before purge')
        self.check(sum(s['table']=='discovery_venues' for s in self.manifest)==93 and len(self.manifest)==113,'93 source + 20 copy fake cohort present')
        self.check(len(before['approvals'])==39 and sum(bool(r['snapshot_hash']) for r in before['approvals'])==20 and len(before['venue_bookings'])+len(before['vendor_bookings'])==10,'39 approvals / 20 signed hashes / 10 confirmed bookings seeded')
        self.apply()
        after=self.snapshot()
        self.check(all({r['id'] for r in before[t]}=={r['id'] for r in after[t]} for t in TABLES),'all source/copy row identities and counts retained; no deletion or cascade')
        self.check(all(datetime.fromisoformat(r['updated_at'])>datetime.fromisoformat(next(old['updated_at'] for old in before[t] if old['id']==r['id'])) for t in ('discovery_venues','plan_discovery_venue_candidates') for r in after[t] if r['id'] in self.expected),'enabled timestamp triggers advance changed source/candidate rows')
        for table in TABLES:
            for row in after[table]:
                expected=self.expected.get(row['id']) or next(r for r in before[table] if r['id']==row['id'])
                strip=lambda r:{k:v for k,v in r.items() if k!='updated_at'}
                self.check(strip(row)==strip(expected),f'independent afterimage: {table}/{row["id"]}')
        self.check(all(before[t]==after[t] for t in PROTECTED),'all protected financial, approval, consent, booking and FK rows unchanged')
        self.check(contacts==self.contacts(),'accepted contact channels unchanged for all93 source identities')
        self.check(not any('SYNTHETIC_GOOGLE_' in json.dumps(r) for r in after['discovery_venues']),'no synthetic Google presentation remains in source afterimages')
        self.check(not any(e.get('is_likely_booking_contact') for r in after['discovery_venues'] for e in r['extracted_emails']),'all59 Google-context contact-selection flags cleared')
        self.check(catalog==self.catalog(),'all trigger definitions, public/private function definitions+ACLs and table ACLs unchanged; no new definer surface')
        self.check(all(r['metadata']['archived_budget_cents']==900719925474099312345 for r in after['plans']),'JSON integer beyond2^53 preserved exactly')
        self.check(all(r['fit_score'] is None for r in after['plan_discovery_venue_candidates']),'all11 legacy candidate fit scores neutralized')
        self.check(all(r['status']=='superseded' and r['metadata']['venue_content_unavailable'] is True and r['metadata']['unavailable_code']=='legacy_discovery_evidence_missing' for r in after['recommendations']),'all3 recommendations unavailable with exact reader marker')
        self.check(all(r['messages_payload'][0]['content']=='STATIC SYSTEM FIXTURE - preserve exactly' for r in after['agent_runs']),'static system prompts preserved exactly')
        self.check(all(json.loads(r['messages_payload'][1]['content'])['event_plan']['budget']==900719925474099312345 and json.loads(r['messages_payload'][1]['content'])['event_plan']['profit_goal'] is None for r in after['agent_runs']),'parsed/reserialized prompt preserves >2^53 integer and monetary NULL')
        for table in ('agent_runs','plan_discovery_venue_candidates','plan_messages','recommendations'):
            self.sql(f"SELECT private.assert_venue_durable_json(to_jsonb(t),false,NULL,0,NULL,{literal(table)}),private.assert_vendor_durable_json(to_jsonb(t),false,NULL,0,NULL,{literal(table)}) FROM public.{table} t;",label='full-post-validator')
        self.check(True,'all copy rows pass effective venue and vendor validators')
        effective=self.value("SELECT jsonb_agg(jsonb_build_object('name',p.proname,'signature',pg_get_function_identity_arguments(p.oid),'handler_count',(SELECT count(*) FROM regexp_matches(p.prosrc,'EXCEPTION[[:space:]]+WHEN','gi')),'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND (p.proname IN ('assert_venue_durable_json','assert_vendor_durable_json','discovery_venue_safe_json') OR p.proname LIKE 'venue_boundary_%' OR p.proname LIKE 'vendor_boundary_%');")
        (OUT/'effective-helpers.json').write_text(json.dumps(effective,indent=2))
        self.check(effective and all(f['handler_count']==0 for f in effective),'zero EXCEPTION WHEN in effective recursive/projection/contact/provenance helpers; unrelated audit catch unchanged')
        self.apply()
        self.check(after==self.snapshot(),'idempotent apply leaves every value and timestamp unchanged')
        self.negatives()
        self.concurrency()
        (OUT/'proof-results.json').write_text(json.dumps({'passed':self.results,'migration_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest()},indent=2))


def read(obj,path):
    for key in path:
        obj=obj[int(key)] if isinstance(obj,list) else obj[key]
    return obj


def parent(obj,path):
    for key in path[:-1]:
        if isinstance(obj,list):
            if int(key)>=len(obj): return None
            obj=obj[int(key)]
        elif isinstance(obj,dict):
            if key not in obj: return None
            obj=obj[key]
        else:return None
    return obj


def write(obj,path,value):
    p=parent(obj,path)
    if p is None:return
    if isinstance(p,list):p[int(path[-1])]=copy.deepcopy(value)
    else:p[path[-1]]=copy.deepcopy(value)


def erase(obj,path):
    p=parent(obj,path)
    if isinstance(p,dict):p.pop(path[-1],None)
    elif isinstance(p,list) and int(path[-1])<len(p):p.pop(int(path[-1]))


def prepare():
    """Recreate only this explicitly named disposable cluster; no hosted target."""
    proof=Proof()
    RUNTIME.mkdir(parents=True,exist_ok=True)
    for folder in ('docker-config','xdg-config','empty-config','supabase/migrations','supabase/.temp'):
        (RUNTIME/folder).mkdir(parents=True,exist_ok=True)
    (RUNTIME/'docker-config/config.json').write_text('{}')
    for name in ('pgpass','pg_service.conf'):
        path=RUNTIME/'empty-config'/name;path.write_text('');path.chmod(0o600)
    env=dict(ENV,CI='true',XDG_CONFIG_HOME=str(RUNTIME/'xdg-config'),
             PGPASSFILE=str(RUNTIME/'empty-config/pgpass'),PGSERVICEFILE=str(RUNTIME/'empty-config/pg_service.conf'))
    image='public.ecr.aws/supabase/postgres:17.6.1.167'
    result=subprocess.run(['docker','image','inspect',image],env=ENV,capture_output=True)
    if result.returncode:raise RuntimeError('Required disposable image is not cached; no pull attempted: '+image)
    config=(ROOT/'supabase/config.toml').read_text()
    config=re.sub(r'^project_id\s*=.*$', 'project_id = "d-historical-purge-fixture-20261111"',config,flags=re.M)
    # Tested with local Supabase CLI2.95.4; only the generated runtime config uses
    # its older SMTP section name. Repository config is never modified.
    config=config.replace('[local_smtp]','[inbucket]')
    config=re.sub(r'\b543([0-9]{2})\b',lambda m:str(62910+int(m.group(1))),config)
    config=re.sub(r'(\[db.seed\]\s*\n)enabled\s*=\s*true',r'\1enabled = false',config)
    (RUNTIME/'supabase/config.toml').write_text(config)
    (RUNTIME/'supabase/.temp/postgres-version').write_text('17.6.1.167')
    for old in (RUNTIME/'supabase/migrations').glob('*.sql'):old.unlink()
    for path in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0]<='20260922000006':shutil.copy2(path,RUNTIME/'supabase/migrations'/path.name)
    exclusions='gotrue,realtime,storage-api,imgproxy,inbucket,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,postgrest,kong'
    def cli(args,label):
        with (OUT/(label+'.log')).open('w') as log:
            p=subprocess.run(['supabase',*args,'--workdir',str(RUNTIME)],env=env,stdout=log,stderr=subprocess.STDOUT)
        assert p.returncode==0,label+' failed; see local log'
    cli(['stop','--no-backup'],'fixture-stop-before-rebuild')
    cli(['start','-x',exclusions],'fixture-fresh161')
    proof.apply(original=True)
    assert proof.sql("SELECT count(*)||'/'||max(version) FROM supabase_migrations.schema_migrations;")=='162/20260922000007'
    (OUT/'original-fresh162-proof.json').write_text(json.dumps({'original_file_sha256':hashlib.sha256(MIGRATION.read_bytes()).hexdigest(),'ledger':162,'mode':'unmodified migration; empty historical cohort; unpaused bootstrap'},indent=2))
    cli(['db','reset','--local','--no-seed','--version','20260922000002','--yes'],'fixture-replay157')
    data=Path(__file__).with_name('verify-legacy-venue-purge-fixtures.json').read_text()
    seed=Path(__file__).with_name('verify-legacy-venue-purge-seed.sql').read_text().replace('__SYNTHETIC_FIXTURE_JSON__',literal(data))
    proof.sql(seed,label='seed157')
    sql="BEGIN; UPDATE public.release_runtime_controls SET state='paused',enabled=true,enabled_at=now(),revision=revision+1 WHERE control_key='write_pause';\n"
    for path in sorted((ROOT/'supabase/migrations').glob('2026092200000[3456]*.sql')):
        sql+=path.read_text()+f"\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ({literal(path.name.split('_')[0])},{literal('_'.join(path.stem.split('_')[1:]))});\n"
    proof.sql(sql+'COMMIT;',label='seeded158-161')
    proof.clone('d162_before')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare',action='store_true',help='Recreate owned local fixture runtime, replay original162, then seed157 and install158–161')
    parser.add_argument('--stop',action='store_true',help='Stop only the owned local fixture runtime after proof')
    args=parser.parse_args()
    if args.prepare:prepare()
    Proof().run()
    if args.stop:
        subprocess.run(['supabase','stop','--workdir',str(RUNTIME),'--no-backup'],env=dict(ENV,CI='true'),check=True,capture_output=True)
