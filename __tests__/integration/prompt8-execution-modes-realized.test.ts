import { execFileSync } from 'node:child_process'
import {
  completeExternalCheckoutHandoff,
  prepareExternalCheckoutHandoff,
} from '@/lib/planner/execution/externalCheckout'

const DATABASE_URL = process.env.PROMPT8_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_PROMPT8_DB_TESTS === '1'

const ids = {
  user: 'e8100000-0000-4000-8000-000000000001',
  operator: 'e8100000-0000-4000-8000-000000000002',
  builder: 'e8200000-0000-4000-8000-000000000001',
  venue: 'e8300000-0000-4000-8000-000000000001',
  discoveryVenue: 'e8400000-0000-4000-8000-000000000001',
  quoteResponse: 'e8500000-0000-4000-8000-000000000001',
  externalConfirmPlan: 'e8600000-0000-4000-8000-000000000001',
  externalCancelPlan: 'e8600000-0000-4000-8000-000000000002',
  holdCompletePlan: 'e8600000-0000-4000-8000-000000000003',
  holdCancelPlan: 'e8600000-0000-4000-8000-000000000004',
  quotePlan: 'e8600000-0000-4000-8000-000000000005',
  externalConfirmAction: 'e8700000-0000-4000-8000-000000000001',
  externalCancelAction: 'e8700000-0000-4000-8000-000000000002',
  holdCompleteAction: 'e8700000-0000-4000-8000-000000000003',
  holdCancelAction: 'e8700000-0000-4000-8000-000000000004',
  quoteAction: 'e8700000-0000-4000-8000-000000000005',
  externalConfirmApproval: 'e8800000-0000-4000-8000-000000000001',
  externalCancelApproval: 'e8800000-0000-4000-8000-000000000002',
  holdCompleteApproval: 'e8800000-0000-4000-8000-000000000003',
  holdCancelApproval: 'e8800000-0000-4000-8000-000000000004',
  quoteApproval: 'e8800000-0000-4000-8000-000000000005',
}

const hashes = {
  externalConfirm: '1'.repeat(64),
  externalCancel: '2'.repeat(64),
  holdComplete: '3'.repeat(64),
  holdCancel: '4'.repeat(64),
  quote: '5'.repeat(64),
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

function jsonLiteral(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
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
    begin;
    set constraints all deferred;
    delete from public.venue_bookings where organizer_id = '${ids.user}';
    delete from public.vendor_bookings where organizer_id = '${ids.user}';
    delete from public.plans where user_id = '${ids.user}';
    delete from public.events where builder_id = '${ids.builder}';
    delete from public.discovery_venues where id = '${ids.discoveryVenue}';
    delete from public.venues where id = '${ids.venue}';
    delete from public.builder_profiles where id = '${ids.builder}';
    delete from public.users where id = '${ids.user}';
    delete from auth.users where id in ('${ids.user}', '${ids.operator}');
    commit;
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.user}', 'authenticated', 'authenticated', 'prompt8-realized@example.com', now(), now()),
      ('${ids.operator}', 'authenticated', 'authenticated', 'prompt8-operator@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values ('${ids.user}', 'prompt8-realized@example.com', 'builder', 'community_builder');

    insert into public.builder_profiles (id, user_id, name)
    values ('${ids.builder}', '${ids.user}', 'Prompt 8 Realized Host');

    insert into public.venues (id, venue_name, is_admin_seeded, claim_status)
    values ('${ids.venue}', 'Prompt 8 Claimed Venue', true, 'invited_unclaimed');

    insert into public.discovery_venues (id, name, is_claimed, claimed_venue_id)
    values ('${ids.discoveryVenue}', 'Prompt 8 Discovery Venue', true, '${ids.venue}');

    insert into public.plans (
      id, user_id, title, event_type, status, guest_count, budget_cap_cents,
      date_window_start, date_window_end, metadata
    ) values
      ('${ids.externalConfirmPlan}', '${ids.user}', 'External confirm', 'Founder dinner', 'ready', 24, 25000,
       current_date + 30, current_date + 30, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.externalCancelPlan}', '${ids.user}', 'External cancel', 'Founder dinner', 'ready', 24, 25000,
       current_date + 31, current_date + 31, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.holdCompletePlan}', '${ids.user}', 'Hold complete', 'Founder dinner', 'ready', 24, 25000,
       current_date + 32, current_date + 32, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.holdCancelPlan}', '${ids.user}', 'Hold cancel', 'Founder dinner', 'ready', 24, 25000,
       current_date + 33, current_date + 33, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.quotePlan}', '${ids.user}', 'Trusted quote booking', 'Founder dinner', 'ready', 24, 125000,
       current_date + 34, current_date + 34, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}');

    insert into public.agent_actions (
      id, plan_id, action_type, description, provider, target_type, target_id,
      amount_cents, status, payload_json
    ) values
      ('${ids.externalConfirmAction}', '${ids.externalConfirmPlan}', 'external_checkout', 'Open approved checkout',
       'Tickets Example', 'external_provider', null, 11000, 'pending',
       '{"kind":"external_checkout","external_url":"https://tickets.example/confirm"}'),
      ('${ids.externalCancelAction}', '${ids.externalCancelPlan}', 'external_checkout', 'Open approved checkout',
       'Tickets Example', 'external_provider', null, 12000, 'pending',
       '{"kind":"external_checkout","external_url":"https://tickets.example/cancel"}'),
      ('${ids.holdCompleteAction}', '${ids.holdCompletePlan}', 'hold_request', 'Place venue hold',
       'Prompt 8 Discovery Venue', 'discovery_venue', '${ids.discoveryVenue}', 5000, 'pending',
       '{"kind":"venue_hold","target_name":"Prompt 8 Discovery Venue"}'),
      ('${ids.holdCancelAction}', '${ids.holdCancelPlan}', 'hold_request', 'Place venue hold',
       'Prompt 8 Discovery Venue', 'discovery_venue', '${ids.discoveryVenue}', 5000, 'pending',
       '{"kind":"venue_hold","target_name":"Prompt 8 Discovery Venue"}');

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date, status,
      price_cents, fees_cents, requested_amount_cents, expires_at,
      snapshot_hash, snapshot_json, snapshot_schema_version
    ) values
      ('${ids.externalConfirmApproval}', '${ids.externalConfirmPlan}', '${ids.externalConfirmAction}',
       'External checkout', 'Tickets Example', current_date + 30, 'pending', 11000, 0, 11000,
       now() + interval '7 days', '${hashes.externalConfirm}', '{"schema_version":2}', 2),
      ('${ids.externalCancelApproval}', '${ids.externalCancelPlan}', '${ids.externalCancelAction}',
       'External checkout', 'Tickets Example', current_date + 31, 'pending', 12000, 0, 12000,
       now() + interval '7 days', '${hashes.externalCancel}', '{"schema_version":2}', 2),
      ('${ids.holdCompleteApproval}', '${ids.holdCompletePlan}', '${ids.holdCompleteAction}',
       'Place venue hold', 'Prompt 8 Discovery Venue', current_date + 32, 'pending', 5000, 0, 5000,
       now() + interval '7 days', '${hashes.holdComplete}', '{"schema_version":2}', 2),
      ('${ids.holdCancelApproval}', '${ids.holdCancelPlan}', '${ids.holdCancelAction}',
       'Place venue hold', 'Prompt 8 Discovery Venue', current_date + 33, 'pending', 5000, 0, 5000,
       now() + interval '7 days', '${hashes.holdCancel}', '{"schema_version":2}', 2);

    update public.agent_actions as action_row
    set approval_id = approval_row.id
    from public.approvals as approval_row
    where approval_row.agent_action_id = action_row.id
      and action_row.plan_id in (
        '${ids.externalConfirmPlan}', '${ids.externalCancelPlan}',
        '${ids.holdCompletePlan}', '${ids.holdCancelPlan}'
      );

    insert into public.venue_outreach_responses (
      id, plan_id, discovery_venue_id, gmail_thread_id, classification,
      classification_confidence, quoted_price_cents, quoted_deal_model,
      availability_confirmed, capacity_confirmed, conditions, raw_response_excerpt
    ) values (
      '${ids.quoteResponse}', '${ids.quotePlan}', '${ids.discoveryVenue}', 'prompt8-quote-thread',
      'quote_received', 0.99, 125000, 'flat_fee', true, 50,
      '["Hold for seven days"]', 'Available for $1,250 on the requested date.'
    );
  `)
}

function authorize(planId: string, approvalId: string, amountCents: number): void {
  expect(psql(asService(`
    update public.approvals
    set status = 'authorized',
        authorized_amount_cents = ${amountCents},
        authorized_by = '${ids.user}',
        authorized_at = transaction_timestamp(),
        approved_by = '${ids.user}',
        approved_at = transaction_timestamp()
    where id = '${approvalId}' and plan_id = '${planId}'
    returning status;
  `))).toBe('authorized')
  expect(psql(asService(`
    update public.agent_actions as action_row
    set status = 'approved'
    from public.approvals as approval_row
    where approval_row.id = '${approvalId}'
      and approval_row.plan_id = '${planId}'
      and action_row.id = approval_row.agent_action_id
      and action_row.plan_id = approval_row.plan_id
      and action_row.status in ('pending', 'proposed')
    returning action_row.status;
  `))).toBe('approved')
}

function persistExternalReady(input: {
  planId: string
  actionId: string
  approvalId: string
  snapshotHash: string
  externalUrl: string
}): unknown {
  const prepared = prepareExternalCheckoutHandoff({
    action: {
      id: input.actionId,
      plan_id: input.planId,
      action_type: 'external_checkout',
      approval_id: input.approvalId,
      payload_json: { external_url: input.externalUrl },
      result_metadata: {},
    },
    approval: {
      id: input.approvalId,
      agent_action_id: input.actionId,
      status: 'authorized',
      snapshot_hash: input.snapshotHash,
    },
    now: new Date('2026-07-10T18:00:00.000Z'),
  })

  expect(psql(asService(`
    update public.agent_actions
    set status = 'executing', result_metadata = ${jsonLiteral(prepared.resultMetadata)}
    where id = '${input.actionId}' and plan_id = '${input.planId}' and status = 'approved'
    returning status;
  `))).toBe('executing')
  return prepared.resultMetadata
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('Prompt 8 realized execution-mode lifecycles', () => {
  beforeAll(setup)
  afterAll(cleanup)

  it('records external checkout handoff evidence and host confirmation without mutating authorization', () => {
    authorize(ids.externalConfirmPlan, ids.externalConfirmApproval, 11000)
    const readyMetadata = persistExternalReady({
      planId: ids.externalConfirmPlan,
      actionId: ids.externalConfirmAction,
      approvalId: ids.externalConfirmApproval,
      snapshotHash: hashes.externalConfirm,
      externalUrl: 'https://tickets.example/confirm',
    })
    const completed = completeExternalCheckoutHandoff({
      resultMetadata: readyMetadata,
      confirmedBy: ids.user,
      now: new Date('2026-07-10T18:05:00.000Z'),
    })

    expect(psql(asService(`
      update public.agent_actions
      set status = 'complete', executed_at = '2026-07-10T18:05:00.000Z',
          result_metadata = ${jsonLiteral(completed.resultMetadata)}
      where id = '${ids.externalConfirmAction}' and status = 'executing'
      returning status;

      insert into public.plan_messages (plan_id, role, content, message_type, metadata)
      values (
        '${ids.externalConfirmPlan}', 'agent',
        'You confirmed the external checkout with Tickets Example was completed.',
        'status_update',
        jsonb_build_object('state', 'external_checkout_completed',
          'agent_action_id', '${ids.externalConfirmAction}'::uuid,
          'approval_id', '${ids.externalConfirmApproval}'::uuid)
      );
    `))).toBe('complete')

    expect(psql(`
      select action_row.status || '|' ||
        (action_row.result_metadata #>> '{external_checkout,status}') || '|' ||
        approval_row.status || '|' || approval_row.snapshot_hash || '|' ||
        (approval_row.authorized_by = '${ids.user}')::text
      from public.agent_actions as action_row
      join public.approvals as approval_row on approval_row.id = action_row.approval_id
      where action_row.id = '${ids.externalConfirmAction}';
    `)).toBe(`complete|completed|authorized|${hashes.externalConfirm}|true`)
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.externalConfirmPlan}' and metadata ->> 'state' = 'external_checkout_completed';`)).toBe('1')
  })

  it('cancels ready external checkout evidence idempotently and preserves authorization', () => {
    authorize(ids.externalCancelPlan, ids.externalCancelApproval, 12000)
    persistExternalReady({
      planId: ids.externalCancelPlan,
      actionId: ids.externalCancelAction,
      approvalId: ids.externalCancelApproval,
      snapshotHash: hashes.externalCancel,
      externalUrl: 'https://tickets.example/cancel',
    })

    const cancelSql = asService(`
      select
        (result ->> 'existing') || '|' || (result ->> 'action_status') || '|' ||
        (result ->> 'approval_status')
      from (
        select public.cancel_external_checkout_handoff(
          '${ids.externalCancelPlan}', '${ids.externalCancelAction}',
          '${ids.externalCancelApproval}', '${hashes.externalCancel}',
          'prompt8-external-cancel-1', '${ids.user}', 'Host changed plans.'
        ) as result
      ) as command;
    `)
    expect(psql(cancelSql)).toBe('false|cancelled|authorized')
    expect(psql(cancelSql)).toBe('true|cancelled|authorized')
    expect(psql(`
      select (result_metadata #>> '{external_checkout,status}') || '|' ||
        (result_metadata #>> '{external_checkout,external_url}')
      from public.agent_actions where id = '${ids.externalCancelAction}';
    `)).toBe('cancelled|https://tickets.example/cancel')
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.externalCancelPlan}' and metadata ->> 'state' = 'external_checkout_cancelled';`)).toBe('1')
  })

  it('enqueues one concierge hold task and projects operator completion to plan, event, action, and chat', () => {
    authorize(ids.holdCompletePlan, ids.holdCompleteApproval, 5000)
    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.holdCompletePlan}', '${ids.user}', 'founder_operator_dinner',
        current_date + 32, '18:00'::time, 120, 'America/Los_Angeles'
      );
    `))
    const enqueue = asService(`
      select id from public.enqueue_approved_admin_task(
        '${ids.holdCompletePlan}', '${ids.holdCompleteAction}', '${ids.holdCompleteApproval}',
        '${ids.user}', 'concierge_booking', 'Place the approved venue hold', 'high',
        '{"outbound_message_sent":false}', null,
        '3rdPlace queued the approved venue hold for operator follow-up.'
      );
    `)
    const taskId = psql(enqueue)
    expect(psql(enqueue)).toBe(taskId)
    expect(psql(`select count(*) from public.admin_tasks where agent_action_id = '${ids.holdCompleteAction}';`)).toBe('1')

    expect(psql(asService(`
      select status from public.complete_admin_task_execution(
        '${taskId}', '${ids.operator}',
        '{"outcome":"hold_confirmed","hold_reference":"P8-HOLD-001","hold_expires_at":"2026-08-15T18:00:00Z","summary":"Venue confirmed the approved hold."}',
        null, 'Realized Prompt 8 operator completion.'
      );
    `))).toBe('complete')

    expect(psql(`
      select task_row.status || '|' || action_row.status || '|' ||
        (plan_row.latest_venue_hold_outcome ->> 'hold_reference') || '|' ||
        (event_row.latest_venue_hold_outcome ->> 'hold_reference') || '|' ||
        approval_row.status
      from public.admin_tasks as task_row
      join public.agent_actions as action_row on action_row.id = task_row.agent_action_id
      join public.approvals as approval_row on approval_row.id = task_row.approval_id
      join public.plans as plan_row on plan_row.id = task_row.plan_id
      join public.events as event_row on event_row.id = task_row.event_id
      where task_row.id = '${taskId}' and event_row.id = '${eventId}';
    `)).toBe('complete|complete|P8-HOLD-001|P8-HOLD-001|authorized')
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.holdCompletePlan}' and metadata ->> 'state' = 'concierge_task_completed';`)).toBe('1')
  })

  it('replays concierge cancellation without duplicate task or host message and keeps approval immutable', () => {
    authorize(ids.holdCancelPlan, ids.holdCancelApproval, 5000)
    const taskId = psql(asService(`
      select id from public.enqueue_approved_admin_task(
        '${ids.holdCancelPlan}', '${ids.holdCancelAction}', '${ids.holdCancelApproval}',
        '${ids.user}', 'concierge_booking', 'Place the approved venue hold', 'high', '{}', null, null
      );
    `))
    const cancel = asService(`
      select status from public.cancel_approved_admin_task(
        '${ids.holdCancelPlan}', '${ids.holdCancelAction}', '${ids.holdCancelApproval}',
        '${ids.user}', 'Host changed plans.', null
      );
    `)
    expect(psql(cancel)).toBe('cancelled')
    expect(psql(cancel)).toBe('cancelled')
    expect(psql(`
      select task_row.status || '|' || action_row.status || '|' || approval_row.status || '|' || approval_row.snapshot_hash
      from public.admin_tasks as task_row
      join public.agent_actions as action_row on action_row.id = task_row.agent_action_id
      join public.approvals as approval_row on approval_row.id = task_row.approval_id
      where task_row.id = '${taskId}';
    `)).toBe(`cancelled|cancelled|authorized|${hashes.holdCancel}`)
    expect(psql(`select count(*) from public.admin_tasks where agent_action_id = '${ids.holdCancelAction}';`)).toBe('1')
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.holdCancelPlan}' and metadata ->> 'state' = 'concierge_task_cancelled';`)).toBe('1')
  })

  it('turns a trusted quote into one approved canonical booking and confirms visible plan state', () => {
    const staged = psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'venue', '${ids.quoteResponse}',
          '${ids.quoteAction}', '${ids.quoteApproval}', now() + interval '7 days',
          jsonb_build_object(
            'kind', 'canonical_quote_booking', 'quote_kind', 'venue',
            'quote_response_id', '${ids.quoteResponse}', 'target_id', '${ids.discoveryVenue}',
            'booking_slot', 'venue', 'event_date', (current_date + 34)::text,
            'requested_amount_cents', 125000
          ),
          '{"schema_version":2,"source":"trusted_outreach_response"}', '${hashes.quote}'
        ) as result
      ) as command;
    `))
    expect(staged).toBe('false|pending')
    authorize(ids.quotePlan, ids.quoteApproval, 125000)

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.quotePlan}', '${ids.user}', 'founder_operator_dinner',
        current_date + 34, '18:30'::time, 150, 'America/Los_Angeles'
      );
    `))
    const createBookingSql = asService(`
      select (result ->> 'booking_id') || '|' || (result ->> 'booking_status') || '|' ||
        (result ->> 'existing')
      from (
        select public.create_canonical_booking_from_approval(
          '${ids.quotePlan}', '${ids.quoteAction}', '${ids.quoteApproval}', '${ids.user}'
        ) as result
      ) as command;
    `)
    const [bookingId, bookingStatus, existing] = psql(createBookingSql).split('|')
    expect(bookingStatus).toBe('pending')
    expect(existing).toBe('false')
    expect(psql(createBookingSql)).toBe(`${bookingId}|pending|true`)

    const confirmSql = asService(`
      select (result ->> 'existing') || '|' || (result ->> 'booking_status') || '|' ||
        (result ->> 'action_status') || '|' || (result ->> 'plan_status')
      from (
        select public.confirm_canonical_booking(
          'venue', '${bookingId}', '${ids.operator}', '{"source":"prompt8_realized"}'
        ) as result
      ) as command;
    `)
    expect(psql(confirmSql)).toBe('false|confirmed|complete|booked')
    expect(psql(confirmSql)).toBe('true|confirmed|complete|booked')

    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        approval_row.status || '|' || (booking.event_id = '${eventId}')::text || '|' ||
        booking.quoted_price_cents::text
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.approvals as approval_row on approval_row.id = booking.approval_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)).toBe('confirmed|complete|booked|authorized|true|125000')
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.quotePlan}' and metadata ->> 'kind' = 'canonical_booking_confirmed';`)).toBe('1')
  })
})
