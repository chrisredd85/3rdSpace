import { execFile, execFileSync } from 'node:child_process'
import { prepareExternalCheckoutHandoff } from '@/lib/planner/execution/externalCheckout'

const DATABASE_URL = process.env.PROMPT8_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_PROMPT8_DB_TESTS === '1'

const ids = {
  user: 'e8100000-0000-4000-8000-000000000001',
  operator: 'e8100000-0000-4000-8000-000000000002',
  vendorUser: 'e8100000-0000-4000-8000-000000000003',
  wrongVendorUser: 'e8100000-0000-4000-8000-000000000004',
  builder: 'e8200000-0000-4000-8000-000000000001',
  venue: 'e8300000-0000-4000-8000-000000000001',
  wrongVenue: 'e8300000-0000-4000-8000-000000000002',
  vendor: 'e8300000-0000-4000-8000-000000000003',
  wrongVendor: 'e8300000-0000-4000-8000-000000000004',
  discoveryVenue: 'e8400000-0000-4000-8000-000000000001',
  discoveryVendor: 'e8400000-0000-4000-8000-000000000002',
  wrongDiscoveryVenue: 'e8400000-0000-4000-8000-000000000003',
  quoteResponse: 'e8500000-0000-4000-8000-000000000001',
  vendorQuoteResponse: 'e8500000-0000-4000-8000-000000000002',
  resumeQuoteResponse: 'e8500000-0000-4000-8000-000000000003',
  lateVendorQuoteResponse: 'e8500000-0000-4000-8000-000000000004',
  secondVenueQuoteResponse: 'e8500000-0000-4000-8000-000000000005',
  externalConfirmPlan: 'e8600000-0000-4000-8000-000000000001',
  externalCancelPlan: 'e8600000-0000-4000-8000-000000000002',
  holdCompletePlan: 'e8600000-0000-4000-8000-000000000003',
  holdCancelPlan: 'e8600000-0000-4000-8000-000000000004',
  quotePlan: 'e8600000-0000-4000-8000-000000000005',
  vendorQuotePlan: 'e8600000-0000-4000-8000-000000000006',
  resumeQuotePlan: 'e8600000-0000-4000-8000-000000000007',
  externalConfirmAction: 'e8700000-0000-4000-8000-000000000001',
  externalCancelAction: 'e8700000-0000-4000-8000-000000000002',
  holdCompleteAction: 'e8700000-0000-4000-8000-000000000003',
  holdCancelAction: 'e8700000-0000-4000-8000-000000000004',
  quoteAction: 'e8700000-0000-4000-8000-000000000005',
  vendorQuoteAction: 'e8700000-0000-4000-8000-000000000006',
  resumeQuoteAction: 'e8700000-0000-4000-8000-000000000007',
  lateVendorCancelAction: 'e8700000-0000-4000-8000-000000000008',
  lateVendorAction: 'e8700000-0000-4000-8000-000000000009',
  lateVendorReplayAction: 'e8700000-0000-4000-8000-000000000010',
  explicitFreeQuoteAction: 'e8700000-0000-4000-8000-000000000011',
  duplicateVenueSlotAction: 'e8700000-0000-4000-8000-000000000012',
  externalConfirmApproval: 'e8800000-0000-4000-8000-000000000001',
  externalCancelApproval: 'e8800000-0000-4000-8000-000000000002',
  holdCompleteApproval: 'e8800000-0000-4000-8000-000000000003',
  holdCancelApproval: 'e8800000-0000-4000-8000-000000000004',
  quoteApproval: 'e8800000-0000-4000-8000-000000000005',
  vendorQuoteApproval: 'e8800000-0000-4000-8000-000000000006',
  resumeQuoteApproval: 'e8800000-0000-4000-8000-000000000007',
  lateVendorCancelApproval: 'e8800000-0000-4000-8000-000000000008',
  lateVendorApproval: 'e8800000-0000-4000-8000-000000000009',
  lateVendorReplayApproval: 'e8800000-0000-4000-8000-000000000010',
  explicitFreeQuoteApproval: 'e8800000-0000-4000-8000-000000000011',
  duplicateVenueSlotApproval: 'e8800000-0000-4000-8000-000000000012',
  wrongPartnerVenueBooking: 'e8900000-0000-4000-8000-000000000001',
  wrongPartnerVendorBooking: 'e8900000-0000-4000-8000-000000000002',
  unprovenancedQuoteBooking: 'e8900000-0000-4000-8000-000000000099',
  authenticatedOrganizerBooking: 'e8900000-0000-4000-8000-000000000097',
  legacyDowngradeEvent: 'e8900000-0000-4000-8000-000000000098',
  invalidTermSuccessorApproval: 'e8800000-0000-4000-8000-000000000098',
  vendorPackage: 'e8a00000-0000-4000-8000-000000000001',
}

const hashes = {
  externalConfirm: '1'.repeat(64),
  externalCancel: '2'.repeat(64),
  holdComplete: '3'.repeat(64),
  holdCancel: '4'.repeat(64),
  quote: '5'.repeat(64),
  vendorQuote: '6'.repeat(64),
  resumeQuote: 'a'.repeat(64),
  lateVendorCancel: 'b'.repeat(64),
  lateVendor: 'c'.repeat(64),
  explicitFreeQuote: 'd'.repeat(64),
  duplicateVenueSlot: 'e'.repeat(64),
  vendorQuoteRevision: '7'.repeat(64),
  vendorQuoteInvalidRevision: '8'.repeat(64),
  vendorQuoteInvalidTerms: '9'.repeat(64),
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

function psqlAsync(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('psql', [
      DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', sql,
    ], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve(stdout.trim())
    })
  })
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

function asAuthenticatedUser(userId: string, sql: string): string {
  return `
    begin;
    set local role authenticated;
    set local request.jwt.claim.role = 'authenticated';
    set local request.jwt.claim.sub = '${userId}';
    ${sql}
    commit;
  `
}

function jsonLiteral(value: unknown): string {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
}

function canonicalQuotePayloadSql(input: {
  quoteKind: 'venue' | 'vendor'
  responseId: string
  targetId: string
  bookingSlot: string
  eventDateOffsetDays: number
  amountCents: number
}): string {
  const targetType = input.quoteKind === 'venue' ? 'discovery_venue' : 'discovery_vendor'
  return `jsonb_build_object(
    'kind', 'canonical_quote_booking', 'quote_kind', '${input.quoteKind}',
    'quote_response_id', '${input.responseId}', 'target_type', '${targetType}',
    'target_id', '${input.targetId}', 'booking_slot', '${input.bookingSlot}',
    'event_date', (current_date + ${input.eventDateOffsetDays})::text,
    'requested_amount_cents', ${input.amountCents}, 'price_cents', ${input.amountCents}
  )`
}

function canonicalQuoteSnapshotSql(input: {
  quoteKind: 'venue' | 'vendor'
  targetId: string
  provider: string
  eventDateOffsetDays: number
  amountCents: number
  payloadSql: string
}): string {
  const targetType = input.quoteKind === 'venue' ? 'discovery_venue' : 'discovery_vendor'
  return `jsonb_build_object(
    'schema_version', 2,
    'approval', jsonb_build_object(
      'action_label', 'Approve booking request with ${input.provider}',
      'provider', '${input.provider}',
      'event_date', (current_date + ${input.eventDateOffsetDays})::text,
      'requested_amount_cents', ${input.amountCents},
      'price_cents', ${input.amountCents},
      'fees_cents', 0,
      'notes', null
    ),
    'action', jsonb_build_object(
      'action_type', 'concierge_queue', 'target_type', '${targetType}',
      'target_id', '${input.targetId}', 'amount_cents', ${input.amountCents},
      'payload_json', ${input.payloadSql}
    ),
    'counterparty', jsonb_build_object(
      'provider', '${input.provider}', 'target_type', '${targetType}',
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
    delete from public.venue_bookings where organizer_id = '${ids.user}';
    delete from public.vendor_bookings where organizer_id = '${ids.user}';
    delete from public.plans where user_id = '${ids.user}';
    delete from public.events where builder_id = '${ids.builder}';
    delete from public.discovery_venues where id in ('${ids.discoveryVenue}', '${ids.wrongDiscoveryVenue}');
    delete from public.venues where id in ('${ids.venue}', '${ids.wrongVenue}');
    delete from public.vendor_profiles where id in ('${ids.vendor}', '${ids.wrongVendor}');
    delete from public.discovery_vendors where id = '${ids.discoveryVendor}';
    delete from public.builder_profiles where id = '${ids.builder}';
    delete from public.notifications where user_id in (
      '${ids.user}', '${ids.vendorUser}', '${ids.wrongVendorUser}'
    );
    delete from public.users where id in (
      '${ids.user}', '${ids.operator}', '${ids.vendorUser}', '${ids.wrongVendorUser}'
    );
    delete from auth.users where id in (
      '${ids.user}', '${ids.operator}', '${ids.vendorUser}', '${ids.wrongVendorUser}'
    );
    commit;
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.user}', 'authenticated', 'authenticated', 'prompt8-realized@example.com', now(), now()),
      ('${ids.operator}', 'authenticated', 'authenticated', 'prompt8-operator@example.com', now(), now()),
      ('${ids.vendorUser}', 'authenticated', 'authenticated', 'prompt8-vendor@example.com', now(), now()),
      ('${ids.wrongVendorUser}', 'authenticated', 'authenticated', 'prompt8-wrong-vendor@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values
      ('${ids.user}', 'prompt8-realized@example.com', 'builder', 'community_builder'),
      ('${ids.operator}', 'prompt8-operator@example.com', 'owner', 'venue_owner'),
      ('${ids.vendorUser}', 'prompt8-vendor@example.com', 'vendor', 'vendor'),
      ('${ids.wrongVendorUser}', 'prompt8-wrong-vendor@example.com', 'vendor', 'vendor');

    insert into public.builder_profiles (id, user_id, name)
    values ('${ids.builder}', '${ids.user}', 'Prompt 8 Realized Host');

    insert into public.venues (id, owner_id, venue_name, is_admin_seeded, claim_status)
    values
      ('${ids.venue}', '${ids.operator}', 'Prompt 8 Claimed Venue', true, 'self_signup'),
      ('${ids.wrongVenue}', '${ids.wrongVendorUser}', 'Prompt 8 Wrong Venue', true, 'self_signup');

    insert into public.discovery_venues (id, name, is_claimed, claimed_venue_id)
    values
      ('${ids.discoveryVenue}', 'Prompt 8 Discovery Venue', true, '${ids.venue}'),
      ('${ids.wrongDiscoveryVenue}', 'Prompt 8 Wrong Discovery Venue', true, '${ids.wrongVenue}');

    insert into public.discovery_vendors (id, source, name, service_type)
    values ('${ids.discoveryVendor}', 'manual_seed', 'Prompt 8 Discovery Vendor', 'catering');

    insert into public.vendor_profiles (id, user_id, name, vendor_type, discovery_vendor_id)
    values
      ('${ids.vendor}', '${ids.vendorUser}', 'Prompt 8 Claimed Vendor', 'Caterer', '${ids.discoveryVendor}'),
      ('${ids.wrongVendor}', '${ids.wrongVendorUser}', 'Prompt 8 Wrong Vendor', 'Caterer', null);

    insert into public.vendor_packages (id, vendor_id, package_name, price)
    values ('${ids.vendorPackage}', '${ids.vendor}', 'Unapproved Prompt 8 Package', 900);

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
       current_date + 34, current_date + 34, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.vendorQuotePlan}', '${ids.user}', 'Trusted vendor quote booking', 'Founder dinner', 'ready', 24, 45000,
       current_date + 35, current_date + 35, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}'),
      ('${ids.resumeQuotePlan}', '${ids.user}', 'Atomic quote resume', 'Founder dinner', 'ready', 24, 125000,
       current_date + 36, current_date + 36, '{"event_archetype_lock":{"key":"founder_operator_dinner"}}');

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
    ) values
      (
        '${ids.quoteResponse}', '${ids.quotePlan}', '${ids.discoveryVenue}', 'prompt8-quote-thread',
        'quote_received', 0.99, 125000, 'flat_fee', true, 50,
        '["Hold for seven days"]', 'Available for $1,250 on the requested date.'
      ),
      (
        '${ids.resumeQuoteResponse}', '${ids.resumeQuotePlan}', '${ids.discoveryVenue}',
        'prompt8-resume-quote-thread', 'quote_received', 0.99, 125000, 'flat_fee',
        true, 50, '["Hold for seven days"]', 'Available for $1,250 on the requested date.'
      ),
      (
        '${ids.secondVenueQuoteResponse}', '${ids.quotePlan}', '${ids.discoveryVenue}',
        'prompt8-second-venue-quote-thread', 'quote_received', 0.99, 130000, 'flat_fee',
        true, 50, '["Second venue quote"]', 'Available for $1,300 on the requested date.'
      );

    insert into public.vendor_outreach_responses (
      id, plan_id, discovery_vendor_id, gmail_thread_id, classification,
      classification_confidence, quoted_package_cents, availability_confirmed,
      conditions, raw_response_excerpt
    ) values
      (
        '${ids.vendorQuoteResponse}', '${ids.vendorQuotePlan}', '${ids.discoveryVendor}',
        'prompt8-vendor-quote-thread', 'quote_received', 0.99, 45000, true,
        '["Includes setup"]', 'Available for $450 on the requested date.'
      ),
      (
        '${ids.lateVendorQuoteResponse}', '${ids.quotePlan}', '${ids.discoveryVendor}',
        'prompt8-late-vendor-quote-thread', 'quote_received', 0.99, 45000, true,
        '["Includes setup"]', 'Available for $450 on the requested date.'
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
    expect(readyMetadata).toBeDefined()

    const confirmSql = asService(`
      select
        (result ->> 'existing') || '|' || (result ->> 'action_status') || '|' ||
        (result ->> 'approval_status')
      from (
        select public.confirm_external_checkout_handoff(
          '${ids.externalConfirmPlan}', '${ids.externalConfirmAction}',
          '${ids.externalConfirmApproval}', '${hashes.externalConfirm}', '${ids.user}'
        ) as result
      ) as command;
    `)
    expect(psql(confirmSql)).toBe('false|complete|authorized')
    expect(psql(confirmSql)).toBe('true|complete|authorized')

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
    expect(psql(`select count(*) from public.agent_action_audit_log where action_id = '${ids.externalConfirmAction}' and reason = 'external_checkout.host_confirmed';`)).toBe('1')
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

  it('re-resolves a hold queued before materialization and projects operator completion to the canonical event', async () => {
    authorize(ids.holdCompletePlan, ids.holdCompleteApproval, 5000)
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
    expect(psql(`select (event_id is null)::text from public.admin_tasks where id = '${taskId}';`)).toBe('true')

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.holdCompletePlan}', '${ids.user}', 'founder_operator_dinner',
        current_date + 32, '18:00'::time, 120, 'America/Los_Angeles'
      );
    `))

    const [completed, replayedQueue] = await Promise.all([
      psqlAsync(asService(`
        select status from public.complete_admin_task_execution(
          '${taskId}', '${ids.operator}',
          '{"outcome":"hold_confirmed","hold_reference":"P8-HOLD-001","hold_expires_at":"2026-08-15T18:00:00Z","summary":"Venue confirmed the approved hold."}',
          null, 'Realized Prompt 8 operator completion.'
        );
      `)),
      psqlAsync(enqueue),
    ])
    expect(completed).toBe('complete')
    expect(replayedQueue).toBe(taskId)

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

  it('atomically claims materialization resume, rolls back on audit failure, and replays once', () => {
    const actionPayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'venue',
      responseId: ids.resumeQuoteResponse,
      targetId: ids.discoveryVenue,
      bookingSlot: 'venue',
      eventDateOffsetDays: 36,
      amountCents: 125000,
    })
    const approvalSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'venue',
      targetId: ids.discoveryVenue,
      provider: 'Prompt 8 Discovery Venue',
      eventDateOffsetDays: 36,
      amountCents: 125000,
      payloadSql: actionPayloadSql,
    })
    expect(psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.resumeQuotePlan}', '${ids.user}', 'venue', '${ids.resumeQuoteResponse}',
          '${ids.resumeQuoteAction}', '${ids.resumeQuoteApproval}', clock_timestamp() + interval '7 days',
          ${actionPayloadSql}, ${approvalSnapshotSql}, '${hashes.resumeQuote}'
        ) as result
      ) as command;
    `))).toBe('false|pending')
    authorize(ids.resumeQuotePlan, ids.resumeQuoteApproval, 125000)

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.resumeQuotePlan}', '${ids.user}', 'founder_operator_dinner',
        current_date + 36, '18:30'::time, 150, 'America/Los_Angeles'
      );
    `))
    const claimSql = asService(`
      select (result ->> 'existing') || '|' || (result ->> 'transitioned') || '|' ||
        (result #>> '{agent_action,status}')
      from (
        select public.claim_canonical_quote_booking_materialization_resume(
          '${ids.resumeQuotePlan}', '${ids.resumeQuoteAction}', '${ids.resumeQuoteApproval}',
          '${ids.user}', '${hashes.resumeQuote}'
        ) as result
      ) as command;
    `)

    try {
      psql(`
        create or replace function public.prompt8_reject_resume_audit()
        returns trigger language plpgsql set search_path = public, pg_temp
        as \$test\$
        begin
          if new.action_id = '${ids.resumeQuoteAction}'
            and new.reason = 'canonical_quote_booking.materialization_resume'
          then
            raise exception 'prompt8_resume_audit_failure';
          end if;
          return new;
        end;
        \$test\$;
        create trigger prompt8_reject_resume_audit
          before insert on public.agent_action_audit_log
          for each row execute function public.prompt8_reject_resume_audit();
      `)
      expect(() => psql(claimSql)).toThrow(/prompt8_resume_audit_failure/)
    } finally {
      psql(`
        drop trigger if exists prompt8_reject_resume_audit on public.agent_action_audit_log;
        drop function if exists public.prompt8_reject_resume_audit();
      `)
    }

    expect(psql(`
      select status || '|' ||
        (result_metadata ? 'materialization_resume_claim')::text || '|' ||
        (select count(*)::text from public.agent_action_audit_log
          where action_id = '${ids.resumeQuoteAction}'
            and reason = 'canonical_quote_booking.materialization_resume')
      from public.agent_actions where id = '${ids.resumeQuoteAction}';
    `)).toBe('approved|false|0')

    expect(psql(claimSql)).toBe('false|true|executing')
    expect(psql(claimSql)).toBe('true|false|executing')
    expect(psql(`
      select (result_metadata #>> '{materialization_resume_claim,event_id}') || '|' ||
        (select count(*)::text from public.agent_action_audit_log
          where action_id = '${ids.resumeQuoteAction}'
            and reason = 'canonical_quote_booking.materialization_resume')
      from public.agent_actions where id = '${ids.resumeQuoteAction}';
    `)).toBe(`${eventId}|1`)

    // Force terminal lifecycle fixtures through the same trigger context used
    // by the canonical transition helper. The resume claim must reject both
    // without changing the already-started action or duplicating its audit.
    for (const [fromStatus, toStatus] of [
      ['executing', 'completed'],
      ['completed', 'archived'],
    ] as const) {
      expect(psql(`
        begin;
        select set_config('app.plan_transition_plan_id', '${ids.resumeQuotePlan}', true);
        select set_config('app.plan_transition_from_status', '${fromStatus}', true);
        select set_config('app.plan_transition_to_status', '${toStatus}', true);
        select set_config('app.plan_transition_trigger', 'prompt8_terminal_fixture', true);
        update public.plans
        set status = '${toStatus}'::public.planner_plan_status
        where id = '${ids.resumeQuotePlan}' and status::text = '${fromStatus}'
        returning status::text;
        commit;
      `).split('\n').at(-1)).toBe(toStatus)
      expect(() => psql(claimSql)).toThrow(/claim_canonical_quote_booking_resume_event_required/)
      expect(psql(`
        select status || '|' ||
          (select count(*)::text from public.agent_action_audit_log
            where action_id = '${ids.resumeQuoteAction}'
              and reason = 'canonical_quote_booking.materialization_resume')
        from public.agent_actions where id = '${ids.resumeQuoteAction}';
      `)).toBe('executing|1')
    }
  })

  it('requires price evidence unless the venue quote explicitly states a zero-upfront model', () => {
    const zeroPayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'venue',
      responseId: ids.quoteResponse,
      targetId: ids.discoveryVenue,
      bookingSlot: 'venue',
      eventDateOffsetDays: 34,
      amountCents: 0,
    })
    const zeroSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'venue',
      targetId: ids.discoveryVenue,
      provider: 'Prompt 8 Discovery Venue',
      eventDateOffsetDays: 34,
      amountCents: 0,
      payloadSql: zeroPayloadSql,
    })
    const stageZeroSql = asService(`
      select result #>> '{approval,requested_amount_cents}'
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'venue', '${ids.quoteResponse}',
          '${ids.explicitFreeQuoteAction}', '${ids.explicitFreeQuoteApproval}',
          clock_timestamp() + interval '7 days', ${zeroPayloadSql},
          ${zeroSnapshotSql}, '${hashes.explicitFreeQuote}'
        ) as result
      ) as command;
    `)

    expect(psql(`
      update public.venue_outreach_responses
      set quoted_price_cents = null, quoted_deal_model = null
      where id = '${ids.quoteResponse}'
      returning (quoted_price_cents is null)::text;
    `)).toBe('true')
    expect(() => psql(stageZeroSql)).toThrow(/stage_plan_quote_booking_price_required/)
    expect(psql(`
      select count(*) from public.agent_actions
      where id = '${ids.explicitFreeQuoteAction}';
    `)).toBe('0')

    expect(psql(`
      update public.venue_outreach_responses
      set quoted_deal_model = 'CHI'
      where id = '${ids.quoteResponse}'
      returning quoted_deal_model;
    `)).toBe('CHI')
    expect(psql(stageZeroSql)).toBe('0')
    expect(psql(asService(`
      select result #>> '{agent_action,status}'
      from (
        select public.cancel_staged_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'venue', '${ids.quoteResponse}'
        ) as result
      ) as command;
    `))).toBe('cancelled')

    expect(psql(`
      update public.venue_outreach_responses
      set quoted_price_cents = 125000, quoted_deal_model = 'flat_fee'
      where id = '${ids.quoteResponse}'
      returning quoted_price_cents::text || '|' || quoted_deal_model;
    `)).toBe('125000|flat_fee')
  })

  it('turns a trusted quote into one approved canonical booking and confirms visible plan state', async () => {
    const actionPayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'venue',
      responseId: ids.quoteResponse,
      targetId: ids.discoveryVenue,
      bookingSlot: 'venue',
      eventDateOffsetDays: 34,
      amountCents: 125000,
    })
    const approvalSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'venue',
      targetId: ids.discoveryVenue,
      provider: 'Prompt 8 Discovery Venue',
      eventDateOffsetDays: 34,
      amountCents: 125000,
      payloadSql: actionPayloadSql,
    })
    const staged = psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'venue', '${ids.quoteResponse}',
          '${ids.quoteAction}', '${ids.quoteApproval}', clock_timestamp() + interval '4 seconds',
          ${actionPayloadSql}, ${approvalSnapshotSql}, '${hashes.quote}'
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

    // The organizer INSERT policy intentionally still admits provenance-null
    // legacy-shaped rows. The definer validator must nevertheless see this
    // plan-linked event through RLS and reject it outside the ready bridge.
    expect(() => psql(asAuthenticatedUser(ids.user, `
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        '${ids.authenticatedOrganizerBooking}', '${ids.venue}', '${eventId}',
        '${ids.user}', current_date + 34, 'pending'
      );
    `))).toThrow(/canonical_booking_mutation_requires_service_command/)
    expect(psql(`
      select count(*)::text from public.venue_bookings
      where id = '${ids.authenticatedOrganizerBooking}';
    `)).toBe('0')
    expect(psql(`select status::text from public.plans where id = '${ids.quotePlan}';`)).toBe('executing')

    expect(() => psql(asService(`
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        '${ids.unprovenancedQuoteBooking}', '${ids.venue}', '${eventId}',
        '${ids.user}', current_date + 34, 'confirmed'
      );
    `))).toThrow(/canonical_booking_(requires_exact_executable_provenance|provenance_identity_is_immutable)/)
    expect(psql(`select status::text from public.plans where id = '${ids.quotePlan}';`)).toBe('executing')

    expect(() => psql(asService(`
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status,
        plan_id, agent_action_id, approval_id, quoted_price_cents,
        approved_terms_snapshot
      ) values (
        '${ids.wrongPartnerVenueBooking}', '${ids.wrongVenue}', '${eventId}',
        '${ids.user}', current_date + 34, 'pending', '${ids.quotePlan}',
        '${ids.quoteAction}', '${ids.quoteApproval}', 125000,
        ${approvalSnapshotSql}
      );
    `))).toThrow(/canonical_booking_(requires_exact_executable_provenance|provenance_identity_is_immutable|partner_binding_counterparty_mismatch)/)
    expect(psql(`select count(*) from public.venue_bookings where id = '${ids.wrongPartnerVenueBooking}';`)).toBe('0')

    expect(psql(`
      update public.venues
      set bulk_approval_enabled = true, auto_approve_threshold = 2000
      where id = '${ids.venue}'
      returning bulk_approval_enabled::text;
    `)).toBe('true')

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
    expect(psql(`
      select binding.booking_kind || '|' || binding.discovery_partner_id::text || '|' ||
        binding.physical_partner_id::text || '|' || binding.approval_snapshot_hash
      from public.canonical_booking_partner_bindings as binding
      where binding.agent_action_id = '${ids.quoteAction}';
    `)).toBe(`venue|${ids.discoveryVenue}|${ids.venue}|${hashes.quote}`)
    expect(() => psql(asService(`
      update public.canonical_booking_partner_bindings
      set physical_partner_id = '${ids.wrongVenue}'
      where agent_action_id = '${ids.quoteAction}';
    `))).toThrow(/canonical_booking_partner_binding_is_immutable|permission denied for table canonical_booking_partner_bindings/)

    const beforeAuthenticatedVenueOwnerWrite = psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*) from public.agent_action_audit_log where action_id = action_row.id)::text || '|' ||
        (select count(*) from public.plan_messages where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed')::text
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)
    expect(psql(asAuthenticatedUser(ids.operator, `
      with updated as (
        update public.venue_bookings
        set status = 'confirmed'
        where id = '${bookingId}'
        returning id
      )
      select count(*)::text from updated;
    `))).toBe('0')
    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*) from public.agent_action_audit_log where action_id = action_row.id)::text || '|' ||
        (select count(*) from public.plan_messages where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed')::text
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)).toBe(beforeAuthenticatedVenueOwnerWrite)

    expect(() => psql(asService(`
      update public.venue_bookings
      set venue_id = '${ids.wrongVenue}'
      where id = '${bookingId}';
    `))).toThrow(/canonical_booking_(requires_exact_executable_provenance|provenance_identity_is_immutable)/)
    expect(psql(`select (venue_id = '${ids.venue}')::text from public.venue_bookings where id = '${bookingId}';`)).toBe('true')

    for (const mutation of [
      `target_id = '${ids.wrongDiscoveryVenue}'`,
      `payload_json = jsonb_set(payload_json, '{target_id}', to_jsonb('${ids.wrongDiscoveryVenue}'::text), false)`,
      'amount_cents = amount_cents + 1',
      "provider = 'Drifted provider'",
      "currency = 'eur'",
    ]) {
      expect(() => psql(asService(`
        update public.agent_actions set ${mutation} where id = '${ids.quoteAction}';
      `))).toThrow(/canonical_agent_action_material_fields_are_immutable/)
    }

    expect(() => psql(asService(`
      update public.agent_actions
      set approval_id = null
      where id = '${ids.quoteAction}';
    `))).toThrow(/canonical_agent_action_material_fields_are_immutable/)
    expect(psql(`
      select (approval_id = '${ids.quoteApproval}')::text
      from public.agent_actions where id = '${ids.quoteAction}';
    `)).toBe('true')

    for (const mutation of [
      "booking_date = booking_date + 1",
      "start_time = start_time + interval '1 hour'",
      'guest_count_max = guest_count_max + 1',
      'final_price = 1',
      'subtotal = subtotal + 1',
      "special_requests = 'Changed after approval'",
    ]) {
      expect(() => psql(asService(`
        update public.venue_bookings set ${mutation} where id = '${bookingId}';
      `))).toThrow(/canonical_(booking_requires_exact_executable_provenance|booking_material_terms_do_not_match_approval|venue_booking_terms_require_reapproval)/)
    }

    expect(() => psql(asService(`
      update public.agent_actions
      set target_id = '${ids.wrongDiscoveryVenue}',
          payload_json = jsonb_set(
            payload_json, '{target_id}', to_jsonb('${ids.wrongDiscoveryVenue}'::text), false
          )
      where id = '${ids.quoteAction}';

      update public.venue_bookings
      set venue_id = '${ids.wrongVenue}'
      where id = '${bookingId}';
    `))).toThrow(/canonical_agent_action_material_fields_are_immutable/)
    expect(psql(`
      select (action_row.target_id = '${ids.discoveryVenue}')::text || '|' ||
        (booking.venue_id = '${ids.venue}')::text
      from public.agent_actions as action_row
      join public.venue_bookings as booking on booking.agent_action_id = action_row.id
      where action_row.id = '${ids.quoteAction}';
    `)).toBe('true|true')

    // Expiry prevents a fresh execution start, but it must not strand work that
    // already started while the authorization was valid.
    expect(psql(asService(`
      update public.agent_actions
      set status = 'executing'
      where id = '${ids.quoteAction}'
      returning status::text;
    `))).toBe('executing')
    psql(`
      select pg_sleep(
        greatest(
          0::double precision,
          extract(epoch from (
            (select expires_at from public.approvals where id = '${ids.quoteApproval}')
            - clock_timestamp()
          )) + 0.25
        )
      );
    `)
    expect(psql(`
      select (expires_at <= clock_timestamp())::text
      from public.approvals
      where id = '${ids.quoteApproval}';
    `)).toBe('true')

    const venueWrongActorStateSql = `
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*)::text from public.plan_messages
         where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed') || '|' ||
        (select count(*)::text from public.agent_action_audit_log
         where action_id = action_row.id and reason = 'canonical_booking.confirmed')
      from public.venue_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `
    const venueBeforeWrongConfirmation = psql(venueWrongActorStateSql)
    expect(venueBeforeWrongConfirmation).toMatch(/^pending\|(approved|executing)\|executing\|0\|0$/)
    expect(() => psql(asService(`
      select public.confirm_canonical_booking(
        'venue', '${bookingId}', '${ids.vendorUser}', '{"source":"wrong_partner"}'
      );
    `))).toThrow(/confirm_canonical_booking_partner_mismatch/)
    expect(psql(venueWrongActorStateSql)).toBe(venueBeforeWrongConfirmation)

    const batchConfirmSql = asService(`
      select (result #>> '{results,0,existing}') || '|' ||
        (result #>> '{results,0,booking_status}') || '|' ||
        (result #>> '{results,0,action_status}') || '|' ||
        (result #>> '{results,0,plan_status}')
      from (
        select public.confirm_canonical_venue_bookings_batch(
          array['${bookingId}'::uuid], '${ids.operator}',
          '{"source":"venue_bulk_approval_route","route_confirmed":true}'::jsonb
        ) as result
      ) as command;
    `)
    expect(psql(batchConfirmSql)).toBe('false|confirmed|complete|booked')

    // Simulate a worker dying after confirmation committed but before route
    // effects. Concurrent exact replays converge on one deterministic receipt.
    expect(psql(`
      select
        (select count(*) from public.notifications
          where canonical_venue_confirmation_booking_id = '${bookingId}')::text || '|' ||
        (select count(*) from public.venue_booking_approval_audit
          where canonical_confirmation_booking_id = '${bookingId}')::text;
    `)).toBe('0|0')
    const ensureEffectsSql = asService(`
      select result #>> '{results,0,effect_status}'
      from (
        select public.ensure_canonical_venue_confirmation_effects(
          array['${bookingId}'::uuid], '${ids.operator}', 'Confirmed from bulk review.'
        ) as result
      ) as command;
    `)
    const effectReplays = await Promise.all([
      psqlAsync(ensureEffectsSql),
      psqlAsync(ensureEffectsSql),
    ])
    expect(effectReplays.sort()).toEqual(['created', 'existing'])
    expect(psql(`
      select
        (select count(*) from public.notifications
          where canonical_venue_confirmation_booking_id = '${bookingId}')::text || '|' ||
        (select count(*) from public.venue_booking_approval_audit
          where canonical_confirmation_booking_id = '${bookingId}')::text;
    `)).toBe('1|1')

    const confirmSql = asService(`
      select (result ->> 'existing') || '|' || (result ->> 'booking_status') || '|' ||
        (result ->> 'action_status') || '|' || (result ->> 'plan_status')
      from (
        select public.confirm_canonical_booking(
          'venue', '${bookingId}', '${ids.operator}', '{"source":"prompt8_realized"}'
        ) as result
      ) as command;
    `)
    expect(psql(confirmSql)).toBe('true|confirmed|complete|booked')
    expect(() => psql(asService(`
      select public.confirm_canonical_booking(
        'venue', '${bookingId}', '${ids.vendorUser}', '{"source":"wrong_replay_actor"}'
      );
    `))).toThrow(/confirm_canonical_booking_partner_mismatch/)
    expect(psql(`select count(*) from public.plan_messages where plan_id = '${ids.quotePlan}' and metadata ->> 'kind' = 'canonical_booking_confirmed';`)).toBe('1')

    expect(() => psql(asService(`
      update public.venue_bookings
      set booking_date = booking_date + 1, final_price = 1
      where id = '${bookingId}';
    `))).toThrow(/canonical_booking_material_terms_do_not_match_approval/)
    expect(() => psql(asService(`
      update public.agent_actions
      set amount_cents = amount_cents + 1
      where id = '${ids.quoteAction}';
    `))).toThrow(/canonical_agent_action_material_fields_are_immutable/)
    expect(psql(asService(`
      update public.venue_bookings
      set payment_status = 'processing', stripe_payment_intent_id = 'pi_prompt8_terms',
          platform_fee_percentage = 0, platform_fee_amount = 0, total_amount = 1250
      where id = '${bookingId}'
      returning payment_status || '|' || stripe_payment_intent_id;
    `))).toBe('processing|pi_prompt8_terms')

    psql(`
      insert into public.events (
        id, builder_id, event_name, event_type, event_date,
        start_time, end_time, duration_hours, status
      ) values (
        '${ids.legacyDowngradeEvent}', '${ids.builder}', 'Legacy downgrade target',
        'networking', current_date + 90, '18:00', '20:00', 2, 'draft'
      );
    `)
    expect(() => psql(asService(`
      update public.venue_bookings
      set event_id = '${ids.legacyDowngradeEvent}',
          plan_id = null,
          agent_action_id = null,
          approval_id = null,
          quoted_price_cents = null,
          approved_terms_snapshot = null,
          booking_date = current_date + 90,
          quoted_price = 1,
          subtotal = 1
      where id = '${bookingId}';
    `))).toThrow(/canonical_booking_provenance_identity_is_immutable/)
    expect(psql(`
      select (event_id = '${eventId}')::text || '|' ||
        (plan_id = '${ids.quotePlan}')::text || '|' ||
        (approval_id = '${ids.quoteApproval}')::text
      from public.venue_bookings where id = '${bookingId}';
    `)).toBe('true|true|true')

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

  it('accepts and cancels a later partner quote after the first booking moves the plan to booked', () => {
    expect(psql(`select status::text from public.plans where id = '${ids.quotePlan}';`)).toBe('booked')
    expect(psql(asService(`
      update public.approvals set status = 'expired'
      where id = '${ids.quoteApproval}' and status = 'authorized'
      returning status;
    `))).toBe('expired')

    const duplicateVenuePayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'venue',
      responseId: ids.secondVenueQuoteResponse,
      targetId: ids.discoveryVenue,
      bookingSlot: 'venue',
      eventDateOffsetDays: 34,
      amountCents: 130000,
    })
    const duplicateVenueSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'venue',
      targetId: ids.discoveryVenue,
      provider: 'Prompt 8 Discovery Venue',
      eventDateOffsetDays: 34,
      amountCents: 130000,
      payloadSql: duplicateVenuePayloadSql,
    })
    expect(() => psql(asService(`
      select public.stage_plan_quote_booking(
        '${ids.quotePlan}', '${ids.user}', 'venue', '${ids.secondVenueQuoteResponse}',
        '${ids.duplicateVenueSlotAction}', '${ids.duplicateVenueSlotApproval}',
        clock_timestamp() + interval '7 days', ${duplicateVenuePayloadSql},
        ${duplicateVenueSnapshotSql}, '${hashes.duplicateVenueSlot}'
      );
    `))).toThrow(/stage_plan_quote_booking_active_slot_exists/)
    expect(psql(`
      select count(*) from public.agent_actions where id = '${ids.duplicateVenueSlotAction}';
    `)).toBe('0')

    const actionPayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'vendor',
      responseId: ids.lateVendorQuoteResponse,
      targetId: ids.discoveryVendor,
      bookingSlot: 'vendor:catering',
      eventDateOffsetDays: 34,
      amountCents: 45000,
    })
    const approvalSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'vendor',
      targetId: ids.discoveryVendor,
      provider: 'Prompt 8 Discovery Vendor',
      eventDateOffsetDays: 34,
      amountCents: 45000,
      payloadSql: actionPayloadSql,
    })

    expect(psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'vendor', '${ids.lateVendorQuoteResponse}',
          '${ids.lateVendorCancelAction}', '${ids.lateVendorCancelApproval}',
          clock_timestamp() + interval '7 days', ${actionPayloadSql},
          ${approvalSnapshotSql}, '${hashes.lateVendorCancel}'
        ) as result
      ) as command;
    `))).toBe('false|pending')

    const cancelSql = asService(`
      select (result ->> 'existing') || '|' || (result #>> '{agent_action,status}') || '|' ||
        (result #>> '{approval,status}') || '|' || (result #>> '{plan,status}')
      from (
        select public.cancel_staged_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'vendor', '${ids.lateVendorQuoteResponse}'
        ) as result
      ) as command;
    `)
    expect(psql(cancelSql)).toBe('false|cancelled|cancelled|booked')
    expect(psql(cancelSql)).toBe('true|cancelled|cancelled|booked')

    expect(psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}') || '|' ||
        (result #>> '{plan,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'vendor', '${ids.lateVendorQuoteResponse}',
          '${ids.lateVendorAction}', '${ids.lateVendorApproval}',
          clock_timestamp() + interval '7 days', ${actionPayloadSql},
          ${approvalSnapshotSql}, '${hashes.lateVendor}'
        ) as result
      ) as command;
    `))).toBe('false|pending|booked')

    authorize(ids.quotePlan, ids.lateVendorApproval, 45000)
    const bookingId = psql(asService(`
      select result ->> 'booking_id'
      from (
        select public.create_canonical_booking_from_approval(
          '${ids.quotePlan}', '${ids.lateVendorAction}', '${ids.lateVendorApproval}', '${ids.user}'
        ) as result
      ) as command;
    `))
    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status
      from public.vendor_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)).toMatch(/^pending\|(approved|executing)\|booked$/)

    expect(psql(asService(`
      update public.agent_actions
      set status = 'failed', result_metadata = '{"error":"post-booking metadata failure"}'::jsonb
      where id = '${ids.lateVendorAction}'
      returning status;
    `))).toBe('failed')
    expect(psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{agent_action,id}') || '|' ||
        (result #>> '{agent_action,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.quotePlan}', '${ids.user}', 'vendor', '${ids.lateVendorQuoteResponse}',
          '${ids.lateVendorReplayAction}', '${ids.lateVendorReplayApproval}',
          clock_timestamp() + interval '7 days', ${actionPayloadSql},
          ${approvalSnapshotSql}, '${hashes.lateVendor}'
        ) as result
      ) as command;
    `))).toBe(`true|${ids.lateVendorAction}|failed`)
    expect(psql(`
      select count(*) from public.agent_actions
      where plan_id = '${ids.quotePlan}'
        and payload_json ->> 'quote_response_id' = '${ids.lateVendorQuoteResponse}';
    `)).toBe('2')
  })

  it('rejects vendor booking inserts and partner changes that do not match the approved discovery target', () => {
    const actionPayloadSql = canonicalQuotePayloadSql({
      quoteKind: 'vendor',
      responseId: ids.vendorQuoteResponse,
      targetId: ids.discoveryVendor,
      bookingSlot: 'vendor:catering',
      eventDateOffsetDays: 35,
      amountCents: 45000,
    })
    const approvalSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'vendor',
      targetId: ids.discoveryVendor,
      provider: 'Prompt 8 Discovery Vendor',
      eventDateOffsetDays: 35,
      amountCents: 45000,
      payloadSql: actionPayloadSql,
    })
    expect(psql(asService(`
      select (result ->> 'existing') || '|' || (result #>> '{approval,status}')
      from (
        select public.stage_plan_quote_booking(
          '${ids.vendorQuotePlan}', '${ids.user}', 'vendor', '${ids.vendorQuoteResponse}',
          '${ids.vendorQuoteAction}', '${ids.vendorQuoteApproval}', clock_timestamp() + interval '7 days',
          ${actionPayloadSql}, ${approvalSnapshotSql}, '${hashes.vendorQuote}'
        ) as result
      ) as command;
    `))).toBe('false|pending')

    const revisedActionPayloadSql = `(${actionPayloadSql} || jsonb_build_object('approval_revision', 2))`
    const revisedApprovalSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'vendor',
      targetId: ids.discoveryVendor,
      provider: 'Prompt 8 Discovery Vendor',
      eventDateOffsetDays: 35,
      amountCents: 45000,
      payloadSql: revisedActionPayloadSql,
    })
    const invalidTermsPayloadSql = `(${actionPayloadSql} || jsonb_build_object(
      'approval_revision', 2,
      'quote_terms', jsonb_build_object('quoted_deposit_pct', 99),
      'requested_terms', jsonb_build_object('quoted_deposit_pct', 99)
    ))`
    const invalidTermsSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'vendor',
      targetId: ids.discoveryVendor,
      provider: 'Prompt 8 Discovery Vendor',
      eventDateOffsetDays: 35,
      amountCents: 45000,
      payloadSql: invalidTermsPayloadSql,
    })
    expect(() => psql(asService(`
      update public.approvals
      set status = 'superseded', superseded_at = transaction_timestamp()
      where id = '${ids.vendorQuoteApproval}';

      insert into public.approvals (
        id, plan_id, agent_action_id, action_label, provider, event_date,
        price_cents, fees_cents, package_details, status, requested_amount_cents,
        expires_at, snapshot_hash, snapshot_json, snapshot_schema_version,
        root_approval_id, version_number, supersedes_approval_id
      )
      select
        '${ids.invalidTermSuccessorApproval}', plan_id, agent_action_id, action_label,
        provider, event_date, price_cents, fees_cents, package_details, 'pending',
        requested_amount_cents, clock_timestamp() + interval '7 days',
        '${hashes.vendorQuoteInvalidTerms}', ${invalidTermsSnapshotSql}, 2,
        root_approval_id, version_number + 1, id
      from public.approvals
      where id = '${ids.vendorQuoteApproval}';

      update public.agent_actions
      set approval_id = '${ids.invalidTermSuccessorApproval}',
          payload_json = ${invalidTermsPayloadSql}
      where id = '${ids.vendorQuoteAction}';
    `))).toThrow(/canonical_agent_action_material_fields_are_immutable/)
    expect(psql(`
      select approval_row.status || '|' ||
        (action_row.approval_id = approval_row.id)::text || '|' ||
        (action_row.payload_json ? 'quote_terms')::text || '|' ||
        (select count(*)::text from public.approvals where id = '${ids.invalidTermSuccessorApproval}')
      from public.approvals as approval_row
      join public.agent_actions as action_row on action_row.id = approval_row.agent_action_id
      where approval_row.id = '${ids.vendorQuoteApproval}';
    `)).toBe('pending|true|false|0')

    const invalidAmountPayloadSql = `(${actionPayloadSql} || jsonb_build_object(
      'requested_amount_cents', 45001, 'price_cents', 45001, 'approval_revision', 2
    ))`
    const invalidAmountSnapshotSql = canonicalQuoteSnapshotSql({
      quoteKind: 'vendor',
      targetId: ids.discoveryVendor,
      provider: 'Prompt 8 Discovery Vendor',
      eventDateOffsetDays: 35,
      amountCents: 45001,
      payloadSql: invalidAmountPayloadSql,
    })
    expect(() => psql(asService(`
      select id from public.supersede_approval_version(
        '${ids.vendorQuotePlan}', '${ids.vendorQuoteApproval}', '${hashes.vendorQuote}',
        '${ids.user}', 45001, current_date + 35, null, clock_timestamp() + interval '7 days',
        ${invalidAmountPayloadSql}, ${invalidAmountSnapshotSql},
        '${hashes.vendorQuoteInvalidRevision}', 'Attempted canonical quote amount rewrite'
      );
    `))).toThrow(/canonical_(agent_action_material_fields_are_immutable|quote_booking_amount_change_requires_fresh_quote)/)
    expect(psql(`
      select status || '|' || (approval_id = '${ids.vendorQuoteApproval}')::text || '|' || amount_cents::text
      from public.agent_actions where id = '${ids.vendorQuoteAction}';
    `)).toBe('pending|true|45000')

    const successorApprovalId = psql(asService(`
      select id from public.supersede_approval_version(
        '${ids.vendorQuotePlan}', '${ids.vendorQuoteApproval}', '${hashes.vendorQuote}',
        '${ids.user}', 45000, current_date + 35, null, clock_timestamp() + interval '7 days',
        ${revisedActionPayloadSql}, ${revisedApprovalSnapshotSql},
        '${hashes.vendorQuoteRevision}', 'Host reviewed revised vendor terms'
      );
    `))
    expect(successorApprovalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(psql(`
      select (approval_id = '${successorApprovalId}')::text || '|' ||
        (payload_json ->> 'approval_revision')
      from public.agent_actions where id = '${ids.vendorQuoteAction}';
    `)).toBe('true|2')
    authorize(ids.vendorQuotePlan, successorApprovalId, 45000)

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.vendorQuotePlan}', '${ids.user}', 'founder_operator_dinner',
        current_date + 35, '18:30'::time, 150, 'America/Los_Angeles'
      );
    `))

    expect(() => psql(asService(`
      insert into public.vendor_bookings (
        id, vendor_id, event_id, organizer_id, booking_date, status,
        plan_id, agent_action_id, approval_id, quoted_price_cents,
        approved_terms_snapshot
      ) values (
        '${ids.wrongPartnerVendorBooking}', '${ids.wrongVendor}', '${eventId}',
        '${ids.user}', current_date + 35, 'pending', '${ids.vendorQuotePlan}',
        '${ids.vendorQuoteAction}', '${successorApprovalId}', 45000,
        ${revisedApprovalSnapshotSql}
      );
    `))).toThrow(/canonical_booking_(requires_exact_executable_provenance|partner_binding_counterparty_mismatch)/)
    expect(psql(`select count(*) from public.vendor_bookings where id = '${ids.wrongPartnerVendorBooking}';`)).toBe('0')

    expect(() => psql(asService(`
      insert into public.vendor_bookings (
        id, vendor_id, event_id, organizer_id, booking_date, start_time, end_time,
        requested_date, requested_start_time, requested_end_time, guest_count,
        status, quoted_price, subtotal, plan_id, agent_action_id, approval_id,
        quoted_price_cents, approved_terms_snapshot
      ) values (
        '${ids.wrongPartnerVendorBooking}', '${ids.vendor}', '${eventId}', '${ids.user}',
        current_date + 36, '18:30', '21:00', current_date + 35, '18:30', '21:00', 24,
        'pending', 450, 450, '${ids.vendorQuotePlan}', '${ids.vendorQuoteAction}',
        '${successorApprovalId}', 45000, ${revisedApprovalSnapshotSql}
      );
    `))).toThrow(/canonical_booking_material_terms_do_not_match_approval/)

    const [bookingId, bookingStatus] = psql(asService(`
      select (result ->> 'booking_id') || '|' || (result ->> 'booking_status')
      from (
        select public.create_canonical_booking_from_approval(
          '${ids.vendorQuotePlan}', '${ids.vendorQuoteAction}',
          '${successorApprovalId}', '${ids.user}'
        ) as result
      ) as command;
    `)).split('|')
    expect(bookingStatus).toBe('pending')
    expect(psql(`
      select binding.booking_kind || '|' || binding.discovery_partner_id::text || '|' ||
        binding.physical_partner_id::text || '|' || binding.approval_snapshot_hash
      from public.canonical_booking_partner_bindings as binding
      where binding.agent_action_id = '${ids.vendorQuoteAction}';
    `)).toBe(`vendor|${ids.discoveryVendor}|${ids.vendor}|${hashes.vendorQuoteRevision}`)

    const beforeAuthenticatedVendorWrite = psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*) from public.agent_action_audit_log where action_id = action_row.id)::text || '|' ||
        (select count(*) from public.plan_messages where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed')::text
      from public.vendor_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)
    expect(psql(asAuthenticatedUser(ids.vendorUser, `
      with updated as (
        update public.vendor_bookings
        set status = 'confirmed',
            confirmed_date = booking_date,
            confirmed_start_time = start_time,
            confirmed_end_time = end_time
        where id = '${bookingId}'
        returning id
      )
      select count(*)::text from updated;
    `))).toBe('0')
    expect(psql(`
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*) from public.agent_action_audit_log where action_id = action_row.id)::text || '|' ||
        (select count(*) from public.plan_messages where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed')::text
      from public.vendor_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `)).toBe(beforeAuthenticatedVendorWrite)

    expect(() => psql(asService(`
      update public.vendor_bookings
      set vendor_id = '${ids.wrongVendor}'
      where id = '${bookingId}';
    `))).toThrow(/canonical_booking_(requires_exact_executable_provenance|provenance_identity_is_immutable)/)
    expect(psql(`select (vendor_id = '${ids.vendor}')::text from public.vendor_bookings where id = '${bookingId}';`)).toBe('true')

    for (const [mutation, expectedError] of [
      ["requested_date = requested_date + 1", /canonical_vendor_booking_terms_require_reapproval/],
      ["requested_start_time = requested_start_time + interval '1 hour'", /canonical_vendor_booking_terms_require_reapproval/],
      ['guest_count = guest_count + 1', /canonical_vendor_booking_terms_require_reapproval/],
      ['final_price = 1', /canonical_booking_material_terms_do_not_match_approval/],
      ['subtotal = subtotal + 1', /canonical_booking_material_terms_do_not_match_approval/],
      ['deposit_amount = 10', /canonical_vendor_booking_terms_require_reapproval/],
      ["requirements = '{\"changed\":true}'::jsonb", /canonical_vendor_booking_terms_require_reapproval/],
      [`vendor_package_id = '${ids.vendorPackage}'`, /canonical_vendor_booking_terms_require_reapproval/],
      ['confirmed_date = booking_date', /canonical_vendor_booking_confirmation_terms_require_confirmed_status/],
    ] as const) {
      expect(() => psql(asService(`
        update public.vendor_bookings set ${mutation} where id = '${bookingId}';
      `))).toThrow(expectedError)
    }

    const vendorWrongActorStateSql = `
      select booking.status || '|' || action_row.status || '|' || plan_row.status || '|' ||
        (select count(*)::text from public.plan_messages
         where plan_id = plan_row.id and metadata ->> 'kind' = 'canonical_booking_confirmed') || '|' ||
        (select count(*)::text from public.agent_action_audit_log
         where action_id = action_row.id and reason = 'canonical_booking.confirmed')
      from public.vendor_bookings as booking
      join public.agent_actions as action_row on action_row.id = booking.agent_action_id
      join public.plans as plan_row on plan_row.id = booking.plan_id
      where booking.id = '${bookingId}';
    `
    const vendorBeforeWrongConfirmation = psql(vendorWrongActorStateSql)
    expect(vendorBeforeWrongConfirmation).toMatch(/^pending\|(approved|executing)\|executing\|0\|0$/)
    expect(() => psql(asService(`
      select public.confirm_canonical_booking(
        'vendor', '${bookingId}', '${ids.operator}', '{"source":"wrong_partner"}'
      );
    `))).toThrow(/confirm_canonical_booking_partner_mismatch/)
    expect(psql(vendorWrongActorStateSql)).toBe(vendorBeforeWrongConfirmation)

    expect(psql(asService(`
      select (result ->> 'booking_status') || '|' || (result ->> 'action_status') || '|' ||
        (result ->> 'plan_status')
      from (
        select public.confirm_canonical_booking(
          'vendor', '${bookingId}', '${ids.vendorUser}', '{"source":"prompt8_vendor_partner_binding"}'
        ) as result
      ) as command;
    `))).toBe('confirmed|complete|booked')

    expect(psql(asService(`
      insert into public.vendor_invoices (
        booking_id, booking_generation_key, vendor_id, event_id, builder_id, invoice_number
      ) values (
        '${bookingId}', '${bookingId}', '${ids.vendor}', '${eventId}', '${ids.builder}',
        'P8-AUTO-INVOICE-1'
      ) returning booking_generation_key;
    `))).toBe(bookingId)
    expect(() => psql(asService(`
      insert into public.vendor_invoices (
        booking_id, booking_generation_key, vendor_id, event_id, builder_id, invoice_number
      ) values (
        '${bookingId}', '${bookingId}', '${ids.vendor}', '${eventId}', '${ids.builder}',
        'P8-AUTO-INVOICE-2'
      );
    `))).toThrow(/vendor_invoices_booking_generation_unique|duplicate key/)
    expect(psql(asService(`
      insert into public.vendor_invoices (
        booking_id, booking_generation_key, vendor_id, event_id, builder_id, invoice_number
      ) values (
        '${bookingId}', null, '${ids.vendor}', '${eventId}', '${ids.builder}',
        'P8-MANUAL-INVOICE-2'
      ) returning (booking_generation_key is null)::text;
    `))).toBe('true')

    expect(() => psql(asService(`
      update public.vendor_bookings set notes = 'Changed after confirmation' where id = '${bookingId}';
    `))).toThrow(/canonical_vendor_booking_terms_require_reapproval/)
    expect(() => psql(asService(`
      update public.vendor_bookings set status = 'cancelled' where id = '${bookingId}';
    `))).toThrow(/canonical_vendor_booking_confirmation_terms_require_confirmed_status/)
    expect(psql(asService(`
      update public.vendor_bookings
      set payment_status = 'processing', stripe_payment_intent_id = 'pi_prompt8_vendor_terms',
          platform_fee_percentage = 0, platform_fee_amount = 0, total_amount = 450,
          deposit_paid = true
      where id = '${bookingId}'
      returning payment_status || '|' || stripe_payment_intent_id || '|' || deposit_paid::text;
    `))).toBe('processing|pi_prompt8_vendor_terms|true')
  })
})
