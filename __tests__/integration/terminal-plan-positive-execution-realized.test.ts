import { execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.TERMINAL_PLAN_EXECUTION_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_TERMINAL_PLAN_EXECUTION_DB_TESTS === '1'

const ids = {
  user: 'db100000-0000-4000-8000-000000000001',
  completedPlan: 'db200000-0000-4000-8000-000000000001',
  archivedPlan: 'db200000-0000-4000-8000-000000000002',
  completedAction: 'db300000-0000-4000-8000-000000000001',
  archivedAction: 'db300000-0000-4000-8000-000000000002',
  completedHostileAction: 'db300000-0000-4000-8000-000000000003',
  archivedHostileAction: 'db300000-0000-4000-8000-000000000004',
  completedApproval: 'db400000-0000-4000-8000-000000000001',
  archivedApproval: 'db400000-0000-4000-8000-000000000002',
}

const hashes = {
  completed: 'a'.repeat(64),
  archived: 'b'.repeat(64),
  nextCompleted: 'c'.repeat(64),
  nextArchived: 'd'.repeat(64),
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: string | Buffer }).stderr
    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
    if (typeof stderr === 'string') return stderr
  }
  return error instanceof Error ? error.message : String(error)
}

function psql(sql: string): string {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return execFileSync('psql', [
        DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', sql,
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

function asService(sql: string): string {
  return `
    begin;
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    ${sql}
    commit;
  `
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

function cleanup(): void {
  psql(`
    delete from public.plans where id in ('${ids.completedPlan}', '${ids.archivedPlan}');
    delete from public.users where id = '${ids.user}';
    delete from auth.users where id = '${ids.user}';
  `)
}

function forcePlanStatus(input: {
  planId: string
  fromStatus: 'ready' | 'completed'
  toStatus: 'completed' | 'archived'
}): void {
  const output = psql(`
    begin;
    select set_config('app.plan_transition_plan_id', '${input.planId}', true);
    select set_config('app.plan_transition_from_status', '${input.fromStatus}', true);
    select set_config('app.plan_transition_to_status', '${input.toStatus}', true);
    select set_config('app.plan_transition_trigger', 'terminal_execution_fixture', true);
    update public.plans
    set status = '${input.toStatus}'::public.planner_plan_status
    where id = '${input.planId}' and status::text = '${input.fromStatus}'
    returning status::text;
    commit;
  `)
  expect(output.split('\n').at(-1)).toBe(input.toStatus)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('${ids.user}', 'authenticated', 'authenticated', 'terminal-execution@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values ('${ids.user}', 'terminal-execution@example.com', 'builder', 'community_builder');

    insert into public.plans (
      id, user_id, title, event_type, status, guest_count, budget_cap_cents,
      date_window_start, date_window_end
    ) values
      ('${ids.completedPlan}', '${ids.user}', 'Completed execution boundary', 'Founder dinner', 'ready', 24, 50000,
       current_date + 70, current_date + 70),
      ('${ids.archivedPlan}', '${ids.user}', 'Archived execution boundary', 'Founder dinner', 'ready', 24, 50000,
       current_date + 71, current_date + 71);

    insert into public.agent_actions (
      id, plan_id, action_type, description, provider, target_type,
      amount_cents, currency, status, payload_json
    ) values
      ('${ids.completedAction}', '${ids.completedPlan}', 'hold_request', 'Request a venue hold',
       'Terminal Venue', 'venue', 50000, 'usd', 'pending', '{"kind":"venue_hold"}'::jsonb),
      ('${ids.archivedAction}', '${ids.archivedPlan}', 'vendor_contact', 'Contact a vendor',
       'Terminal Vendor', 'vendor', 0, 'usd', 'pending', '{"kind":"vendor_contact"}'::jsonb);

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date, status,
      price_cents, fees_cents, requested_amount_cents, expires_at, snapshot_hash
    ) values
      ('${ids.completedApproval}', '${ids.completedPlan}', '${ids.completedAction}', 'Request a venue hold',
       'Terminal Venue', current_date + 70, 'pending', 50000, 0, 50000,
       now() + interval '7 days', '${hashes.completed}'),
      ('${ids.archivedApproval}', '${ids.archivedPlan}', '${ids.archivedAction}', 'Contact a vendor',
       'Terminal Vendor', current_date + 71, 'pending', 0, 0, 0,
       now() + interval '7 days', '${hashes.archived}');

    update public.agent_actions as action_row
    set approval_id = approval_row.id
    from public.approvals as approval_row
    where approval_row.agent_action_id = action_row.id
      and action_row.id in ('${ids.completedAction}', '${ids.archivedAction}');
  `)

  forcePlanStatus({ planId: ids.completedPlan, fromStatus: 'ready', toStatus: 'completed' })
  forcePlanStatus({ planId: ids.archivedPlan, fromStatus: 'ready', toStatus: 'completed' })
  forcePlanStatus({ planId: ids.archivedPlan, fromStatus: 'completed', toStatus: 'archived' })
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('terminal plan positive execution realized boundary', () => {
  beforeAll(setup)
  afterAll(cleanup)

  it.each([
    {
      terminalStatus: 'completed',
      planId: ids.completedPlan,
      actionId: ids.completedAction,
      hostileActionId: ids.completedHostileAction,
      approvalId: ids.completedApproval,
      hostileActionType: 'external_checkout',
      hash: hashes.completed,
      nextHash: hashes.nextCompleted,
      dateOffset: 70,
      amountCents: 50000,
    },
    {
      terminalStatus: 'archived',
      planId: ids.archivedPlan,
      actionId: ids.archivedAction,
      hostileActionId: ids.archivedHostileAction,
      approvalId: ids.archivedApproval,
      hostileActionType: 'payment',
      hash: hashes.archived,
      nextHash: hashes.nextArchived,
      dateOffset: 71,
      amountCents: 0,
    },
  ] as const)(
    'rejects service-role action creation, advancement, authorization, and reapproval on $terminalStatus plans',
    (fixture) => {
      expect(() => psql(asService(`
        insert into public.agent_actions (
          id, plan_id, action_type, description, provider, amount_cents, currency, status, payload_json
        ) values (
          '${fixture.hostileActionId}', '${fixture.planId}', '${fixture.hostileActionType}',
          'Hostile direct service action', 'Hostile Provider', ${fixture.amountCents}, 'usd', 'pending',
          '{"kind":"hostile_positive_execution"}'::jsonb
        );
      `))).toThrow(/agent_action_terminal_plan_positive_execution_forbidden/)

      expect(() => psql(asService(`
        update public.agent_actions
        set status = 'approved', result_metadata = '{"handoff_status":"ready"}'::jsonb
        where id = '${fixture.actionId}';
      `))).toThrow(/agent_action_terminal_plan_positive_execution_forbidden/)

      expect(() => psql(asService(`
        update public.approvals
        set status = 'authorized',
            authorized_amount_cents = ${fixture.amountCents},
            authorized_by = '${ids.user}',
            authorized_at = transaction_timestamp(),
            approved_by = '${ids.user}',
            approved_at = transaction_timestamp()
        where id = '${fixture.approvalId}';
      `))).toThrow(/approval_terminal_plan_positive_execution_forbidden/)

      const nextPayload = `jsonb_build_object(
        'kind', 'generic_positive_execution',
        'provider', 'Hostile Provider',
        'requested_amount_cents', ${fixture.amountCents}
      )`
      const nextSnapshot = `jsonb_build_object(
        'schema_version', 2,
        'approval', jsonb_build_object(
          'requested_amount_cents', ${fixture.amountCents},
          'event_date', (current_date + ${fixture.dateOffset})::text,
          'notes', 'Hostile terminal reapproval'
        ),
        'action', jsonb_build_object('payload_json', ${nextPayload})
      )`
      expect(() => psql(asService(`
        select id from public.supersede_approval_version(
          '${fixture.planId}', '${fixture.approvalId}', '${fixture.hash}', '${ids.user}',
          ${fixture.amountCents}, current_date + ${fixture.dateOffset}, 'Hostile terminal reapproval',
          now() + interval '7 days', ${nextPayload}, ${nextSnapshot}, '${fixture.nextHash}', 'hostile_direct_rpc'
        );
      `))).toThrow(/approval_terminal_plan_positive_execution_forbidden/)

      expect(psql(`
        select plan_row.status || '|' || action_row.status || '|' || approval_row.status || '|' ||
          (select count(*) from public.agent_actions where id = '${fixture.hostileActionId}') || '|' ||
          (select count(*) from public.approvals where root_approval_id = '${fixture.approvalId}') || '|' ||
          (select count(*) from public.agent_action_audit_log
           where action_id = '${fixture.actionId}' and reason = 'approval.version_superseded')
        from public.plans as plan_row
        join public.agent_actions as action_row on action_row.plan_id = plan_row.id
        join public.approvals as approval_row on approval_row.id = action_row.approval_id
        where plan_row.id = '${fixture.planId}';
      `)).toBe(`${fixture.terminalStatus}|pending|pending|0|1|0`)

      expect(psql(asService(`
        update public.approvals set status = 'cancelled'
        where id = '${fixture.approvalId}' returning status;

        update public.agent_actions
        set status = 'cancelled', result_metadata = '{"cleanup":"terminal_negative"}'::jsonb
        where id = '${fixture.actionId}' returning status;
      `))).toBe('cancelled\ncancelled')
      expect(psql(`
        select plan_row.status || '|' || action_row.status || '|' || approval_row.status
        from public.plans as plan_row
        join public.agent_actions as action_row on action_row.plan_id = plan_row.id
        join public.approvals as approval_row on approval_row.id = action_row.approval_id
        where plan_row.id = '${fixture.planId}';
      `)).toBe(`${fixture.terminalStatus}|cancelled|cancelled`)
    },
  )
})
