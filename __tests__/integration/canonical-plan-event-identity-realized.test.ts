import { execFile, execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.CANONICAL_EVENT_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_CANONICAL_EVENT_DB_TESTS === '1'

const ids = {
  user: 'd7100000-0000-4000-8000-000000000001',
  otherUser: 'd7100000-0000-4000-8000-000000000002',
  builder: 'd7200000-0000-4000-8000-000000000001',
  venue: 'd7300000-0000-4000-8000-000000000001',
  plan: 'd7400000-0000-4000-8000-000000000001',
  action: 'd7500000-0000-4000-8000-000000000001',
  approval: 'd7600000-0000-4000-8000-000000000001',
  message: 'd7700000-0000-4000-8000-000000000001',
  template: 'd7800000-0000-4000-8000-000000000001',
  rebookPlan: 'd7400000-0000-4000-8000-000000000009',
  templateRun: 'd7d00000-0000-4000-8000-000000000001',
  booking: 'd7900000-0000-4000-8000-000000000001',
  futureBooking: 'd7900000-0000-4000-8000-000000000002',
  legacyEvent: 'd7a00000-0000-4000-8000-000000000001',
  nonLaPlan: 'd7400000-0000-4000-8000-000000000002',
  springPlan: 'd7400000-0000-4000-8000-000000000003',
  fallPlan: 'd7400000-0000-4000-8000-000000000004',
  incompletePlan: 'd7400000-0000-4000-8000-000000000005',
  concurrentPlan: 'd7400000-0000-4000-8000-000000000006',
  transitionPlan: 'd7400000-0000-4000-8000-000000000007',
  deletionPlan: 'd7400000-0000-4000-8000-000000000008',
  deletionTemplate: 'd7800000-0000-4000-8000-000000000008',
  terminalPlan: 'd7400000-0000-4000-8000-000000000010',
  mismatchedBookingPlan: 'd7400000-0000-4000-8000-000000000011',
  mismatchedBookingEvent: 'd7a00000-0000-4000-8000-000000000011',
  mismatchedBooking: 'd7900000-0000-4000-8000-000000000011',
  invalidTemplate: 'd7800000-0000-4000-8000-000000000011',
}

const approvalHash = 'a'.repeat(64)
let canonicalEventId = ''

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

function asService(sql: string): string {
  return `
    begin;
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    ${sql}
    commit;
  `
}

function asAuthenticated(sql: string): string {
  return asAuthenticatedUser(ids.user, sql)
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
    delete from public.venue_bookings where organizer_id in ('${ids.user}', '${ids.otherUser}');
    delete from public.vendor_bookings where organizer_id in ('${ids.user}', '${ids.otherUser}');
    delete from public.templates where user_id in ('${ids.user}', '${ids.otherUser}');
    delete from public.plans where user_id = '${ids.user}';
    delete from public.events where builder_id = '${ids.builder}';
    delete from public.venues where id = '${ids.venue}';
    delete from public.builder_profiles where id = '${ids.builder}';
    delete from public.users where id in ('${ids.user}', '${ids.otherUser}');
    delete from auth.users where id in ('${ids.user}', '${ids.otherUser}');
    commit;
  `)
}

function setup(): void {
  cleanup()
  psql(`
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      (
        '${ids.user}', 'authenticated', 'authenticated',
        'canonical-event-realized@example.com', now(), now()
      ),
      (
        '${ids.otherUser}', 'authenticated', 'authenticated',
        'canonical-event-other@example.com', now(), now()
      );

    insert into public.users (id, email, role, user_type)
    values
      (
        '${ids.user}', 'canonical-event-realized@example.com',
        'builder', 'community_builder'
      ),
      (
        '${ids.otherUser}', 'canonical-event-other@example.com',
        'builder', 'community_builder'
      );

    insert into public.builder_profiles (id, user_id, name)
    values ('${ids.builder}', '${ids.user}', 'Canonical Event Host');

    insert into public.venues (id, venue_name, is_admin_seeded, claim_status)
    values (
      '${ids.venue}', 'Canonical Event Test Venue', true, 'invited_unclaimed'
    );

    insert into public.plans (
      id, user_id, title, event_type, status, guest_count,
      budget_cap_cents, date_window_start, date_window_end, notes,
      committed_vendors, metadata
    ) values (
      '${ids.plan}',
      '${ids.user}',
      'Founder dinner outcome test',
      'Founder/operator dinner',
      'ready',
      24,
      9550,
      current_date - 2,
      current_date - 2,
      'A quiet hosted dinner with a measured outcome.',
      '[{"vendor_id":"d7b00000-0000-4000-8000-000000000001","service_type":"catering","quoted_package_cents":9550}]'::jsonb,
      $quote$
      {
        "event_archetype_lock": {"key": "founder_operator_dinner"},
        "committed_venue": {"discovery_venue_id": "d7c00000-0000-4000-8000-000000000001", "quoted_price_cents": 9550},
        "committed_vendors": [{"vendor_id": "d7b00000-0000-4000-8000-000000000001", "service_type": "catering"}],
        "accepted_quote_state": {
          "venue": {"discovery_venue_id": "d7c00000-0000-4000-8000-000000000001"},
          "vendors": [{"vendor_id": "d7b00000-0000-4000-8000-000000000001", "service_type": "catering"}]
        }
      }$quote$::jsonb
    );

    insert into public.plan_messages (id, plan_id, role, content, message_type)
    values (
      '${ids.message}', '${ids.plan}', 'user',
      'Plan a founder dinner for 24 people.', 'text'
    );

    insert into public.agent_actions (
      id, plan_id, action_type, description, amount_cents, status, payload_json
    ) values (
      '${ids.action}', '${ids.plan}', 'hold_request',
      'Approve exact founder dinner plan', 9550, 'pending',
      '{"kind":"venue_hold","event_type":"founder_operator_dinner"}'::jsonb
    );

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, provider, event_date,
      status, requested_amount_cents, expires_at, snapshot_hash
    ) values (
      '${ids.approval}', '${ids.plan}', '${ids.action}',
      'Approve founder dinner', 'Canonical Venue', current_date - 2,
      'pending', 9550, now() + interval '7 days', '${approvalHash}'
    );

    update public.agent_actions
    set approval_id = '${ids.approval}'
    where id = '${ids.action}';

    insert into public.events (
      id, builder_id, event_name, event_type, event_date,
      start_time, end_time, duration_hours, status
    ) values (
      '${ids.legacyEvent}', '${ids.builder}', 'Legacy imported event',
      'networking', current_date + 1, '18:00', '20:00', 2, 'draft'
    );
  `)
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('realized canonical plan and event identity', () => {
  beforeAll(setup)
  afterAll(cleanup)

  it('walks chat -> authorization -> exact event -> analytics -> template -> booking -> outcome', () => {
    expect(psql(asService(`
      update public.approvals
      set status = 'authorized',
          authorized_amount_cents = 9550,
          authorized_by = '${ids.user}',
          authorized_at = now(),
          approved_by = '${ids.user}',
          approved_at = now()
      where id = '${ids.approval}'
      returning status;
    `))).toBe('authorized')
    expect(psql(`select status::text from public.plans where id = '${ids.plan}';`)).toBe('approved')

    const materialized = psql(asService(`
      select event_id, existing, event_record ->> 'event_type', plan_status
      from public.materialize_plan_event(
        '${ids.plan}', '${ids.user}', 'founder_operator_dinner',
        current_date - 2, '18:30'::time, 150, null
      );
    `)).split('|')

    canonicalEventId = materialized[0]
    expect(canonicalEventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(materialized.slice(1)).toEqual(['f', 'founder_operator_dinner', 'executing'])

    expect(psql(`
      select
        event_type || '|' || time_zone || '|' ||
        to_char(starts_at at time zone time_zone, 'HH24:MI') || '|' ||
        to_char(ends_at at time zone time_zone, 'HH24:MI') || '|' ||
        expected_attendance::text || '|' || budget::text || '|' ||
        (plan_id = '${ids.plan}')::text
      from public.events where id = '${canonicalEventId}';
    `)).toBe('founder_operator_dinner|America/Los_Angeles|18:30|21:00|24|95.50|true')

    expect(psql(`
      select
        metadata #>> '{committed_venue,canonical_event_id}',
        metadata #>> '{accepted_quote_state,venue,canonical_event_id}',
        metadata #>> '{committed_vendors,0,canonical_event_id}',
        metadata #>> '{accepted_quote_state,vendors,0,canonical_event_id}',
        committed_vendors -> 0 ->> 'canonical_event_id'
      from public.plans where id = '${ids.plan}';
    `)).toBe(Array(5).fill(canonicalEventId).join('|'))

    expect(psql(asService(`
      select event_id, existing, plan_status
      from public.materialize_plan_event(
        '${ids.plan}', '${ids.user}', 'founder_operator_dinner',
        current_date - 2, '18:30'::time, 150, 'America/Los_Angeles'
      );
    `))).toBe(`${canonicalEventId}|t|executing`)

    expect(() => psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.plan}', '${ids.user}', 'founder_operator_dinner',
        current_date - 2, '19:00'::time, 150, 'America/Los_Angeles'
      );
    `))).toThrow()
    expect(psql(`select count(*) from public.events where plan_id = '${ids.plan}';`)).toBe('1')

    expect(psql(`
      select event_row.id
      from public.events as event_row
      join public.builder_profiles as builder on builder.id = event_row.builder_id
      where builder.user_id = '${ids.user}'
        and event_row.plan_id = '${ids.plan}';
    `)).toBe(canonicalEventId)

    expect(psql(asService(`
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        '${ids.booking}', '${ids.venue}', '${canonicalEventId}',
        '${ids.user}', current_date - 2, 'confirmed'
      ) returning status;
    `))).toBe('confirmed')
    expect(psql(`select status::text from public.plans where id = '${ids.plan}';`)).toBe('booked')

    expect(() => psql(asService(`
      select id from public.record_plan_event_outcome(
        '${canonicalEventId}', '${ids.user}',
        '{"notes":true}'::jsonb
      );
    `))).toThrow(/record_plan_event_outcome_requires_measured_result_or_notes|record_plan_event_outcome_notes_must_be_string/)

    expect(() => psql(asService(`
      select id from public.record_plan_event_outcome(
        '${canonicalEventId}', '${ids.user}',
        '{"gross_revenue_cents":-1}'::jsonb
      );
    `))).toThrow()

    expect(psql(asService(`
      select id, status
      from public.record_plan_event_outcome(
        '${canonicalEventId}', '${ids.user}',
        '{
          "actual_attendance": 22,
          "gross_revenue_cents": 120000,
          "total_cost_cents": 9550,
          "notes": "Hosted dinner completed with measured attendance."
        }'::jsonb
      );
    `))).toBe(`${canonicalEventId}|completed`)

    expect(psql(`
      select plans.status::text || '|' ||
        (events.outcome_recorded_at is not null)::text || '|' ||
        (events.outcome_summary ->> 'actual_attendance')
      from public.plans
      join public.events on events.id = plans.materialized_event_id
      where plans.id = '${ids.plan}';
    `)).toBe('completed|true|22')

    psql(`
      insert into public.templates (
        id, user_id, source_plan_id, source_event_id, name,
        event_type, historical_performance
      )
      select
        '${ids.template}', '${ids.user}', '${ids.plan}', '${canonicalEventId}',
        'Founder dinner rebook', 'founder_operator_dinner',
        jsonb_build_object(
          'source_event_id', event_row.id,
          'outcome_recorded_at', event_row.outcome_recorded_at,
          'outcome_summary', event_row.outcome_summary
        )
      from public.events as event_row
      where event_row.id = '${canonicalEventId}';

      insert into public.plans (
        id, user_id, title, event_type, status,
        date_window_start, date_window_end, metadata
      ) values (
        '${ids.rebookPlan}', '${ids.user}', 'Founder dinner rebook run',
        'Founder/operator dinner', 'ready', current_date + 30, current_date + 30,
        jsonb_build_object(
          'event_archetype_lock', jsonb_build_object('key', 'founder_operator_dinner'),
          'template_rebook_preferences', jsonb_build_object(
            'source_event_id', '${canonicalEventId}'::uuid,
            'template_id', '${ids.template}'::uuid
          )
        )
      );

      insert into public.template_runs (id, template_id, plan_id, new_date)
      values ('${ids.templateRun}', '${ids.template}', '${ids.rebookPlan}', current_date + 30);
    `)

    expect(psql(`
      select string_agg(transition_trigger, ',' order by transitioned_at)
      from public.plan_status_transitions where plan_id = '${ids.plan}';
    `)).toBe('approval_authorized,event_materialized,booking_created,outcome_recorded')

    expect(psql(`
      select
        message.content || '|' ||
        template.source_event_id::text || '|' ||
        (template.historical_performance #>> '{outcome_summary,actual_attendance}') || '|' ||
        (rebook.materialized_event_id is null)::text || '|' ||
        (rebook.metadata #>> '{template_rebook_preferences,source_event_id}')
      from public.plan_messages as message
      cross join public.templates as template
      cross join public.plans as rebook
      where message.id = '${ids.message}'
        and template.id = '${ids.template}'
        and rebook.id = '${ids.rebookPlan}';
    `)).toBe(`Plan a founder dinner for 24 people.|${canonicalEventId}|22|true|${canonicalEventId}`)
  })

  it('rejects noncanonical, incomplete, and cross-owner template provenance', () => {
    expect(() => psql(asAuthenticated(`
      insert into public.templates (
        id, user_id, source_plan_id, source_event_id, name
      ) values (
        '${ids.invalidTemplate}', '${ids.user}', '${ids.rebookPlan}',
        '${ids.legacyEvent}', 'Invalid noncanonical source'
      );
    `))).toThrow(/template_source_event_must_be_owned_completed_canonical_event/)

    expect(() => psql(asAuthenticatedUser(ids.otherUser, `
      insert into public.templates (
        id, user_id, source_plan_id, source_event_id, name
      ) values (
        '${ids.invalidTemplate}', '${ids.otherUser}', '${ids.plan}',
        '${canonicalEventId}', 'Invalid cross-owner source'
      );
    `))).toThrow(/template_source_event_must_be_owned_completed_canonical_event/)

    expect(psql(`select count(*) from public.templates where id = '${ids.invalidTemplate}';`))
      .toBe('0')
  })

  it('realizes all 19 lossless taxonomy values while keeping imported legacy rows non-canonical', () => {
    expect(psql(`
      select count(*)::text || '|' || bool_and(archetype_key = event_type)::text
      from public.planner_event_taxonomy;
    `)).toBe('19|true')

    expect(psql(`
      begin;
      with inserted as (
        insert into public.events (
          builder_id, event_name, event_type, event_date,
          start_time, end_time, duration_hours, status
        )
        select
          '${ids.builder}',
          'Taxonomy constraint ' || taxonomy.archetype_key,
          taxonomy.event_type,
          current_date + 10,
          '10:00'::time,
          '12:00'::time,
          2,
          'draft'
        from public.planner_event_taxonomy as taxonomy
        returning event_type
      )
      select count(*) from inserted;
      rollback;
    `)).toBe('19')

    expect(psql(`
      select event_type || '|' || (plan_id is null)::text
      from public.events where id = '${ids.legacyEvent}';
    `)).toBe('networking|true')
  })

  it('stores a non-Los-Angeles overnight schedule as exact next-day instants', () => {
    psql(`
      insert into public.plans (
        id, user_id, title, event_type, status,
        date_window_start, date_window_end, metadata
      ) values (
        '${ids.nonLaPlan}', '${ids.user}', 'New York overnight screening',
        'Watch party / screening', 'approved', current_date + 30, current_date + 30,
        '{"event_archetype_lock":{"key":"watch_party_screening"}}'::jsonb
      );
    `)

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.nonLaPlan}', '${ids.user}', 'watch_party_screening',
        current_date + 30, '23:30'::time, 180, 'America/New_York'
      );
    `))

    expect(psql(`
      select
        time_zone || '|' ||
        ((ends_at at time zone time_zone)::date = event_date + 1)::text || '|' ||
        to_char(ends_at at time zone time_zone, 'HH24:MI') || '|' ||
        extract(epoch from (ends_at - starts_at))::integer::text || '|' ||
        event_type
      from public.events where id = '${eventId}';
    `)).toBe('America/New_York|true|02:30|10800|watch_party_screening')
  })

  it('does not complete a booked plan before its exact event end', () => {
    const eventId = psql(`
      select materialized_event_id from public.plans where id = '${ids.nonLaPlan}';
    `)

    expect(psql(asService(`
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        '${ids.futureBooking}', '${ids.venue}', '${eventId}', '${ids.user}',
        current_date + 30, 'confirmed'
      ) returning status;
    `))).toBe('confirmed')

    expect(() => psql(asService(`
      select id from public.record_plan_event_outcome(
        '${eventId}', '${ids.user}',
        '{"actual_attendance":12,"notes":"Too early to record."}'::jsonb
      );
    `))).toThrow(/record_plan_event_outcome_event_has_not_ended/)

    expect(psql(`
      select plans.status::text || '|' || (events.outcome_recorded_at is null)::text
      from public.plans
      join public.events on events.id = plans.materialized_event_id
      where plans.id = '${ids.nonLaPlan}';
    `)).toBe('booked|true')
  })

  it('rejects nonexistent, ambiguous, and incomplete-window schedule inputs', () => {
    psql(`
      insert into public.plans (
        id, user_id, title, event_type, status,
        date_window_start, date_window_end, metadata
      ) values
        (
          '${ids.springPlan}', '${ids.user}', 'Spring DST gap',
          'Networking mixer', 'approved', '2027-03-14', '2027-03-14',
          '{"event_archetype_lock":{"key":"networking_mixer"}}'::jsonb
        ),
        (
          '${ids.fallPlan}', '${ids.user}', 'Fall DST fold',
          'Networking mixer', 'approved', '2027-11-07', '2027-11-07',
          '{"event_archetype_lock":{"key":"networking_mixer"}}'::jsonb
        ),
        (
          '${ids.incompletePlan}', '${ids.user}', 'Incomplete date window',
          'Networking mixer', 'approved', current_date + 20, null,
          '{"event_archetype_lock":{"key":"networking_mixer"}}'::jsonb
        );
    `)

    expect(() => psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.springPlan}', '${ids.user}', 'networking_mixer',
        '2027-03-14', '02:30'::time, 120, 'America/Los_Angeles'
      );
    `))).toThrow(/materialize_plan_event_nonexistent_local_time/)

    expect(() => psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.fallPlan}', '${ids.user}', 'networking_mixer',
        '2027-11-07', '01:30'::time, 120, 'America/Los_Angeles'
      );
    `))).toThrow(/materialize_plan_event_ambiguous_local_time/)

    expect(() => psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.incompletePlan}', '${ids.user}', 'networking_mixer',
        current_date + 20, '18:00'::time, 120, 'America/Los_Angeles'
      );
    `))).toThrow(/materialize_plan_event_date_outside_plan_window/)

    expect(psql(`
      select count(*) from public.events
      where plan_id in ('${ids.springPlan}', '${ids.fallPlan}', '${ids.incompletePlan}');
    `)).toBe('0')
  })

  it('serializes concurrent materialization calls onto one event', async () => {
    psql(`
      insert into public.plans (
        id, user_id, title, event_type, status, guest_count,
        date_window_start, date_window_end, metadata
      ) values (
        '${ids.concurrentPlan}', '${ids.user}', 'Concurrent community meetup',
        'Community meetup', 'approved', 50,
        current_date + 40, current_date + 40,
        '{"event_archetype_lock":{"key":"community_meetup"}}'::jsonb
      );
    `)

    const call = asService(`
      select event_id, existing, plan_status
      from public.materialize_plan_event(
        '${ids.concurrentPlan}', '${ids.user}', 'community_meetup',
        current_date + 40, '17:00'::time, 180, 'America/Los_Angeles'
      );
    `)
    const results = await Promise.all([psqlAsync(call), psqlAsync(call)])
    const parsed = results.map((result) => result.split('|'))

    expect(new Set(parsed.map(([eventId]) => eventId)).size).toBe(1)
    expect(parsed.map(([, existing]) => existing).sort()).toEqual(['f', 't'])
    expect(parsed.map(([, , status]) => status)).toEqual(['executing', 'executing'])
    expect(psql(`select count(*) from public.events where plan_id = '${ids.concurrentPlan}';`)).toBe('1')
    expect(psql(`
      select count(*) from public.plan_status_transitions
      where plan_id = '${ids.concurrentPlan}' and transition_trigger = 'event_materialized';
    `)).toBe('1')
  })

  it('requires exact compare-and-swap context for status retries', () => {
    psql(`
      insert into public.plans (id, user_id, title, status)
      values ('${ids.transitionPlan}', '${ids.user}', 'CAS transition plan', 'drafting');
    `)

    const transition = (context: string) => asService(`
      select (public.transition_plan_status(
        '${ids.transitionPlan}', 'drafting', 'ready', 'intake_completed',
        '${ids.user}', '${context}'::jsonb
      )).status::text;
    `)

    expect(psql(transition('{"source":"realized-cas"}'))).toBe('ready')
    expect(psql(transition('{"source":"realized-cas"}'))).toBe('ready')
    expect(() => psql(transition('{"source":"different-request"}')))
      .toThrow(/plan_status_transition_retry_does_not_match_last_transition/)
    expect(psql(`
      select count(*) from public.plan_status_transitions
      where plan_id = '${ids.transitionPlan}';
    `)).toBe('1')
  })

  it('rejects booking evidence owned by someone other than the plan owner', () => {
    psql(`
      begin;
      set constraints all deferred;

      insert into public.events (
        id, builder_id, event_name, event_type, event_date,
        start_time, end_time, duration_hours, status, plan_id,
        starts_at, ends_at, time_zone
      ) values (
        '${ids.mismatchedBookingEvent}', '${ids.builder}',
        'Mismatched booking evidence', 'networking_mixer', current_date + 45,
        '18:00', '20:00', 2, 'draft', '${ids.mismatchedBookingPlan}',
        ((current_date + 45)::timestamp + time '18:00') at time zone 'America/Los_Angeles',
        ((current_date + 45)::timestamp + time '20:00') at time zone 'America/Los_Angeles',
        'America/Los_Angeles'
      );

      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        '${ids.mismatchedBooking}', '${ids.venue}', '${ids.mismatchedBookingEvent}',
        '${ids.otherUser}', current_date + 45, 'confirmed'
      );

      insert into public.plans (
        id, user_id, title, event_type, status,
        date_window_start, date_window_end, materialized_event_id, metadata
      ) values (
        '${ids.mismatchedBookingPlan}', '${ids.user}',
        'Mismatched booking evidence', 'Networking mixer', 'executing',
        current_date + 45, current_date + 45, '${ids.mismatchedBookingEvent}',
        '{"event_archetype_lock":{"key":"networking_mixer"}}'::jsonb
      );

      commit;
    `)

    expect(() => psql(asService(`
      select (public.transition_plan_status(
        '${ids.mismatchedBookingPlan}', 'executing', 'booked',
        'booking_created', '${ids.user}', '{"source":"owner-negative"}'::jsonb
      )).status::text;
    `))).toThrow(/plan_confirmed_booking_evidence_missing/)

    expect(psql(`
      select status::text from public.plans where id = '${ids.mismatchedBookingPlan}';
    `)).toBe('executing')
  })

  it('enforces browser ACLs and freezes canonical plan facts even for direct service writes', () => {
    for (const signature of [
      'public.materialize_plan_event(uuid,uuid,text,date,time without time zone,integer,text)',
      'public.transition_plan_status(uuid,text,text,text,uuid,jsonb)',
      'public.record_plan_event_outcome(uuid,uuid,jsonb)',
      'public.annotate_plan_quote_event_lineage(uuid,uuid)',
    ]) {
      expect(psql(`
        select
          has_function_privilege('anon', '${signature}', 'EXECUTE')::text || '|' ||
          has_function_privilege('authenticated', '${signature}', 'EXECUTE')::text || '|' ||
          has_function_privilege('service_role', '${signature}', 'EXECUTE')::text;
      `)).toBe('false|false|true')
    }

    expect(psql(`
      select
        has_table_privilege('authenticated', 'public.planner_event_taxonomy', 'SELECT')::text || '|' ||
        has_table_privilege('authenticated', 'public.planner_event_taxonomy', 'INSERT')::text || '|' ||
        has_table_privilege('authenticated', 'public.plan_status_transitions', 'SELECT')::text || '|' ||
        has_table_privilege('authenticated', 'public.plan_status_transitions', 'INSERT')::text;
    `)).toBe('true|false|true|false')

    expect(psql(asAuthenticated(`
      select count(*) from public.plan_status_transitions where plan_id = '${ids.plan}';
    `))).toBe('4')

    expect(() => psql(asAuthenticated(`
      update public.plans set status = 'archived' where id = '${ids.plan}';
    `))).toThrow(/plan_status_must_use_transition_plan_status/)

    expect(() => psql(asAuthenticated(`
      update public.plans
      set materialized_event_id = '${ids.legacyEvent}'
      where id = '${ids.plan}';
    `))).toThrow(/canonical_plan_event_pointer_is_immutable/)

    expect(() => psql(asService(`
      update public.plans
      set materialized_event_id = '${ids.legacyEvent}'
      where id = '${ids.transitionPlan}';
    `))).toThrow(/canonical_plan_identity_is_not_reciprocal/)

    expect(() => psql(asAuthenticated(`
      update public.events
      set starts_at = starts_at + interval '1 minute'
      where id = '${canonicalEventId}';
    `))).toThrow(/canonical_event_fields_require_service_role/)

    expect(() => psql(asAuthenticated(`
      update public.events
      set event_name = 'Browser identity drift'
      where id = '${canonicalEventId}';
    `))).toThrow(/canonical_event_fields_require_service_role/)

    expect(() => psql(asService(`
      update public.events
      set expected_attendance = expected_attendance + 1
      where id = '${canonicalEventId}';
    `))).toThrow(/canonical_event_fields_require_dedicated_command/)

    const unbookedCanonicalEvent = psql(`
      select materialized_event_id from public.plans where id = '${ids.concurrentPlan}';
    `)
    expect(() => psql(asAuthenticated(`
      delete from public.events where id = '${unbookedCanonicalEvent}';
    `))).toThrow(/foreign key constraint|still referenced/i)

    expect(() => psql(asService(`
      update public.plans
      set notes = 'Direct service drift must fail'
      where id = '${ids.plan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asService(`
      update public.events
      set outcome_summary = '{"completed":true}'::jsonb
      where id = '${canonicalEventId}';
    `))).toThrow(/canonical_event_fields_require_dedicated_command/)

    expect(() => psql(asService(`
      update public.plans
      set committed_venue_quoted_price_cents = 1
      where id = '${ids.plan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asAuthenticated(`
      update public.plans
      set metadata = jsonb_set(
        metadata,
        '{accepted_quote_state,venue,quoted_price_cents}',
        '1'::jsonb,
        true
      )
      where id = '${ids.plan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asService(`
      update public.plans
      set guest_count = 99
      where id = '${ids.springPlan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asAuthenticated(`
      update public.plans
      set title = 'Browser drift after approval'
      where id = '${ids.springPlan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asAuthenticated(`
      update public.plans
      set metadata = jsonb_set(
        metadata,
        '{event_archetype_lock,key}',
        '"workshop_class"'::jsonb
      )
      where id = '${ids.springPlan}';
    `))).toThrow(/canonical_plan_inputs_require_dedicated_revision_command/)

    expect(() => psql(asService(`
      insert into public.plans (
        id, user_id, title, status, date_window_start, date_window_end
      ) values (
        '${ids.terminalPlan}', '${ids.user}', 'Illegal terminal insert',
        'completed', current_date + 1, current_date + 1
      );
    `))).toThrow(/plan_creation_cannot_skip_lifecycle_transitions/)

    expect(psql(`select count(*) from public.plans where id = '${ids.terminalPlan}';`)).toBe('0')
  })

  it('fails closed on one-sided deletion but permits intentional pair deletion in one deferred transaction', () => {
    psql(`
      insert into public.plans (
        id, user_id, title, event_type, status,
        date_window_start, date_window_end, metadata
      ) values (
        '${ids.deletionPlan}', '${ids.user}', 'Privacy deletion pair',
        'Holiday reception', 'approved', current_date - 1, current_date - 1,
        '{"event_archetype_lock":{"key":"holiday_reception"}}'::jsonb
      );
    `)

    const eventId = psql(asService(`
      select event_id from public.materialize_plan_event(
        '${ids.deletionPlan}', '${ids.user}', 'holiday_reception',
        current_date - 1, '18:00'::time, 180, 'America/Los_Angeles'
      );
    `))

    psql(asService(`
      insert into public.venue_bookings (
        id, venue_id, event_id, organizer_id, booking_date, status
      ) values (
        'd7900000-0000-4000-8000-000000000008', '${ids.venue}', '${eventId}',
        '${ids.user}', current_date - 1, 'confirmed'
      );

      select id from public.record_plan_event_outcome(
        '${eventId}', '${ids.user}',
        '{"notes":"Completed before coordinated privacy deletion."}'::jsonb
      );
    `))

    psql(`
      insert into public.templates (
        id, user_id, source_plan_id, source_event_id, name
      ) values (
        '${ids.deletionTemplate}', '${ids.user}', '${ids.deletionPlan}',
        '${eventId}', 'Deletion provenance test'
      );
    `)

    expect(() => psql(`delete from public.events where id = '${eventId}';`))
      .toThrow(/foreign key constraint|still referenced/i)

    psql(`
      begin;
      set constraints all deferred;
      delete from public.venue_bookings where event_id = '${eventId}';
      delete from public.plans where id = '${ids.deletionPlan}';
      delete from public.events where id = '${eventId}';
      commit;
    `)

    expect(psql(`
      select
        (source_plan_id is null)::text || '|' ||
        (source_event_id is null)::text
      from public.templates where id = '${ids.deletionTemplate}';
    `)).toBe('true|true')
  })
})
