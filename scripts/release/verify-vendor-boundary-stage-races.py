#!/usr/bin/env python3
"""Four observable local multi-connection races; refuses non-loopback DB targets.
Run after the actual-schema producer SQL setup +161 activation. No provider calls.
"""
import argparse, json, subprocess, tempfile, time
from pathlib import Path
from urllib.parse import urlparse

parser=argparse.ArgumentParser(); parser.add_argument('--url',required=True); args=parser.parse_args()
u=urlparse(args.url)
if u.hostname not in ('127.0.0.1','localhost') or u.scheme not in ('postgresql','postgres'):
    raise SystemExit('Disposable loopback database required')
PSQL='/opt/homebrew/opt/postgresql@17/bin/psql'
empty_config=tempfile.TemporaryDirectory(prefix='c2-race-empty-config-')
for name in ('pgpass','pg_service.conf'): Path(empty_config.name,name).touch(mode=0o600)
env={'PATH':'/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin','LC_ALL':'C',
     'PGPASSFILE':str(Path(empty_config.name,'pgpass')),'PGSERVICEFILE':str(Path(empty_config.name,'pg_service.conf'))}
base=[PSQL,'-X',args.url,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-Atq']
processes=[]
def query(sql):
    r=subprocess.run(base,input=sql,text=True,capture_output=True,env=env,timeout=20)
    if r.returncode: raise AssertionError(r.stderr)
    return r.stdout.strip()
def launch(name,sql):
    p=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    p.stdin.write("SET application_name='"+name+"'; SET statement_timeout='20s'; "+sql);p.stdin.close();processes.append(p);return p
def wait(name,kind):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        if query(f"SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='{name}' AND {kind});")=='t': return
        time.sleep(.05)
    raise AssertionError('No observed expected wait: '+name+' '+kind)
def finish(p,code=None,message=None):
    p.wait(timeout=20); out=p.stdout.read();err=p.stderr.read()
    if code:
        assert p.returncode!=0 and code in err and message in err,(p.returncode,out,err)
    else: assert p.returncode==0,(out,err)
    return out.strip()
service="SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role'; "
vendor=query("SELECT id FROM public.discovery_vendors_safe WHERE google_place_id='c2-activate-producer-proof';")
def facts(name):
    return "SELECT public.write_discovery_vendor_independent_facts('"+vendor+"',jsonb_build_object('name','"+name+"'),jsonb_build_object('name',c2_activate_proof.evidence()))->>'id';"
def restore():query('BEGIN;'+service+facts('Independent Supplier')+'COMMIT;')
def no_action(case):
    assert query(f'SELECT NOT EXISTS(SELECT FROM public.agent_actions a JOIN c2_activate_proof.stage_cases c ON c.plan_id=a.plan_id WHERE c.case_number={case});')=='t'
checks=[]
try:
    # Writer acquires row UPDATE lock before gateway's FOR SHARE. The gateway
    # must inspect the committed row after waiting, not a pre-wait stale tuple.
    writer=launch('c2_fact_rpc_writer','BEGIN;'+service+facts('Changed supplier')+"SELECT pg_sleep(3); COMMIT;")
    wait('c2_fact_rpc_writer',"wait_event='PgSleep'")
    stage=launch('c2_gateway_waiter','BEGIN;'+service+'SELECT c2_activate_proof.stage(5,true); COMMIT;')
    wait('c2_gateway_waiter',"wait_event_type='Lock'")
    finish(writer);finish(stage,'23514','vendor_boundary_stage_fact_changed');no_action(5);restore()
    checks.append('gateway waits for fact RPC UPDATE and rejects changed committed facts before mutation')
    # Table owner simulates a residual non-key legacy writer: SHARE, unlike KEY
    # SHARE, must conflict with that UPDATE. This connection is disposable-only.
    writer=launch('c2_nonkey_writer',f"BEGIN; UPDATE public.discovery_vendors SET name='Changed supplier' WHERE id='{vendor}'; SELECT pg_sleep(3); COMMIT;")
    wait('c2_nonkey_writer',"wait_event='PgSleep'")
    stage=launch('c2_direct_stage_waiter','BEGIN;'+service+'SELECT c2_activate_proof.stage(6,false); COMMIT;')
    wait('c2_direct_stage_waiter',"wait_event_type='Lock'")
    finish(writer);finish(stage,'23514','vendor_boundary_stage_fact_changed');no_action(6);restore()
    checks.append('direct stage waits for non-key UPDATE and rejects changed committed facts')
    # Reverse order: staging's SHARE lock lasts through the outer transaction.
    stage=launch('c2_stage_holds_share','BEGIN;'+service+"SELECT c2_activate_proof.stage(7,true)->>'existing'; SELECT pg_sleep(3); COMMIT;")
    wait('c2_stage_holds_share',"wait_event='PgSleep'")
    writer=launch('c2_fact_writer_waits','BEGIN;'+service+facts('Changed supplier')+'COMMIT;')
    wait('c2_fact_writer_waits',"wait_event_type='Lock'")
    assert 'false' in finish(stage);finish(writer);restore()
    assert query('SELECT count(*) FROM public.agent_actions a JOIN c2_activate_proof.stage_cases c ON c.plan_id=a.plan_id WHERE c.case_number=7;')=='1'
    checks.append('successful stage retains SHARE lock until commit and blocks concurrent fact RPC')
    # Concurrent same request: plan lock serializes and the second caller reuses.
    first=launch('c2_first_stage','BEGIN;'+service+"SELECT c2_activate_proof.stage(8,true)->>'existing'; SELECT pg_sleep(3); COMMIT;")
    wait('c2_first_stage',"wait_event='PgSleep'")
    second=launch('c2_repeat_stage','BEGIN;'+service+"SELECT c2_activate_proof.stage(8,true)->>'existing'; COMMIT;")
    wait('c2_repeat_stage',"wait_event_type='Lock'")
    assert 'false' in finish(first);assert finish(second)=='true'
    assert query('SELECT count(*) FROM public.agent_actions a JOIN c2_activate_proof.stage_cases c ON c.plan_id=a.plan_id WHERE c.case_number=8;')=='1'
    checks.append('concurrent exact stage retry creates one action/approval and returns existing')
    print(json.dumps({'status':'PASS','local_only':True,'observable_lock_waits':4,'checks':checks},indent=2))
finally:
    for p in processes:
        if p.poll() is None:p.terminate();p.wait(timeout=5)

    empty_config.cleanup()
