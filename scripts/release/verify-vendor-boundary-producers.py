#!/usr/bin/env python3
"""Full-schema local160 ->161 producer proof. Requires a fresh disposable160 DB.
No reset, hosted access, installs or provider calls. URL must be loopback.
"""
import argparse, hashlib, json, subprocess, tempfile
from pathlib import Path
from urllib.parse import urlparse

root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--url',required=True);args=p.parse_args()
u=urlparse(args.url)
if u.hostname not in ('127.0.0.1','localhost') or u.scheme not in ('postgresql','postgres'):
    raise SystemExit('Disposable loopback DB required')
out=root/'test-results/ws2a-b3-c2-activate-resume/producers';out.mkdir(parents=True,exist_ok=True)
migration=root/'supabase/migrations/20260922000006_activate_vendor_discovery_boundary.sql'
manifest={'status':'FAIL','local_only':True,'schema':'full repository replay through160','migration_sha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'runs':[]}
with tempfile.TemporaryDirectory(prefix='c2-producer-empty-config-') as temp:
    for name in ('pgpass','pg_service.conf'):Path(temp,name).touch(mode=0o600)
    env={'PATH':'/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin','LC_ALL':'C','PGPASSFILE':str(Path(temp,'pgpass')),'PGSERVICEFILE':str(Path(temp,'pg_service.conf'))}
    base=['/opt/homebrew/opt/postgresql@17/bin/psql','-X',args.url,'-v','ON_ERROR_STOP=1']
    def run(name,cmd):
        r=subprocess.run(cmd,cwd=root,text=True,capture_output=True,env=env,timeout=120)
        (out/(name+'.log')).write_text(r.stdout+r.stderr)
        manifest['runs'].append({'name':name,'exit':r.returncode,'sql_pass_assertions':r.stderr.count('PASS:')})
        print(name,r.returncode,flush=True)
        if r.returncode: raise RuntimeError(name+' failed; see '+str(out/(name+'.log')))
        return r.stdout
    try:
        ledger=run('ledger-before',base+['-Atq','-c','SELECT count(*)||\'|\'||max(version) FROM supabase_migrations.schema_migrations;']).strip()
        assert ledger=='160|20260922000005',ledger
        for name in ('producers','stage-revision','bookings'):
            run('setup-'+name,base+['-v','setup=true','-f',f'scripts/release/verify-vendor-boundary-{name}.sql'])
        # Same five real commands against160 inside a rollback-only transaction.
        # The160 compatibility data uses safe vendor metadata; separate legacy
        # copies remain in the real fixtures for the161 projection proof.
        source=(root/'scripts/release/verify-vendor-boundary-producers.sql').read_text()
        start=source.index(' SELECT * INTO STRICT c FROM c2_activate_proof.cases WHERE case_number=1;',source.index('\\else'))
        calls=source[start:source.index('END;\n$commands$;',start)].replace(' args:=ids||'," ids:=jsonb_build_object('p_plan_id',c.plan_id,'p_action_id',c.action_id,'p_approval_id',c.approval_id);\n args:=ids||")
        sql="BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';\nUPDATE public.admin_tasks SET metadata=metadata-'legacy_vendor' WHERE id IN(SELECT task_id FROM c2_activate_proof.cases);\nUPDATE public.agent_actions SET result_metadata=result_metadata-'legacy_vendor' WHERE id IN(SELECT action_id FROM c2_activate_proof.cases);\nDO $commands$ DECLARE c c2_activate_proof.cases; args jsonb; value jsonb; ids jsonb; BEGIN\n"+calls+"END; $commands$;\nSELECT jsonb_agg(to_jsonb(r) ORDER BY scenario) FROM c2_activate_proof.receipts r; ROLLBACK;\n"
        (out/'concierge160.sql').write_text(sql)
        receipts=run('concierge160',base+['-Atq','-f',str(out/'concierge160.sql')]);(out/'receipts160.json').write_text(receipts)
        sql="UPDATE public.release_runtime_controls SET state='paused' WHERE control_key='write_pause';\n"+migration.read_text()+"\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES('20260922000006','activate_vendor_discovery_boundary');\nUPDATE public.release_runtime_controls SET state='open' WHERE control_key='write_pause';\n"
        (out/'apply161.sql').write_text(sql)
        run('apply161',base+['--single-transaction','-f',str(out/'apply161.sql')])
        for name in ('producers','stage-revision','bookings'):
            run(name,base+['-v','setup=false','-f',f'scripts/release/verify-vendor-boundary-{name}.sql'])
        receipts=run('concierge161',base+['-Atq','-c','SELECT jsonb_agg(to_jsonb(r) ORDER BY scenario) FROM c2_activate_proof.receipts r']);(out/'receipts161.json').write_text(receipts)
        for ledger in ('160','161'):
            result=run('typed-receipts'+ledger,['node','--require',str(root/'test-results/ws2a-b3-c2-activate-resume/offline-preload.cjs'),'--import','tsx','scripts/release/verify-vendor-boundary-rpc-responses.ts',str(out/f'receipts{ledger}.json'),ledger])
            manifest['runs'][-1]['typed_result']=json.loads(result.strip().splitlines()[-1])
        stages=run('stage-aggregates',base+['-Atq','-c','SELECT jsonb_agg(to_jsonb(r) ORDER BY case_number) FROM c2_activate_proof.stage_receipts r']);(out/'stage-receipts.json').write_text(stages)
        result=run('typed-stage-receipts',['node','--require',str(root/'test-results/ws2a-b3-c2-activate-resume/offline-preload.cjs'),'--import','tsx','scripts/release/verify-vendor-boundary-stage-responses.ts',str(out/'stage-receipts.json')])
        manifest['runs'][-1]['typed_result']=json.loads(result.strip().splitlines()[-1])
        result=run('stage-races',['python3','scripts/release/verify-vendor-boundary-stage-races.py','--url',args.url]);manifest['runs'][-1]['race_result']=json.loads(result)
        ledger=run('ledger-after',base+['-Atq','-c','SELECT count(*)||\'|\'||max(version) FROM supabase_migrations.schema_migrations;']).strip()
        assert ledger=='161|20260922000006',ledger
        manifest['status']='PASS'
    finally:
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
