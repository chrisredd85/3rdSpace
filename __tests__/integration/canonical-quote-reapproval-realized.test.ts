import { execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.CANONICAL_REAPPROVAL_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_CANONICAL_REAPPROVAL_DB_TESTS === '1'

const ids = {
  user: 'ea100000-0000-4000-8000-000000000001',
  expiredPlan: 'ea200000-0000-4000-8000-000000000001',
  stalePlan: 'ea200000-0000-4000-8000-000000000002',
  sideEffectPlan: 'ea200000-0000-4000-8000-000000000003',
  genericPlan: 'ea200000-0000-4000-8000-000000000004',
  expiredAction: 'ea300000-0000-4000-8000-000000000001',
  staleAction: 'ea300000-0000-4000-8000-000000000002',
  sideEffectAction: 'ea300000-0000-4000-8000-000000000003',
  genericAction: 'ea300000-0000-4000-8000-000000000004',
  expiredApproval: 'ea400000-0000-4000-8000-000000000001',
  staleApproval: 'ea400000-0000-4000-8000-000000000002',
  sideEffectApproval: 'ea400000-0000-4000-8000-000000000003',
  genericApproval: 'ea400000-0000-4000-8000-000000000004',
  adminTask: 'ea500000-0000-4000-8000-000000000001',
}

const hashes = {
  expired: 'a'.repeat(64),
  stale: 'b'.repeat(64),
  sideEffect: 'c'.repeat(64),
  generic: 'd'.repeat(64),
  successor: 'e'.repeat(64),
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
    delete from public.plans where user_id = '${ids.user}';
    delete from public.users where id = '${ids.user}';
    delete from auth.users where id = '${ids.user}';
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values ('${ids.user}', 'authenticated', 'authenticated', 'canonical-reapproval@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values ('${ids.user}', 'canonical-reapproval@example.com', 'builder', 'community_builder');

    insert into public.plans (
      id, user_id, title, event_type, status, guest_count, budget_cap_cents,
      date_window_start, date_window_end, ticketed
    ) values
      ('${ids.expiredPlan}', '${ids.user}', 'Expired quote', 'Founder dinner', 'approved', 20, 100000, '2027-01-15', '2027-01-15', false),
      ('${ids.stalePlan}', '${ids.user}', 'Stale quote', 'Founder dinner', 'approved', 20, 100000, '2027-01-16', '2027-01-16', false),
      ('${ids.sideEffectPlan}', '${ids.user}', 'Started quote', 'Founder dinner', 'approved', 20, 100000, '2027-01-17', '2027-01-17', false),
      ('${ids.genericPlan}', '${ids.user}', 'Generic work', 'Founder dinner', 'approved', 20, 100000, '2027-01-18', '2027-01-18', false);

    insert into public.agent_actions (
      id, plan_id, action_type, description, provider, target_type, target_id,
      amount_cents, status, payload_json, result_metadata
    ) values
      ('${ids.expiredAction}', '${ids.expiredPlan}', 'concierge_queue', 'Book expired quote', 'Venue A', 'discovery_venue', 'ea600000-0000-4000-8000-000000000001', 50000, 'pending',
       '{"kind":"canonical_quote_booking","quote_kind":"venue","target_type":"discovery_venue","target_id":"ea600000-0000-4000-8000-000000000001","requested_amount_cents":50000,"price_cents":50000,"requires_event_materialization":true}',
       '{"canonical_booking_status":"waiting_for_event_materialization","outbound_message_sent":false}'),
      ('${ids.staleAction}', '${ids.stalePlan}', 'concierge_queue', 'Book stale quote', 'Venue B', 'discovery_venue', 'ea600000-0000-4000-8000-000000000002', 60000, 'pending',
       '{"kind":"canonical_quote_booking","quote_kind":"venue","target_type":"discovery_venue","target_id":"ea600000-0000-4000-8000-000000000002","requested_amount_cents":60000,"price_cents":60000,"requires_event_materialization":true}',
       '{"canonical_booking_status":"waiting_for_event_materialization","outbound_message_sent":false}'),
      ('${ids.sideEffectAction}', '${ids.sideEffectPlan}', 'concierge_queue', 'Book started quote', 'Venue C', 'discovery_venue', 'ea600000-0000-4000-8000-000000000003', 70000, 'pending',
       '{"kind":"canonical_quote_booking","quote_kind":"venue","target_type":"discovery_venue","target_id":"ea600000-0000-4000-8000-000000000003","requested_amount_cents":70000,"price_cents":70000,"requires_event_materialization":true}',
       '{"canonical_booking_status":"waiting_for_event_materialization","outbound_message_sent":false}'),
      ('${ids.genericAction}', '${ids.genericPlan}', 'hold_request', 'Generic started hold', 'Venue D', 'discovery_venue', 'ea600000-0000-4000-8000-000000000004', 80000, 'pending',
       '{"kind":"canonical_quote_booking","quote_kind":"venue","target_type":"discovery_venue","target_id":"ea600000-0000-4000-8000-000000000004","requested_amount_cents":80000,"price_cents":80000,"requires_event_materialization":true}',
       '{"canonical_booking_status":"waiting_for_event_materialization","outbound_message_sent":false}');

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date,
      price_cents, fees_cents, requested_amount_cents, authorized_amount_cents,
      status, authorized_by, authorized_at, approved_by, approved_at, expires_at,
      snapshot_hash, snapshot_json, snapshot_schema_version
    )
    select
      input.approval_id,
      plan_row.id,
      action_row.id,
      'Approve quote',
      action_row.provider,
      plan_row.date_window_start,
      action_row.amount_cents,
      0,
      action_row.amount_cents,
      action_row.amount_cents,
      'pending',
      '${ids.user}',
      now() - interval '1 hour',
      '${ids.user}',
      now() - interval '1 hour',
      input.expires_at,
      input.snapshot_hash,
      jsonb_build_object(
        'schema_version', 2,
        'plan', jsonb_build_object(
          'event_type', plan_row.event_type,
          'guest_count', plan_row.guest_count,
          'budget_cap_cents', plan_row.budget_cap_cents,
          'neighborhood', plan_row.neighborhood,
          'date_window_start', plan_row.date_window_start,
          'date_window_end', plan_row.date_window_end,
          'ticketed', plan_row.ticketed,
          'ticketing_model', plan_row.ticketing_model,
          'food_responsibility', plan_row.food_responsibility,
          'profit_goal_cents', plan_row.profit_goal_cents
        ),
        'approval', jsonb_build_object(
          'action_label', 'Approve quote',
          'event_date', plan_row.date_window_start::text,
          'requested_amount_cents', action_row.amount_cents,
          'price_cents', action_row.amount_cents,
          'fees_cents', 0,
          'notes', null,
          'provider', action_row.provider,
          'delivery_email', null,
          'refund_terms', null,
          'cancellation_terms', null,
          'package_details', null,
          'expires_at', input.expires_at::text
        ),
        'action', jsonb_build_object(
          'action_type', action_row.action_type,
          'target_type', action_row.target_type,
          'target_id', action_row.target_id::text,
          'amount_cents', action_row.amount_cents,
          'payload_json', action_row.payload_json
        ),
        'counterparty', jsonb_build_object(
          'provider', action_row.provider,
          'target_type', action_row.target_type,
          'target_id', action_row.target_id::text
        )
      ),
      2
    from (
      values
        ('${ids.expiredPlan}'::uuid, '${ids.expiredApproval}'::uuid, 'expired'::text, now() - interval '1 minute', '${hashes.expired}'::text),
        ('${ids.stalePlan}'::uuid, '${ids.staleApproval}'::uuid, 'authorized'::text, now() + interval '1 day', '${hashes.stale}'::text),
        ('${ids.sideEffectPlan}'::uuid, '${ids.sideEffectApproval}'::uuid, 'authorized'::text, now() + interval '1 day', '${hashes.sideEffect}'::text),
        ('${ids.genericPlan}'::uuid, '${ids.genericApproval}'::uuid, 'expired'::text, now() - interval '1 minute', '${hashes.generic}'::text)
    ) as input(plan_id, approval_id, approval_status, expires_at, snapshot_hash)
    join public.plans as plan_row on plan_row.id = input.plan_id
    join public.agent_actions as action_row on action_row.plan_id = plan_row.id;

    update public.agent_actions as action_row
    set approval_id = approval_row.id
    from public.approvals as approval_row
    where approval_row.agent_action_id = action_row.id
      and action_row.plan_id in (
        '${ids.expiredPlan}', '${ids.stalePlan}', '${ids.sideEffectPlan}', '${ids.genericPlan}'
      );

    update public.approvals as approval_row
    set status = input.approval_status
    from (
      values
        ('${ids.expiredApproval}'::uuid, 'expired'::text),
        ('${ids.staleApproval}'::uuid, 'authorized'::text),
        ('${ids.sideEffectApproval}'::uuid, 'authorized'::text),
        ('${ids.genericApproval}'::uuid, 'expired'::text)
    ) as input(approval_id, approval_status)
    where approval_row.id = input.approval_id;

    update public.agent_actions
    set status = 'executing'
    where plan_id in (
      '${ids.expiredPlan}', '${ids.stalePlan}', '${ids.sideEffectPlan}', '${ids.genericPlan}'
    );

    insert into public.plan_messages (plan_id, role, content, message_type, metadata)
    select approval_row.plan_id, 'agent', 'Approve this quote', 'approval_request',
      jsonb_build_object(
        'status', approval_row.status,
        'approval_id', approval_row.id,
        'approval', jsonb_build_object('id', approval_row.id, 'status', approval_row.status)
      )
    from public.approvals as approval_row
    where approval_row.id in (
      '${ids.expiredApproval}', '${ids.staleApproval}',
      '${ids.sideEffectApproval}', '${ids.genericApproval}'
    );

    insert into public.admin_tasks (
      id, plan_id, agent_action_id, approval_id, task_type, description, status
    ) values (
      '${ids.adminTask}', '${ids.sideEffectPlan}', '${ids.sideEffectAction}',
      '${ids.sideEffectApproval}', 'concierge_booking', 'Already queued work', 'open'
    );

    update public.approvals
    set status = 'expired'
    where id = '${ids.sideEffectApproval}';

    update public.approvals
    set status = 're_approval_required'
    where id = '${ids.staleApproval}';
  `)
}

function command(input: {
  planId: string
  actionId: string
  approvalId: string
  snapshotHash: string
  reason: 'approval_expired' | 'approval_stale'
}): string {
  return asService(`
    select
      (result ->> 'existing') || '|' || (result ->> 'action_status') || '|' ||
      (result ->> 'approval_status') || '|' || (result ->> 'reason')
    from (
      select public.require_canonical_quote_booking_reapproval(
        '${input.planId}', '${input.actionId}', '${input.approvalId}', '${ids.user}',
        '${input.snapshotHash}', '${input.reason}'
      ) as result
    ) as command;
  `)
}

function supersedeStaleExact(): string {
  return asService(`
    select status
    from public.supersede_approval_version(
      '${ids.stalePlan}', '${ids.staleApproval}', '${hashes.stale}', '${ids.user}',
      60000, '2027-01-16', null, now() + interval '1 day',
      (select payload_json from public.agent_actions where id = '${ids.staleAction}'),
      (select snapshot_json from public.approvals where id = '${ids.staleApproval}'),
      '${'9'.repeat(64)}', 'Host refreshed stale quote approval.'
    );
  `)
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('canonical quote reapproval command realized behavior', () => {
  beforeAll(setup)
  afterAll(cleanup)

  it('reopens an expired untouched canonical action exactly once and preserves authorization', () => {
    const sql = command({
      planId: ids.expiredPlan,
      actionId: ids.expiredAction,
      approvalId: ids.expiredApproval,
      snapshotHash: hashes.expired,
      reason: 'approval_expired',
    })

    expect(psql(sql)).toBe('false|approved|re_approval_required|approval_expired')
    expect(psql(sql)).toBe('true|approved|re_approval_required|approval_expired')
    expect(psql(`
      select approval_row.status || '|' || (approval_row.authorized_by = '${ids.user}')::text || '|' ||
        (approval_row.authorized_at is not null)::text || '|' || approval_row.authorized_amount_cents::text || '|' ||
        action_row.status || '|' || (action_row.result_metadata #>> '{canonical_quote_reapproval,reason}')
      from public.approvals as approval_row
      join public.agent_actions as action_row on action_row.id = approval_row.agent_action_id
      where approval_row.id = '${ids.expiredApproval}';
    `)).toBe('re_approval_required|true|true|50000|approved|approval_expired')
    expect(psql(`select count(*) from public.agent_action_audit_log where action_id = '${ids.expiredAction}' and reason = 'canonical_quote_booking.reapproval_required';`)).toBe('1')
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.expiredPlan}' and metadata ->> 'kind' = 'canonical_quote_booking_reapproval_required';`)).toBe('1')
  })

  it('makes the reopened action acceptable to approval version supersession', () => {
    expect(psql(asService(`
      select status
      from public.supersede_approval_version(
        '${ids.expiredPlan}', '${ids.expiredApproval}', '${hashes.expired}', '${ids.user}',
        50000, '2027-01-15', null, now() + interval '1 day',
        (select payload_json from public.agent_actions where id = '${ids.expiredAction}'),
        (select snapshot_json from public.approvals where id = '${ids.expiredApproval}'),
        '${hashes.successor}', 'Host refreshed expired quote approval.'
      );
    `))).toBe('pending')
    expect(psql(`select status from public.agent_actions where id = '${ids.expiredAction}';`)).toBe('pending')
  })

  it('atomically adopts an already classified stale approval without clearing authorization', () => {
    expect(psql(command({
      planId: ids.stalePlan,
      actionId: ids.staleAction,
      approvalId: ids.staleApproval,
      snapshotHash: hashes.stale,
      reason: 'approval_stale',
    }))).toBe('false|approved|re_approval_required|approval_stale')
  })

  it('fails closed when financial evidence appears before supersession', () => {
    psql(`
      insert into public.payment_intents (
        plan_id, approval_id, partner_kind, partner_id, amount_cents
      ) values (
        '${ids.stalePlan}', '${ids.staleApproval}', 'venue',
        'ea600000-0000-4000-8000-000000000002', 60000
      );
    `)
    try {
      expect(() => psql(supersedeStaleExact()))
        .toThrow(/approval_version_canonical_quote_side_effect_exists/)
    } finally {
      psql(`delete from public.payment_intents where approval_id = '${ids.staleApproval}';`)
    }
  })

  it('fails closed while a retry is in progress before supersession', () => {
    psql(`
      update public.agent_actions
      set last_retry_idempotency_key = 'canonical-reapproval-in-progress',
          last_retry_status = 'in_progress',
          last_retry_started_at = now(),
          last_retry_completed_at = null
      where id = '${ids.staleAction}';
    `)
    try {
      expect(() => psql(supersedeStaleExact()))
        .toThrow(/approval_version_canonical_quote_side_effect_exists/)
    } finally {
      psql(`
        update public.agent_actions
        set last_retry_idempotency_key = null,
            last_retry_status = null,
            last_retry_started_at = null,
            last_retry_completed_at = null
        where id = '${ids.staleAction}';
      `)
    }
  })

  it('fails closed on handoff metadata even without a durable admin row', () => {
    psql(`
      update public.agent_actions
      set result_metadata = result_metadata || '{"handoff_status":"queued"}'::jsonb
      where id = '${ids.staleAction}';
    `)
    try {
      expect(() => psql(supersedeStaleExact()))
        .toThrow(/approval_version_canonical_quote_side_effect_exists/)
    } finally {
      psql(`
        update public.agent_actions
        set result_metadata = result_metadata - 'handoff_status'
        where id = '${ids.staleAction}';
      `)
    }
  })

  it('rejects canonical repricing even when the proposed snapshot is internally consistent', () => {
    expect(() => psql(asService(`
      with next_payload as (
        select payload_json || jsonb_build_object(
          'requested_amount_cents', 61000,
          'price_cents', 61000,
          'amount_cents', 61000,
          'requestedAmountCents', 61000
        ) as payload
        from public.agent_actions
        where id = '${ids.staleAction}'
      )
      select status
      from next_payload,
        public.supersede_approval_version(
          '${ids.stalePlan}', '${ids.staleApproval}', '${hashes.stale}', '${ids.user}',
          61000, '2027-01-16', null, now() + interval '1 day', next_payload.payload,
          jsonb_build_object(
            'schema_version', 2,
            'approval', jsonb_build_object(
              'requested_amount_cents', 61000,
              'price_cents', 61000,
              'event_date', '2027-01-16',
              'notes', null
            ),
            'action', jsonb_build_object(
              'amount_cents', 61000,
              'payload_json', next_payload.payload
            )
          ),
          '${'8'.repeat(64)}', 'Host attempted canonical repricing.'
        );
    `))).toThrow(/canonical_quote_booking_amount_change_requires_fresh_quote/)
  })

  it('refuses a canonical action with an existing admin task', () => {
    expect(() => psql(command({
      planId: ids.sideEffectPlan,
      actionId: ids.sideEffectAction,
      approvalId: ids.sideEffectApproval,
      snapshotHash: hashes.sideEffect,
      reason: 'approval_expired',
    }))).toThrow(/require_canonical_quote_booking_reapproval_admin_task_exists/)
    expect(psql(`
      select approval_row.status || '|' || action_row.status || '|' || task_row.status
      from public.approvals as approval_row
      join public.agent_actions as action_row on action_row.id = approval_row.agent_action_id
      join public.admin_tasks as task_row on task_row.agent_action_id = action_row.id
      where approval_row.id = '${ids.sideEffectApproval}';
    `)).toBe('expired|executing|open')
  })

  it('never reopens generic executing work even if its approval expired', () => {
    expect(() => psql(command({
      planId: ids.genericPlan,
      actionId: ids.genericAction,
      approvalId: ids.genericApproval,
      snapshotHash: hashes.generic,
      reason: 'approval_expired',
    }))).toThrow(/require_canonical_quote_booking_reapproval_action_not_eligible/)
    expect(psql(`select status from public.agent_actions where id = '${ids.genericAction}';`)).toBe('executing')
  })
})
