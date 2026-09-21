import { execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.CANONICAL_DECLINE_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_CANONICAL_DECLINE_DB_TESTS === '1'

const ids = {
  host: 'd8100000-0000-4000-8000-000000000001',
  venueOwner: 'd8100000-0000-4000-8000-000000000002',
  vendorOwner: 'd8100000-0000-4000-8000-000000000003',
  wrongActor: 'd8100000-0000-4000-8000-000000000004',
  builder: 'd8200000-0000-4000-8000-000000000001',
  venue: 'd8300000-0000-4000-8000-000000000001',
  vendor: 'd8300000-0000-4000-8000-000000000002',
  discoveryVenue: 'd8400000-0000-4000-8000-000000000001',
  discoveryVendor: 'd8400000-0000-4000-8000-000000000002',
  venueResponseOne: 'd8500000-0000-4000-8000-000000000001',
  venueResponseTwo: 'd8500000-0000-4000-8000-000000000002',
  vendorResponse: 'd8500000-0000-4000-8000-000000000003',
  terminalCancelCompletedResponse: 'd8500000-0000-4000-8000-000000000004',
  terminalCancelArchivedResponse: 'd8500000-0000-4000-8000-000000000005',
  terminalDeclineCompletedResponse: 'd8500000-0000-4000-8000-000000000006',
  terminalDeclineArchivedResponse: 'd8500000-0000-4000-8000-000000000007',
  terminalReplayCompletedResponse: 'd8500000-0000-4000-8000-000000000008',
  terminalReplayArchivedResponse: 'd8500000-0000-4000-8000-000000000009',
  venuePlanOne: 'd8600000-0000-4000-8000-000000000001',
  venuePlanTwo: 'd8600000-0000-4000-8000-000000000002',
  vendorPlan: 'd8600000-0000-4000-8000-000000000003',
  terminalCancelCompletedPlan: 'd8600000-0000-4000-8000-000000000004',
  terminalCancelArchivedPlan: 'd8600000-0000-4000-8000-000000000005',
  terminalDeclineCompletedPlan: 'd8600000-0000-4000-8000-000000000006',
  terminalDeclineArchivedPlan: 'd8600000-0000-4000-8000-000000000007',
  terminalReplayCompletedPlan: 'd8600000-0000-4000-8000-000000000008',
  terminalReplayArchivedPlan: 'd8600000-0000-4000-8000-000000000009',
  venueActionOne: 'd8700000-0000-4000-8000-000000000001',
  venueActionTwo: 'd8700000-0000-4000-8000-000000000002',
  vendorAction: 'd8700000-0000-4000-8000-000000000003',
  terminalCancelCompletedAction: 'd8700000-0000-4000-8000-000000000004',
  terminalCancelArchivedAction: 'd8700000-0000-4000-8000-000000000005',
  terminalDeclineCompletedAction: 'd8700000-0000-4000-8000-000000000006',
  terminalDeclineArchivedAction: 'd8700000-0000-4000-8000-000000000007',
  terminalReplayCompletedAction: 'd8700000-0000-4000-8000-000000000008',
  terminalReplayArchivedAction: 'd8700000-0000-4000-8000-000000000009',
  venueApprovalOne: 'd8800000-0000-4000-8000-000000000001',
  venueApprovalTwo: 'd8800000-0000-4000-8000-000000000002',
  vendorApproval: 'd8800000-0000-4000-8000-000000000003',
  terminalCancelCompletedApproval: 'd8800000-0000-4000-8000-000000000004',
  terminalCancelArchivedApproval: 'd8800000-0000-4000-8000-000000000005',
  terminalDeclineCompletedApproval: 'd8800000-0000-4000-8000-000000000006',
  terminalDeclineArchivedApproval: 'd8800000-0000-4000-8000-000000000007',
  terminalReplayCompletedApproval: 'd8800000-0000-4000-8000-000000000008',
  terminalReplayArchivedApproval: 'd8800000-0000-4000-8000-000000000009',
}

const hashes = {
  venueOne: 'a'.repeat(64),
  venueTwo: 'b'.repeat(64),
  vendor: 'c'.repeat(64),
  terminalCancelCompleted: 'd'.repeat(64),
  terminalCancelArchived: 'e'.repeat(64),
  terminalDeclineCompleted: 'f'.repeat(64),
  terminalDeclineArchived: '1'.repeat(64),
  terminalReplayCompleted: '2'.repeat(64),
  terminalReplayArchived: '3'.repeat(64),
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

function quotePayload(input: {
  kind: 'venue' | 'vendor'
  responseId: string
  targetId: string
  dateOffset: number
  amountCents: number
}): string {
  const targetType = input.kind === 'venue' ? 'discovery_venue' : 'discovery_vendor'
  return `jsonb_build_object(
    'kind', 'canonical_quote_booking',
    'quote_kind', '${input.kind}',
    'quote_response_id', '${input.responseId}',
    'target_type', '${targetType}',
    'target_id', '${input.targetId}',
    'booking_slot', '${input.kind === 'venue' ? 'venue' : 'vendor:catering'}',
    'event_date', (current_date + ${input.dateOffset})::text,
    'requested_amount_cents', ${input.amountCents}
  )`
}

function quoteSnapshot(input: {
  kind: 'venue' | 'vendor'
  targetId: string
  provider: string
  dateOffset: number
  amountCents: number
  payloadSql: string
}): string {
  const targetType = input.kind === 'venue' ? 'discovery_venue' : 'discovery_vendor'
  return `jsonb_build_object(
    'schema_version', 2,
    'approval', jsonb_build_object(
      'action_label', 'Approve booking request with ${input.provider}',
      'provider', '${input.provider}',
      'event_date', (current_date + ${input.dateOffset})::text,
      'requested_amount_cents', ${input.amountCents},
      'price_cents', ${input.amountCents},
      'fees_cents', 0,
      'notes', null
    ),
    'action', jsonb_build_object(
      'action_type', 'concierge_queue',
      'target_type', '${targetType}',
      'target_id', '${input.targetId}',
      'amount_cents', ${input.amountCents},
      'payload_json', ${input.payloadSql}
    ),
    'counterparty', jsonb_build_object(
      'provider', '${input.provider}',
      'target_type', '${targetType}',
      'target_id', '${input.targetId}'
    )
  )`
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
    delete from public.venue_bookings where organizer_id = '${ids.host}';
    delete from public.vendor_bookings where organizer_id = '${ids.host}';
    delete from public.plans where user_id = '${ids.host}';
    delete from public.events where builder_id = '${ids.builder}';
    delete from public.discovery_venues where id = '${ids.discoveryVenue}';
    delete from public.venues where id = '${ids.venue}';
    delete from public.vendor_profiles where id = '${ids.vendor}';
    delete from public.discovery_vendors where id = '${ids.discoveryVendor}';
    delete from public.builder_profiles where id = '${ids.builder}';
    delete from public.notifications where user_id in (
      '${ids.host}', '${ids.venueOwner}', '${ids.vendorOwner}', '${ids.wrongActor}'
    );
    delete from public.users where id in (
      '${ids.host}', '${ids.venueOwner}', '${ids.vendorOwner}', '${ids.wrongActor}'
    );
    delete from auth.users where id in (
      '${ids.host}', '${ids.venueOwner}', '${ids.vendorOwner}', '${ids.wrongActor}'
    );
    commit;
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.host}', 'authenticated', 'authenticated', 'decline-host@example.com', now(), now()),
      ('${ids.venueOwner}', 'authenticated', 'authenticated', 'decline-venue@example.com', now(), now()),
      ('${ids.vendorOwner}', 'authenticated', 'authenticated', 'decline-vendor@example.com', now(), now()),
      ('${ids.wrongActor}', 'authenticated', 'authenticated', 'decline-wrong@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values
      ('${ids.host}', 'decline-host@example.com', 'builder', 'community_builder'),
      ('${ids.venueOwner}', 'decline-venue@example.com', 'owner', 'venue_owner'),
      ('${ids.vendorOwner}', 'decline-vendor@example.com', 'vendor', 'vendor'),
      ('${ids.wrongActor}', 'decline-wrong@example.com', 'vendor', 'vendor');

    insert into public.builder_profiles (id, user_id, name)
    values ('${ids.builder}', '${ids.host}', 'Canonical Decline Host');

    insert into public.venues (id, owner_id, venue_name, is_admin_seeded, claim_status)
    values ('${ids.venue}', '${ids.venueOwner}', 'Canonical Decline Venue', true, 'self_signup');

    insert into public.discovery_venues (id, name, is_claimed, claimed_venue_id)
    values ('${ids.discoveryVenue}', 'Canonical Decline Discovery Venue', true, '${ids.venue}');

    insert into public.discovery_vendors (id, source, name, service_type)
    values ('${ids.discoveryVendor}', 'manual_seed', 'Canonical Decline Discovery Vendor', 'catering');

    insert into public.vendor_profiles (id, user_id, name, vendor_type, discovery_vendor_id)
    values (
      '${ids.vendor}', '${ids.vendorOwner}', 'Canonical Decline Vendor', 'Caterer', '${ids.discoveryVendor}'
    );

    insert into public.plans (
      id, user_id, title, event_type, status, guest_count, budget_cap_cents,
      date_window_start, date_window_end, metadata
    ) values
      ('${ids.venuePlanOne}', '${ids.host}', 'Decline venue one', 'Founder dinner', 'ready', 24, 125000,
       current_date + 41, current_date + 41, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.venuePlanTwo}', '${ids.host}', 'Decline venue two', 'Founder dinner', 'ready', 24, 135000,
       current_date + 42, current_date + 42, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.vendorPlan}', '${ids.host}', 'Decline vendor', 'Founder dinner', 'ready', 24, 45000,
       current_date + 43, current_date + 43, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalCancelCompletedPlan}', '${ids.host}', 'Cancel completed cleanup', 'Founder dinner', 'ready', 24, 125000,
       current_date + 44, current_date + 44, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalCancelArchivedPlan}', '${ids.host}', 'Cancel archived cleanup', 'Founder dinner', 'ready', 24, 125000,
       current_date + 45, current_date + 45, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalDeclineCompletedPlan}', '${ids.host}', 'Decline completed cleanup', 'Founder dinner', 'ready', 24, 125000,
       current_date + 46, current_date + 46, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalDeclineArchivedPlan}', '${ids.host}', 'Decline archived cleanup', 'Founder dinner', 'ready', 24, 125000,
       current_date + 47, current_date + 47, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalReplayCompletedPlan}', '${ids.host}', 'Replay completed confirmation', 'Founder dinner', 'ready', 24, 125000,
       current_date + 48, current_date + 48, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.terminalReplayArchivedPlan}', '${ids.host}', 'Replay archived confirmation', 'Founder dinner', 'ready', 24, 125000,
       current_date + 49, current_date + 49, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}');

    insert into public.venue_outreach_responses (
      id, plan_id, discovery_venue_id, gmail_thread_id, classification,
      classification_confidence, quoted_price_cents, quoted_deal_model,
      availability_confirmed, capacity_confirmed, conditions, raw_response_excerpt
    ) values
      ('${ids.venueResponseOne}', '${ids.venuePlanOne}', '${ids.discoveryVenue}', 'decline-venue-one',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for plan one.'),
      ('${ids.venueResponseTwo}', '${ids.venuePlanTwo}', '${ids.discoveryVenue}', 'decline-venue-two',
       'quote_received', 0.99, 135000, 'flat_fee', true, 50, '[]', 'Available for plan two.'),
      ('${ids.terminalCancelCompletedResponse}', '${ids.terminalCancelCompletedPlan}', '${ids.discoveryVenue}', 'terminal-cancel-completed',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for completed cancellation cleanup.'),
      ('${ids.terminalCancelArchivedResponse}', '${ids.terminalCancelArchivedPlan}', '${ids.discoveryVenue}', 'terminal-cancel-archived',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for archived cancellation cleanup.'),
      ('${ids.terminalDeclineCompletedResponse}', '${ids.terminalDeclineCompletedPlan}', '${ids.discoveryVenue}', 'terminal-decline-completed',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for completed decline cleanup.'),
      ('${ids.terminalDeclineArchivedResponse}', '${ids.terminalDeclineArchivedPlan}', '${ids.discoveryVenue}', 'terminal-decline-archived',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for archived decline cleanup.'),
      ('${ids.terminalReplayCompletedResponse}', '${ids.terminalReplayCompletedPlan}', '${ids.discoveryVenue}', 'terminal-replay-completed',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for completed confirmation replay.'),
      ('${ids.terminalReplayArchivedResponse}', '${ids.terminalReplayArchivedPlan}', '${ids.discoveryVenue}', 'terminal-replay-archived',
       'quote_received', 0.99, 125000, 'flat_fee', true, 50, '[]', 'Available for archived confirmation replay.');

    insert into public.vendor_outreach_responses (
      id, plan_id, discovery_vendor_id, gmail_thread_id, classification,
      classification_confidence, quoted_package_cents, availability_confirmed,
      conditions, raw_response_excerpt
    ) values (
      '${ids.vendorResponse}', '${ids.vendorPlan}', '${ids.discoveryVendor}', 'decline-vendor',
      'quote_received', 0.99, 45000, true, '[]', 'Available for the vendor plan.'
    );
  `)
}

function createCanonicalBooking(input: {
  kind: 'venue' | 'vendor'
  planId: string
  responseId: string
  actionId: string
  approvalId: string
  targetId: string
  provider: string
  dateOffset: number
  amountCents: number
  hash: string
}): string {
  const payload = quotePayload(input)
  const snapshot = quoteSnapshot({ ...input, payloadSql: payload })

  expect(psql(asService(`
    select result #>> '{approval,status}'
    from (
      select public.stage_plan_quote_booking(
        '${input.planId}', '${ids.host}', '${input.kind}', '${input.responseId}',
        '${input.actionId}', '${input.approvalId}', clock_timestamp() + interval '7 days',
        ${payload}, ${snapshot}, '${input.hash}'
      ) as result
    ) as command;
  `))).toBe('pending')

  expect(psql(asService(`
    update public.approvals
    set status = 'authorized',
        authorized_amount_cents = ${input.amountCents},
        authorized_by = '${ids.host}',
        authorized_at = transaction_timestamp(),
        approved_by = '${ids.host}',
        approved_at = transaction_timestamp()
    where id = '${input.approvalId}'
    returning status;

    update public.agent_actions
    set status = 'approved'
    where id = '${input.actionId}' and status in ('pending', 'proposed')
    returning status;
  `))).toBe('authorized\napproved')

  expect(psql(asService(`
    select event_id from public.materialize_plan_event(
      '${input.planId}', '${ids.host}', 'founder_operator_dinner',
      current_date + ${input.dateOffset}, '18:30'::time, 150, 'America/Los_Angeles'
    );
  `))).toMatch(/^[0-9a-f-]{36}$/)

  const [bookingId, status] = psql(asService(`
    select (result ->> 'booking_id') || '|' || (result ->> 'booking_status')
    from (
      select public.create_canonical_booking_from_approval(
        '${input.planId}', '${input.actionId}', '${input.approvalId}', '${ids.host}'
      ) as result
    ) as command;
  `)).split('|')
  expect(status).toBe('pending')
  expect(psql(asService(`
    update public.agent_actions set status = 'executing'
    where id = '${input.actionId}' and status = 'approved'
    returning status;
  `))).toBe('executing')
  return bookingId
}

function forcePlanStatus(input: {
  planId: string
  fromStatus: 'executing' | 'booked' | 'completed'
  toStatus: 'completed' | 'archived'
}): void {
  const output = psql(`
    begin;
    select set_config('app.plan_transition_plan_id', '${input.planId}', true);
    select set_config('app.plan_transition_from_status', '${input.fromStatus}', true);
    select set_config('app.plan_transition_to_status', '${input.toStatus}', true);
    select set_config('app.plan_transition_trigger', 'terminal_cleanup_fixture', true);
    update public.plans
    set status = '${input.toStatus}'::public.planner_plan_status
    where id = '${input.planId}' and status::text = '${input.fromStatus}'
    returning status::text;
    commit;
  `)
  expect(output.split('\n').at(-1)).toBe(input.toStatus)
}

function forceTerminalPlanStatus(input: {
  planId: string
  fromStatus: 'executing' | 'booked'
  terminalStatus: 'completed' | 'archived'
}): void {
  forcePlanStatus({
    planId: input.planId,
    fromStatus: input.fromStatus,
    toStatus: 'completed',
  })
  if (input.terminalStatus === 'archived') {
    forcePlanStatus({
      planId: input.planId,
      fromStatus: 'completed',
      toStatus: 'archived',
    })
  }
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('canonical booking partner decline realized lifecycle', () => {
  beforeAll(setup)
  afterAll(cleanup)

  it('is atomic, owner-bound, terminal, evidence-backed, and exactly replayable', () => {
    const venueBookingOne = createCanonicalBooking({
      kind: 'venue',
      planId: ids.venuePlanOne,
      responseId: ids.venueResponseOne,
      actionId: ids.venueActionOne,
      approvalId: ids.venueApprovalOne,
      targetId: ids.discoveryVenue,
      provider: 'Canonical Decline Discovery Venue',
      dateOffset: 41,
      amountCents: 125000,
      hash: hashes.venueOne,
    })
    const venueBookingTwo = createCanonicalBooking({
      kind: 'venue',
      planId: ids.venuePlanTwo,
      responseId: ids.venueResponseTwo,
      actionId: ids.venueActionTwo,
      approvalId: ids.venueApprovalTwo,
      targetId: ids.discoveryVenue,
      provider: 'Canonical Decline Discovery Venue',
      dateOffset: 42,
      amountCents: 135000,
      hash: hashes.venueTwo,
    })

    expect(() => psql(asService(`
      update public.venue_bookings set status = 'declined' where id = '${venueBookingOne}';
    `))).toThrow(/canonical_booking_requires_exact_executable_provenance/)

    expect(() => psql(asService(`
      select public.decline_canonical_bookings(
        'venue', array['${venueBookingOne}'::uuid], '${ids.wrongActor}',
        'Unavailable', '{"source":"wrong_actor"}'::jsonb
      );
    `))).toThrow(/decline_canonical_bookings_partner_mismatch/)

    expect(psql(asService(`
      update public.agent_actions set status = 'complete'
      where id = '${ids.venueActionTwo}' returning status;
    `))).toBe('complete')

    expect(() => psql(asService(`
      select public.decline_canonical_bookings(
        'venue', array['${venueBookingOne}'::uuid, '${venueBookingTwo}'::uuid],
        '${ids.venueOwner}', 'Unavailable', '{"source":"bulk_route"}'::jsonb
      );
    `))).toThrow(/decline_canonical_bookings_action_not_declineable/)

    expect(psql(`
      select booking.status || '|' || action_row.status
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      where booking.id in ('${venueBookingOne}', '${venueBookingTwo}')
      order by action_row.id;
    `)).toBe('pending|executing\npending|complete')

    expect(psql(asService(`
      update public.agent_actions set status = 'executing'
      where id = '${ids.venueActionTwo}' returning status;
    `))).toBe('executing')

    const batchSql = (source: string) => asService(`
      select (result ->> 'status') || '|' || (result ->> 'declined_count') || '|' ||
        (result ->> 'existing_count')
      from (
        select public.decline_canonical_bookings(
          'venue', array['${venueBookingOne}'::uuid, '${venueBookingTwo}'::uuid],
          '${ids.venueOwner}', 'Unavailable',
          jsonb_build_object('source', '${source}', 'route_confirmed', true)
        ) as result
      ) as command;
    `)
    expect(psql(batchSql('venue_bulk_rejection_route'))).toBe('complete|2|0')
    expect(psql(batchSql('venue_booking_detail_route'))).toBe('complete|2|2')

    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' ||
        booking.decline_reason || '|' || booking.rejection_reason
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.approvals as approval_row on approval_row.id = booking.approval_id
      where booking.id in ('${venueBookingOne}', '${venueBookingTwo}')
      order by booking.id;
    `)).toBe('declined|cancelled|authorized|Unavailable|Unavailable\ndeclined|cancelled|authorized|Unavailable|Unavailable')
    expect(psql(`
      select count(*) from public.agent_action_audit_log
      where action_id in ('${ids.venueActionOne}', '${ids.venueActionTwo}')
        and reason = 'canonical_booking.partner_declined';
    `)).toBe('2')
    expect(psql(`
      select count(*) from public.plan_messages
      where plan_id in ('${ids.venuePlanOne}', '${ids.venuePlanTwo}')
        and metadata ->> 'kind' = 'canonical_booking_declined';
    `)).toBe('2')

    expect(psql(asService(`
      select status from public.transition_plan_status(
        '${ids.venuePlanOne}', 'executing', 'archived', 'plan_archived',
        '${ids.host}', '{"reason":"decline_replay_test"}'::jsonb
      );
    `))).toBe('archived')
    expect(psql(asService(`
      update public.approvals set status = 'cancelled'
      where id = '${ids.venueApprovalOne}' returning status;
    `))).toBe('cancelled')

    expect(psql(asService(`
      select (result ->> 'existing_count') || '|' || (result #>> '{results,0,approval_status}')
      from (
        select public.decline_canonical_bookings(
          'venue', array['${venueBookingOne}'::uuid], '${ids.venueOwner}',
          'Unavailable', '{"source":"vendor_detail_replay","route_confirmed":true}'::jsonb
        ) as result
      ) as command;
    `))).toBe('1|cancelled')
    expect(psql(`
      select count(*) from public.agent_action_audit_log
      where action_id = '${ids.venueActionOne}' and reason = 'canonical_booking.partner_declined';
    `)).toBe('1')
    expect(psql(`
      select count(*) from public.plan_messages
      where plan_id = '${ids.venuePlanOne}' and metadata ->> 'kind' = 'canonical_booking_declined';
    `)).toBe('1')

    const vendorBooking = createCanonicalBooking({
      kind: 'vendor',
      planId: ids.vendorPlan,
      responseId: ids.vendorResponse,
      actionId: ids.vendorAction,
      approvalId: ids.vendorApproval,
      targetId: ids.discoveryVendor,
      provider: 'Canonical Decline Discovery Vendor',
      dateOffset: 43,
      amountCents: 45000,
      hash: hashes.vendor,
    })

    expect(() => psql(asService(`
      select public.decline_canonical_bookings(
        'vendor', array['${vendorBooking}'::uuid], '${ids.wrongActor}',
        'Unavailable', '{"source":"wrong_vendor"}'::jsonb
      );
    `))).toThrow(/decline_canonical_bookings_partner_mismatch/)
    expect(psql(asService(`
      select (result ->> 'declined_count') || '|' || (result ->> 'existing_count')
      from (
        select public.decline_canonical_bookings(
          'vendor', array['${vendorBooking}'::uuid], '${ids.vendorOwner}',
          'Unavailable', '{"source":"vendor_booking_reject_route"}'::jsonb
        ) as result
      ) as command;
    `))).toBe('1|0')
    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' ||
        booking.decline_reason || '|' || coalesce(booking.notes, '<null>')
      from public.vendor_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.approvals as approval_row on approval_row.id = booking.approval_id
      where booking.id = '${vendorBooking}';
    `)).toBe('declined|cancelled|authorized|Unavailable|<null>')
  })

  it('allows only negative cleanup or exact confirmed replay after a plan is terminal', () => {
    const cancellationCases = [
      {
        terminalStatus: 'completed',
        planId: ids.terminalCancelCompletedPlan,
        responseId: ids.terminalCancelCompletedResponse,
        actionId: ids.terminalCancelCompletedAction,
        approvalId: ids.terminalCancelCompletedApproval,
        dateOffset: 44,
        hash: hashes.terminalCancelCompleted,
      },
      {
        terminalStatus: 'archived',
        planId: ids.terminalCancelArchivedPlan,
        responseId: ids.terminalCancelArchivedResponse,
        actionId: ids.terminalCancelArchivedAction,
        approvalId: ids.terminalCancelArchivedApproval,
        dateOffset: 45,
        hash: hashes.terminalCancelArchived,
      },
    ] as const

    for (const fixture of cancellationCases) {
      const bookingId = createCanonicalBooking({
        kind: 'venue',
        planId: fixture.planId,
        responseId: fixture.responseId,
        actionId: fixture.actionId,
        approvalId: fixture.approvalId,
        targetId: ids.discoveryVenue,
        provider: 'Canonical Decline Discovery Venue',
        dateOffset: fixture.dateOffset,
        amountCents: 125000,
        hash: fixture.hash,
      })
      forceTerminalPlanStatus({
        planId: fixture.planId,
        fromStatus: 'executing',
        terminalStatus: fixture.terminalStatus,
      })

      expect(() => psql(asService(`
        select public.confirm_canonical_booking(
          'venue', '${bookingId}', '${ids.venueOwner}', '{"source":"terminal_first_confirmation"}'::jsonb
        );
      `))).toThrow(/confirm_canonical_booking_plan_not_confirmable/)
      expect(psql(`
        select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' || plan_row.status
        from public.venue_bookings as booking
        join public.agent_actions as action_row on action_row.id = booking.agent_action_id
        join public.approvals as approval_row on approval_row.id = booking.approval_id
        join public.plans as plan_row on plan_row.id = booking.plan_id
        where booking.id = '${bookingId}';
      `)).toBe(`pending|executing|authorized|${fixture.terminalStatus}`)
      expect(psql(`
        select
          (select count(*) from public.agent_action_audit_log
           where action_id = '${fixture.actionId}' and reason = 'canonical_booking.confirmed') || '|' ||
          (select count(*) from public.plan_messages
           where plan_id = '${fixture.planId}' and metadata ->> 'kind' = 'canonical_booking_confirmed');
      `)).toBe('0|0')

      const cancelSql = asService(`
        select (result ->> 'existing') || '|' || (result ->> 'booking_status') || '|' ||
          (result ->> 'action_status') || '|' || (result ->> 'approval_status') || '|' ||
          (result ->> 'plan_status')
        from (
          select public.cancel_executing_canonical_quote_booking(
            '${fixture.planId}', '${fixture.actionId}', '${fixture.approvalId}', '${ids.host}',
            'Terminal plan cleanup'
          ) as result
        ) as command;
      `)
      expect(psql(cancelSql)).toBe(`false|cancelled|cancelled|authorized|${fixture.terminalStatus}`)
      expect(psql(cancelSql)).toBe(`true|cancelled|cancelled|authorized|${fixture.terminalStatus}`)
      expect(psql(`
        select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' || plan_row.status
        from public.venue_bookings as booking
        join public.agent_actions as action_row on action_row.id = booking.agent_action_id
        join public.approvals as approval_row on approval_row.id = booking.approval_id
        join public.plans as plan_row on plan_row.id = booking.plan_id
        where booking.id = '${bookingId}';
      `)).toBe(`cancelled|cancelled|authorized|${fixture.terminalStatus}`)
      expect(psql(`
        select
          (select count(*) from public.agent_action_audit_log
           where action_id = '${fixture.actionId}'
             and reason = 'canonical_quote_booking.cancelled_after_authorization') || '|' ||
          (select count(*) from public.plan_messages
           where plan_id = '${fixture.planId}' and metadata ->> 'kind' = 'canonical_booking_cancelled');
      `)).toBe('1|1')
    }

    const declineCases = [
      {
        terminalStatus: 'completed',
        planId: ids.terminalDeclineCompletedPlan,
        responseId: ids.terminalDeclineCompletedResponse,
        actionId: ids.terminalDeclineCompletedAction,
        approvalId: ids.terminalDeclineCompletedApproval,
        dateOffset: 46,
        hash: hashes.terminalDeclineCompleted,
      },
      {
        terminalStatus: 'archived',
        planId: ids.terminalDeclineArchivedPlan,
        responseId: ids.terminalDeclineArchivedResponse,
        actionId: ids.terminalDeclineArchivedAction,
        approvalId: ids.terminalDeclineArchivedApproval,
        dateOffset: 47,
        hash: hashes.terminalDeclineArchived,
      },
    ] as const

    for (const fixture of declineCases) {
      const bookingId = createCanonicalBooking({
        kind: 'venue',
        planId: fixture.planId,
        responseId: fixture.responseId,
        actionId: fixture.actionId,
        approvalId: fixture.approvalId,
        targetId: ids.discoveryVenue,
        provider: 'Canonical Decline Discovery Venue',
        dateOffset: fixture.dateOffset,
        amountCents: 125000,
        hash: fixture.hash,
      })
      forceTerminalPlanStatus({
        planId: fixture.planId,
        fromStatus: 'executing',
        terminalStatus: fixture.terminalStatus,
      })

      expect(() => psql(asService(`
        select public.confirm_canonical_booking(
          'venue', '${bookingId}', '${ids.venueOwner}', '{"source":"terminal_first_confirmation"}'::jsonb
        );
      `))).toThrow(/confirm_canonical_booking_plan_not_confirmable/)
      expect(psql(asService(`
        select (result ->> 'existing_count') || '|' ||
          (result #>> '{results,0,booking_status}') || '|' ||
          (result #>> '{results,0,action_status}')
        from (
          select public.decline_canonical_bookings(
            'venue', array['${bookingId}'::uuid], '${ids.venueOwner}',
            'Terminal plan unavailable', '{"source":"terminal_cleanup"}'::jsonb
          ) as result
        ) as command;
      `))).toBe('0|declined|cancelled')
      expect(psql(`
        select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' || plan_row.status
        from public.venue_bookings as booking
        join public.agent_actions as action_row on action_row.id = booking.agent_action_id
        join public.approvals as approval_row on approval_row.id = booking.approval_id
        join public.plans as plan_row on plan_row.id = booking.plan_id
        where booking.id = '${bookingId}';
      `)).toBe(`declined|cancelled|authorized|${fixture.terminalStatus}`)
      expect(psql(`
        select
          (select count(*) from public.agent_action_audit_log
           where action_id = '${fixture.actionId}' and reason = 'canonical_booking.partner_declined') || '|' ||
          (select count(*) from public.plan_messages
           where plan_id = '${fixture.planId}' and metadata ->> 'kind' = 'canonical_booking_declined');
      `)).toBe('1|1')
    }

    const replayCases = [
      {
        terminalStatus: 'completed',
        planId: ids.terminalReplayCompletedPlan,
        responseId: ids.terminalReplayCompletedResponse,
        actionId: ids.terminalReplayCompletedAction,
        approvalId: ids.terminalReplayCompletedApproval,
        dateOffset: 48,
        hash: hashes.terminalReplayCompleted,
      },
      {
        terminalStatus: 'archived',
        planId: ids.terminalReplayArchivedPlan,
        responseId: ids.terminalReplayArchivedResponse,
        actionId: ids.terminalReplayArchivedAction,
        approvalId: ids.terminalReplayArchivedApproval,
        dateOffset: 49,
        hash: hashes.terminalReplayArchived,
      },
    ] as const

    for (const fixture of replayCases) {
      const bookingId = createCanonicalBooking({
        kind: 'venue',
        planId: fixture.planId,
        responseId: fixture.responseId,
        actionId: fixture.actionId,
        approvalId: fixture.approvalId,
        targetId: ids.discoveryVenue,
        provider: 'Canonical Decline Discovery Venue',
        dateOffset: fixture.dateOffset,
        amountCents: 125000,
        hash: fixture.hash,
      })
      const confirmSql = (source: string) => asService(`
        select (result ->> 'existing') || '|' || (result ->> 'booking_status') || '|' ||
          (result ->> 'action_status') || '|' || (result ->> 'plan_status')
        from (
          select public.confirm_canonical_booking(
            'venue', '${bookingId}', '${ids.venueOwner}', jsonb_build_object('source', '${source}')
          ) as result
        ) as command;
      `)
      expect(psql(confirmSql('initial_confirmation'))).toBe('false|confirmed|complete|booked')
      forceTerminalPlanStatus({
        planId: fixture.planId,
        fromStatus: 'booked',
        terminalStatus: fixture.terminalStatus,
      })
      expect(psql(confirmSql('terminal_exact_replay'))).toBe(
        `true|confirmed|complete|${fixture.terminalStatus}`,
      )
      expect(psql(`
        select booking.status || '|' || action_row.status || '|' || approval_row.status || '|' || plan_row.status
        from public.venue_bookings as booking
        join public.agent_actions as action_row on action_row.id = booking.agent_action_id
        join public.approvals as approval_row on approval_row.id = booking.approval_id
        join public.plans as plan_row on plan_row.id = booking.plan_id
        where booking.id = '${bookingId}';
      `)).toBe(`confirmed|complete|authorized|${fixture.terminalStatus}`)
      expect(psql(`
        select
          (select count(*) from public.agent_action_audit_log
           where action_id = '${fixture.actionId}' and reason = 'canonical_booking.confirmed') || '|' ||
          (select count(*) from public.plan_messages
           where plan_id = '${fixture.planId}' and metadata ->> 'kind' = 'canonical_booking_confirmed');
      `)).toBe('1|1')
    }
  })
})
