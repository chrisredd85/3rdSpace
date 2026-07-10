import { execFile, execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.APPROVAL_VERSION_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_APPROVAL_VERSION_DB_TESTS === '1'

const ids = {
  user: 'b6100000-0000-4000-8000-000000000001',
  plan: 'b6200000-0000-4000-8000-000000000001',
  action: 'b6300000-0000-4000-8000-000000000001',
  approval: 'b6400000-0000-4000-8000-000000000001',
  message: 'b6500000-0000-4000-8000-000000000001',
  retryPlan: 'b6200000-0000-4000-8000-000000000002',
  retryAction: 'b6300000-0000-4000-8000-000000000002',
  retryApproval: 'b6400000-0000-4000-8000-000000000002',
}

const oldHash = 'a'.repeat(64)
const newHash = 'b'.repeat(64)
const retryHash = 'c'.repeat(64)
const retryKey = 'approval-retry-realized-001'

function psql(sql: string): string {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return execFileSync('psql', [
        DATABASE_URL,
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-F',
        '|',
        '-c',
        sql,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    } catch (error) {
      lastError = error
      if (!/database system is (starting up|in recovery mode)|connection .*failed|connection to server was lost/i.test(errorText(error))) {
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }
  throw lastError
}

function psqlAsync(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('psql', [
      DATABASE_URL,
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-F',
      '|',
      '-c',
      sql,
    ], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: string | Buffer }).stderr
    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
    if (typeof stderr === 'string') return stderr
  }
  return error instanceof Error ? error.message : String(error)
}

function canConnect(): boolean {
  try {
    psql('select 1')
    return true
  } catch (error) {
    if (forceRun) throw error
    return false
  }
}

function asService(sql: string): string {
  return `
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    ${sql}
    reset role;
  `
}

function cleanup(): void {
  psql(`
    delete from public.plans where id in ('${ids.plan}', '${ids.retryPlan}');
    delete from public.users where id = '${ids.user}';
    delete from auth.users where id = '${ids.user}';
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('${ids.user}', 'authenticated', 'authenticated', 'approval-version-realized@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values ('${ids.user}', 'approval-version-realized@example.com', 'builder', 'community_builder');

    insert into public.plans (id, user_id, title, event_type, status, date_window_start, date_window_end)
    values
      ('${ids.plan}', '${ids.user}', 'Approval version plan', 'networking_mixer', 'ready', '2026-08-20', '2026-08-20'),
      ('${ids.retryPlan}', '${ids.user}', 'Retry plan', 'networking_mixer', 'ready', '2026-08-20', '2026-08-20');

    insert into public.agent_actions (
      id, plan_id, action_type, description, amount_cents, status, payload_json
    ) values (
      '${ids.action}', '${ids.plan}', 'email', 'Email Mission Hall', 10000, 'pending',
      '{"kind":"gmail_approved_outreach","recipients":["old@example.com"]}'::jsonb
    );

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date,
      status, requested_amount_cents, notes, expires_at, snapshot_hash
    ) values (
      '${ids.approval}', '${ids.plan}', '${ids.action}', 'Email Mission Hall', 'Mission Hall', '2026-08-20',
      'pending', 10000, 'Old notes', now() + interval '7 days', '${oldHash}'
    );

    update public.agent_actions set approval_id = '${ids.approval}' where id = '${ids.action}';

    insert into public.plan_messages (id, plan_id, role, content, message_type, metadata)
    values (
      '${ids.message}', '${ids.plan}', 'agent', 'Review outreach', 'approval_request',
      jsonb_build_object('approval_id', '${ids.approval}', 'approval', jsonb_build_object('id', '${ids.approval}'))
    );

    insert into public.agent_actions (
      id, plan_id, action_type, description, amount_cents, status, payload_json, result_metadata
    ) values (
      '${ids.retryAction}', '${ids.retryPlan}', 'email', 'Retry Gmail outreach', 9550, 'failed',
      '{"kind":"gmail_approved_outreach","recipients":["retry@example.com"]}'::jsonb,
      '{"error":"provider timeout"}'::jsonb
    );

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date,
      status, requested_amount_cents, authorized_amount_cents,
      authorized_by, authorized_at, expires_at, snapshot_hash
    ) values (
      '${ids.retryApproval}', '${ids.retryPlan}', '${ids.retryAction}', 'Retry Gmail outreach', 'Gmail', '2026-08-20',
      'authorized', 9550, 9550, '${ids.user}', now(), now() + interval '7 days', '${retryHash}'
    );

    update public.agent_actions set approval_id = '${ids.retryApproval}' where id = '${ids.retryAction}';
  `)
}

function supersedeSql(expectedHash = oldHash): string {
  return asService(`
    select id, version_number, requested_amount_cents, event_date::text, notes, status
    from public.supersede_approval_version(
      '${ids.plan}',
      '${ids.approval}',
      '${expectedHash}',
      '${ids.user}',
      9550,
      '2026-08-21',
      'Use the patio.',
      now() + interval '14 days',
      '{"kind":"gmail_approved_outreach","recipients":["new@example.com"]}'::jsonb,
      '{
        "schema_version": 2,
        "approval": {
          "requested_amount_cents": 9550,
          "event_date": "2026-08-21",
          "notes": "Use the patio."
        },
        "action": {
          "payload_json": {
            "kind": "gmail_approved_outreach",
            "recipients": ["new@example.com"]
          }
        }
      }'::jsonb,
      '${newHash}',
      'Host edited exact approval fields'
    );
  `)
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('realized approval version and retry contract', () => {
  beforeEach(setup)
  afterAll(cleanup)

  it('atomically supersedes the prior row, preserves $95.50, and repoints action and message', () => {
    const returned = psql(supersedeSql())
    expect(returned).toMatch(/\|2\|9550\|2026-08-21\|Use the patio\.\|pending$/)

    expect(psql(`
      select version_number, status, requested_amount_cents, event_date::text, notes
      from public.approvals
      where root_approval_id = '${ids.approval}'
      order by version_number;
    `)).toBe([
      '1|superseded|10000|2026-08-20|Old notes',
      '2|pending|9550|2026-08-21|Use the patio.',
    ].join('\n'))

    const nextId = psql(`select superseded_by_approval_id from public.approvals where id = '${ids.approval}';`)
    expect(psql(`select approval_id::text || '|' || amount_cents::text from public.agent_actions where id = '${ids.action}';`))
      .toBe(`${nextId}|9550`)
    expect(psql(`select metadata ->> 'approval_id' from public.plan_messages where id = '${ids.message}';`))
      .toBe(nextId)
  })

  it('rolls back every write when the expected snapshot hash is stale', () => {
    expect(() => psql(supersedeSql('f'.repeat(64)))).toThrow()
    expect(psql(`
      select count(*)::text || '|' || min(status) || '|' || min(requested_amount_cents)::text
      from public.approvals where root_approval_id = '${ids.approval}';
    `)).toBe('1|pending|10000')
    expect(psql(`select approval_id from public.agent_actions where id = '${ids.action}';`)).toBe(ids.approval)
  })

  it('allows only one concurrent successor for the same approval snapshot', async () => {
    const results = await Promise.allSettled([psqlAsync(supersedeSql()), psqlAsync(supersedeSql())])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(errorText((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason))
      .toMatch(/approval_version_source_(not_editable|already_superseded)/)
    expect(psql(`select count(*) from public.approvals where root_approval_id = '${ids.approval}';`)).toBe('2')
  })

  it('deletes the whole plan aggregate without self-FK deadlock or orphaned versions', () => {
    psql(supersedeSql())
    expect(psql(`delete from public.plans where id = '${ids.plan}' returning id;`)).toBe(ids.plan)
    expect(psql(`select count(*) from public.approvals where root_approval_id = '${ids.approval}';`)).toBe('0')
  })

  it('denies browser roles and grants only service_role on every mutation command', () => {
    for (const signature of [
      'public.supersede_approval_version(uuid,uuid,text,uuid,integer,date,text,timestamp with time zone,jsonb,jsonb,text,text)',
      'public.claim_failed_action_retry(uuid,uuid,uuid,text,text,uuid)',
      'public.finalize_failed_action_retry(uuid,uuid,text,text,jsonb,uuid)',
    ]) {
      expect(psql(`
        select
          has_function_privilege('anon', '${signature}', 'EXECUTE')::text || '|' ||
          has_function_privilege('authenticated', '${signature}', 'EXECUTE')::text || '|' ||
          has_function_privilege('service_role', '${signature}', 'EXECUTE')::text;
      `)).toBe('false|false|true')
    }
  })

  it('claims one retry, makes the overlapping same-key call wait, and converges on prior success', async () => {
    const claim = asService(`
      select outcome, action_status from public.claim_failed_action_retry(
        '${ids.retryPlan}', '${ids.retryAction}', '${ids.retryApproval}',
        '${retryHash}', '${retryKey}', '${ids.user}'
      );
    `)
    const claims = await Promise.all([psqlAsync(claim), psqlAsync(claim)])
    expect(claims.sort()).toEqual(['claimed|executing', 'in_progress|executing'])

    expect(psql(asService(`
      select outcome, action_status from public.finalize_failed_action_retry(
        '${ids.retryPlan}', '${ids.retryAction}', '${retryKey}', 'succeeded',
        '{"gmail_message_ids":["gmail-1"]}'::jsonb, '${ids.user}'
      );
    `))).toBe('succeeded|complete')

    psql(`
      update public.approvals
      set status = 'expired', expires_at = now() - interval '1 minute'
      where id = '${ids.retryApproval}';
    `)

    expect(psql(claim)).toBe('prior_success|complete')
    expect(psql(`
      select last_retry_status || '|' || status || '|' || (result_metadata -> 'gmail_message_ids' ->> 0)
      from public.agent_actions where id = '${ids.retryAction}';
    `)).toBe('succeeded|complete|gmail-1')
  })

  it('records a failed attempt and permits a fresh idempotency key to retry it', () => {
    expect(psql(asService(`
      select outcome from public.claim_failed_action_retry(
        '${ids.retryPlan}', '${ids.retryAction}', '${ids.retryApproval}',
        '${retryHash}', '${retryKey}', '${ids.user}'
      );
    `))).toBe('claimed')
    expect(psql(asService(`
      select outcome, action_status from public.finalize_failed_action_retry(
        '${ids.retryPlan}', '${ids.retryAction}', '${retryKey}', 'failed',
        '{"error":"transient"}'::jsonb, '${ids.user}'
      );
    `))).toBe('failed|failed')
    expect(psql(asService(`
      select outcome, action_status from public.claim_failed_action_retry(
        '${ids.retryPlan}', '${ids.retryAction}', '${ids.retryApproval}',
        '${retryHash}', 'approval-retry-realized-002', '${ids.user}'
      );
    `))).toBe('claimed|executing')
  })
})
