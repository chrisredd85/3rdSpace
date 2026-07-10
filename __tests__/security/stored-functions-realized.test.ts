import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const databaseUrl = process.env.DB_FUNCTION_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL
const forceRun = process.env.RUN_DB_FUNCTION_TESTS === '1'
const storedFunctionRepairMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260709110000_repair_p0_stored_functions.sql'),
  'utf8',
)
const blockInflightStripeAccountPayments = storedFunctionRepairMigration.match(
  /CREATE OR REPLACE FUNCTION public\.block_inflight_stripe_account_payments[\s\S]*?\n\$\$;/,
)?.[0]

const ids = {
  organizer: '91000000-0000-4000-8000-000000000001',
  attacker: '91000000-0000-4000-8000-000000000002',
  venueOwner: '91000000-0000-4000-8000-000000000003',
  builder: '92000000-0000-4000-8000-000000000001',
  plan: '93000000-0000-4000-8000-000000000001',
  event: '94000000-0000-4000-8000-000000000001',
  venue: '95000000-0000-4000-8000-000000000001',
  settlementRun: '96000000-0000-4000-8000-000000000001',
  settlementCharge: '97000000-0000-4000-8000-000000000001',
  kickbackAgreement: '98000000-0000-4000-8000-000000000001',
  kickbackPayment: '99000000-0000-4000-8000-000000000001',
  agentAction: '9a000000-0000-4000-8000-000000000001',
  approval: '9b000000-0000-4000-8000-000000000001',
  recommendation: '9c000000-0000-4000-8000-000000000001',
}

function psql(sql: string): string {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return execFileSync('psql', [
        databaseUrl,
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-Atc',
        sql,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
    } catch (error) {
      lastError = error
      if (!isTransientPostgresError(error)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }

  throw lastError
}

function isTransientPostgresError(error: unknown): boolean {
  const stderr = error && typeof error === 'object'
    ? (error as { stderr?: Buffer | string }).stderr
    : undefined
  const message = Buffer.isBuffer(stderr)
    ? stderr.toString('utf8')
    : typeof stderr === 'string'
      ? stderr
      : error instanceof Error
        ? error.message
        : String(error)
  return /database system is (starting up|in recovery mode)|connection .* failed|the database system is shutting down/i.test(message)
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

function asRole(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  sql: string,
): string {
  const sub = userId ? `set local request.jwt.claim.sub = '${userId}';` : ''
  return `
    set local role ${role};
    set local request.jwt.claim.role = '${role}';
    ${sub}
    ${sql}
    reset role;
  `
}

function transaction(sql: string): string {
  return psql(`
    begin;
    ${baseFixtureSql()}
    ${sql}
    rollback;
  `)
}

function serviceOnlyUnauthorizedTest(
  functionSignature: string,
  body: () => void,
): void {
  const stillPublic = !forceRun || psql(
    `select has_function_privilege('anon', '${functionSignature}', 'EXECUTE');`,
  ) === 't'
  const register = stillPublic ? it.failing : it
  const prefix = stillPublic ? 'TODO(P0.1): ' : ''

  register(`${prefix}denies anonymous callers`, body)
}

function baseFixtureSql(): string {
  return `
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.organizer}', 'authenticated', 'authenticated', 'db-functions-organizer@example.com', now(), now()),
      ('${ids.attacker}', 'authenticated', 'authenticated', 'db-functions-attacker@example.com', now(), now()),
      ('${ids.venueOwner}', 'authenticated', 'authenticated', 'db-functions-venue@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values
      ('${ids.organizer}', 'db-functions-organizer@example.com', 'builder', 'community_builder'),
      ('${ids.attacker}', 'db-functions-attacker@example.com', 'builder', 'community_builder'),
      ('${ids.venueOwner}', 'db-functions-venue@example.com', 'owner', 'venue_owner');

    insert into public.builder_profiles (
      id, user_id, name, billing_tier, subscription_status,
      free_events_granted, free_events_used, paid_event_credits
    ) values (
      '${ids.builder}', '${ids.organizer}', 'DB Function Organizer',
      'free_trial', 'trial', 2, 0, 0
    );

    insert into public.plans (
      id, user_id, title, date_window_start, date_window_end, guest_count
    ) values (
      '${ids.plan}', '${ids.organizer}', 'DB Function Plan',
      '2026-08-01', '2026-08-02', 30
    );

    insert into public.venues (
      id, owner_id, venue_name, venue_type, is_published, slug
    ) values (
      '${ids.venue}', '${ids.venueOwner}', 'DB Function Venue',
      'gallery', false, 'db-function-venue'
    );

    insert into public.events (
      id, builder_id, event_name, event_type, event_date,
      start_time, end_time, duration_hours
    ) values (
      '${ids.event}', '${ids.builder}', 'DB Function Event', 'networking',
      '2026-08-01', '18:00', '21:00', 3
    );

    insert into public.agent_actions (id, plan_id, action_type, description)
    values ('${ids.agentAction}', '${ids.plan}', 'hold_request', 'Test hold request');

    insert into public.approvals (id, plan_id, agent_action_id, action_label, status)
    values ('${ids.approval}', '${ids.plan}', '${ids.agentAction}', 'Approve hold request', 'pending');

    insert into public.recommendations (id, plan_id, type, rank, status)
    values ('${ids.recommendation}', '${ids.plan}', 'venue', 1, 'pending');

    insert into public.builder_stripe_accounts (
      user_id, builder_id, stripe_account_id, account_status
    ) values (
      '${ids.organizer}', '${ids.builder}', 'acct_db_functions_builder', 'active'
    );

    insert into public.event_kickback_agreements (
      id, event_id, venue_id, builder_id, venue_owner_id, kickback_model
    ) values (
      '${ids.kickbackAgreement}', '${ids.event}', '${ids.venue}',
      '${ids.organizer}', '${ids.venueOwner}', 'per_head_attendance'
    );

    insert into public.kickback_payments (
      id, agreement_id, event_id, payer_id, recipient_id, amount, status
    ) values (
      '${ids.kickbackPayment}', '${ids.kickbackAgreement}', '${ids.event}',
      '${ids.venueOwner}', '${ids.organizer}', 300, 'pending'
    );

    insert into public.settlement_runs (
      id, event_id, organizer_id, venue_id, archetype, venue_type,
      neighborhood, scheduled_settle_at, status
    ) values (
      '${ids.settlementRun}', '${ids.event}', '${ids.organizer}', '${ids.venue}',
      'community_social', 'gallery', 'Mission', now() + interval '1 day', 'pending'
    );

    insert into public.settlement_charges (
      id, settlement_run_id, organizer_id, venue_id, amount_cents,
      organizer_payout_cents, stripe_connected_account_id, status
    ) values (
      '${ids.settlementCharge}', '${ids.settlementRun}', '${ids.organizer}',
      '${ids.venue}', 30000, 30000, 'acct_db_functions_builder', 'checkout_created'
    );
  `
}

const emptyImpact = JSON.stringify({
  invalidated_recommendation_ids: [],
  superseded_approval_ids: [],
  superseded_outreach_thread_ids: [],
  triggers_rediscovery: [],
})

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describe('latest block_inflight_stripe_account_payments definition', () => {
  it('carries the final planner payment account-state contract forward', () => {
    expect(blockInflightStripeAccountPayments).toBeDefined()
    expect(blockInflightStripeAccountPayments).toContain('v_venue_ids uuid[]')
    expect(blockInflightStripeAccountPayments).toContain('FROM public.venues')
    expect(blockInflightStripeAccountPayments).toContain(
      'WHERE owner_id = ANY(v_venue_owner_ids)',
    )
    expect(blockInflightStripeAccountPayments).toContain(
      "partner_kind = 'venue' AND partner_id = ANY(v_venue_ids)",
    )
    expect(blockInflightStripeAccountPayments).not.toContain(
      "partner_kind = 'venue' AND partner_id = ANY(v_venue_owner_ids)",
    )
    expect(blockInflightStripeAccountPayments).toContain("WHERE status = 'capturing'")
    expect(blockInflightStripeAccountPayments).toContain(
      "WHERE status IN ('pending', 'requested', 'authorized')",
    )
    expect(blockInflightStripeAccountPayments).toContain(
      'account_state_blocked_previous_status = status',
    )
    expect(blockInflightStripeAccountPayments).toContain(
      'account_state_blocked_stripe_account_id = p_stripe_account_id',
    )
    expect(blockInflightStripeAccountPayments).toContain(
      "'capturing_payment_intents_preserved', v_capturing_payment_intents_preserved",
    )
  })
})

describeIfDatabase('realized P0 stored functions', () => {
  describe('apply_plan_revision_atomic', () => {
    it('applies date updates and supersedes the selected recommendation and approval', () => {
      const impact = JSON.stringify({
        invalidated_recommendation_ids: [ids.recommendation],
        superseded_approval_ids: [ids.approval],
        superseded_outreach_thread_ids: [],
        triggers_rediscovery: ['venue'],
      })
      const output = transaction(asRole('authenticated', ids.organizer, `
        select new_revision_count
        from public.apply_plan_revision_atomic(
          '${ids.plan}',
          '${ids.organizer}',
          '{"type":"date_change"}'::jsonb,
          null,
          '{"date_window_start":"2026-08-10","date_window_end":"2026-08-11"}'::jsonb,
          '${impact}'::jsonb,
          'Date changed'
        );
        reset role;
        select date_window_start || '|' || date_window_end || '|' || plan_revision_count
        from public.plans where id = '${ids.plan}';
        select status from public.recommendations where id = '${ids.recommendation}';
        select status from public.approvals where id = '${ids.approval}';
      `))

      expect(output.split('\n')).toEqual([
        '1',
        '2026-08-10|2026-08-11|1',
        'superseded',
        'superseded',
      ])
    })

    it('keeps an already superseded approval stale on a repeated revision', () => {
      const impact = JSON.stringify({
        invalidated_recommendation_ids: [],
        superseded_approval_ids: [ids.approval],
        superseded_outreach_thread_ids: [],
        triggers_rediscovery: [],
      })
      const output = transaction(asRole('authenticated', ids.organizer, `
        select revision_id
        from public.apply_plan_revision_atomic(
          '${ids.plan}', '${ids.organizer}', '{"type":"budget_change"}'::jsonb,
          null, '{"budget_cap_cents":500000}'::jsonb, '${impact}'::jsonb, 'Budget changed'
        );
        select new_revision_count
        from public.apply_plan_revision_atomic(
          '${ids.plan}', '${ids.organizer}', '{"type":"budget_change"}'::jsonb,
          null, '{"budget_cap_cents":500000}'::jsonb, '${impact}'::jsonb, 'Budget changed'
        );
        reset role;
        select status || '|' || (superseded_by_revision_id is not null)::text
        from public.approvals where id = '${ids.approval}';
        select plan_revision_count from public.plans where id = '${ids.plan}';
      `))

      const lines = output.split('\n')
      expect(lines[0]).toMatch(/^[0-9a-f-]{36}$/)
      expect(lines.slice(1)).toEqual(['2', 'superseded|true', '2'])
    })

    it('denies a caller that does not own the plan', () => {
      expect(() => transaction(asRole('authenticated', ids.attacker, `
        select * from public.apply_plan_revision_atomic(
          '${ids.plan}', '${ids.organizer}', '{"type":"budget_change"}'::jsonb,
          null, '{}'::jsonb, '${emptyImpact}'::jsonb, 'Unauthorized change'
        );
      `))).toThrow()
    })
  })

  describe('block_inflight_stripe_account_payments', () => {
    it('blocks matching kickback and settlement rows without nonexistent timestamp writes', () => {
      const output = transaction(asRole('service_role', null, `
        select
          (result->>'kickback_payments') || '|' ||
          (result->>'settlement_runs') || '|' ||
          (result->>'settlement_charges') || '|' ||
          (result->>'capturing_payment_intents_preserved')
        from (
          select public.block_inflight_stripe_account_payments(
            'acct_db_functions_builder', 'account.restricted', 'evt_block_1'
          ) result
        ) blocked;
        reset role;
        select status || '|' || account_state_block_reason
        from public.kickback_payments where id = '${ids.kickbackPayment}';
        select status || '|' || blocked_previous_status
        from public.settlement_runs where id = '${ids.settlementRun}';
        select status || '|' || blocked_previous_status
        from public.settlement_charges where id = '${ids.settlementCharge}';
      `))

      expect(output.split('\n')).toEqual([
        '1|1|1|0',
        'blocked_by_account_state|account.restricted',
        'blocked|pending',
        'blocked|checkout_created',
      ])
    })

    it('is stale-safe when the same account restriction is replayed', () => {
      const output = transaction(asRole('service_role', null, `
        select public.block_inflight_stripe_account_payments(
          'acct_db_functions_builder', 'account.restricted', 'evt_block_1'
        );
        select
          (result->>'kickback_payments') || '|' ||
          (result->>'settlement_runs') || '|' ||
          (result->>'settlement_charges')
        from (
          select public.block_inflight_stripe_account_payments(
            'acct_db_functions_builder', 'account.restricted', 'evt_block_1_replay'
          ) result
        ) replayed;
        reset role;
        select status from public.kickback_payments where id = '${ids.kickbackPayment}';
      `))

      const lines = output.split('\n')
      expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
        kickback_payments: 1,
        settlement_runs: 1,
        settlement_charges: 1,
      }))
      expect(lines.slice(1)).toEqual(['0|0|0', 'blocked_by_account_state'])
    })

    serviceOnlyUnauthorizedTest(
      'public.block_inflight_stripe_account_payments(text,text,text)',
      () => {
        expect(() => transaction(asRole('anon', null, `
          select public.block_inflight_stripe_account_payments(
            'acct_db_functions_builder', 'account.restricted', 'evt_unauthorized'
          );
        `))).toThrow()
      },
    )
  })

  describe('transition_settlement_charge_status', () => {
    it('transitions the charge and records the qualified failure reason', () => {
      const output = transaction(asRole('service_role', null, `
        select success::text || '|' || coalesce(failure_reason, '') || '|' || (charge->>'status')
        from public.transition_settlement_charge_status(
          '${ids.settlementCharge}', 'checkout_created', 'failed', 'stripe_failed',
          null, 'stripe_webhook', 'declined', '{}'::jsonb,
          '{"failure_reason":"card_declined","failed_at":"2026-08-01T19:00:00Z"}'::jsonb
        );
        reset role;
        select status || '|' || failure_reason
        from public.settlement_charges where id = '${ids.settlementCharge}';
        select count(*) from public.settlement_audit_log
        where entity_type = 'settlement_charge' and entity_id = '${ids.settlementCharge}';
      `))

      expect(output.split('\n')).toEqual([
        'true||failed',
        'failed|card_declined',
        '1',
      ])
    })

    it('returns concurrent_update without a second audit row for stale state', () => {
      const output = transaction(asRole('service_role', null, `
        select success
        from public.transition_settlement_charge_status(
          '${ids.settlementCharge}', 'checkout_created', 'failed', 'stripe_failed'
        );
        select success::text || '|' || failure_reason || '|' || (charge->>'status')
        from public.transition_settlement_charge_status(
          '${ids.settlementCharge}', 'checkout_created', 'paid', 'stripe_paid'
        );
        reset role;
        select count(*) from public.settlement_audit_log
        where entity_type = 'settlement_charge' and entity_id = '${ids.settlementCharge}';
      `))

      expect(output.split('\n')).toEqual(['t', 'false|concurrent_update|failed', '1'])
    })

    serviceOnlyUnauthorizedTest(
      'public.transition_settlement_charge_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)',
      () => {
        expect(() => transaction(asRole('anon', null, `
          select * from public.transition_settlement_charge_status(
            '${ids.settlementCharge}', 'checkout_created', 'failed', 'unauthorized'
          );
        `))).toThrow()
      },
    )
  })

  describe('consume_builder_event_access', () => {
    it('consumes one free event and records usage against the realized schema', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        select source || '|' || amount_cents
        from public.consume_builder_event_access('${ids.builder}', '${ids.plan}');
        reset role;
        select free_events_used from public.builder_profiles where id = '${ids.builder}';
        select events_booked || '|' || total_fees_paid
        from public.builder_event_usage where builder_id = '${ids.builder}';
      `))

      expect(output.split('\n')).toEqual(['free_trial|0', '1', '1|0.00'])
    })

    it('returns the existing ledger row without consuming access twice', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        select id from public.consume_builder_event_access('${ids.builder}', '${ids.plan}');
        select id from public.consume_builder_event_access('${ids.builder}', '${ids.plan}');
        reset role;
        select count(*) from public.builder_event_access_consumptions
        where builder_id = '${ids.builder}' and event_id = '${ids.plan}';
        select free_events_used from public.builder_profiles where id = '${ids.builder}';
        select events_booked from public.builder_event_usage where builder_id = '${ids.builder}';
      `))

      const lines = output.split('\n')
      expect(lines[0]).toBe(lines[1])
      expect(lines.slice(2)).toEqual(['1', '1', '1'])
    })

    it('denies another authenticated user and noncanonical price inputs', () => {
      expect(() => transaction(asRole('authenticated', ids.attacker, `
        select * from public.consume_builder_event_access('${ids.builder}', '${ids.plan}');
      `))).toThrow()
      expect(() => transaction(asRole('authenticated', ids.organizer, `
        select * from public.consume_builder_event_access(
          '${ids.builder}', '${ids.plan}', 200, 1, 1
        );
      `))).toThrow()
    })
  })

  describe('materialize_builder_event_with_access', () => {
    const payloadHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

    function call(idempotencyKey: string) {
      return `
        select
          plan_id || '|' || event_id || '|' || consumption_id || '|' ||
          access_source || '|' || amount_cents || '|' || existing || '|' ||
          (event_record->>'event_name')
        from public.materialize_builder_event_with_access(
          '${ids.organizer}',
          '${ids.builder}',
          '${idempotencyKey}',
          '${payloadHash}',
          'Atomic materialized event',
          'One transaction',
          'networking',
          '2026-09-01',
          '18:00',
          '21:00',
          3,
          40,
          250000,
          'draft'
        );
      `
    }

    it('atomically creates a minimal plan, legacy event, and plan-keyed consumption', () => {
      const output = transaction(asRole('service_role', null, `
        select current_user || '|' || auth.role();
        ${call('materialize-success-001')}
        reset role;
        select
          materialization.status || '|' ||
          (consumption.event_id = materialization.plan_id)::text || '|' ||
          (plan_row.metadata->>'event_id' = materialization.event_id::text)::text
        from public.builder_event_materializations AS materialization
        join public.builder_event_access_consumptions AS consumption
          ON consumption.id = materialization.consumption_id
        join public.plans AS plan_row
          ON plan_row.id = materialization.plan_id
        where materialization.idempotency_key = 'materialize-success-001';
        select free_events_used from public.builder_profiles where id = '${ids.builder}';
      `))

      const lines = output.split('\n')
      expect(lines[0]).toBe('service_role|service_role')
      expect(lines[1]).toMatch(
        /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|[0-9a-f-]{36}\|free_trial\|0\|false\|Atomic materialized event$/,
      )
      expect(lines.slice(2)).toEqual(['materialized|true|true', '1'])
    })

    it('keeps legacy service booking behavior for ready bridge events', () => {
      const output = transaction(`
        ${asRole('service_role', null, `
          ${call('materialize-booking-compat-001')}
          insert into public.venue_bookings (
            id, venue_id, event_id, organizer_id, booking_date, status
          )
          select
            '9d000000-0000-4000-8000-000000000001',
            '${ids.venue}',
            materialization.event_id,
            '${ids.organizer}',
            '2026-09-01',
            'confirmed'
          from public.builder_event_materializations as materialization
          where materialization.idempotency_key = 'materialize-booking-compat-001'
          returning status;
        `)}
        select plan_row.status::text
        from public.plans as plan_row
        join public.builder_event_materializations as materialization
          on materialization.plan_id = plan_row.id
        where materialization.idempotency_key = 'materialize-booking-compat-001';
      `)

      const lines = output.split('\n')
      expect(lines[0]).toMatch(
        /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|[0-9a-f-]{36}\|free_trial\|0\|false\|Atomic materialized event$/,
      )
      expect(lines.slice(1)).toEqual(['confirmed', 'ready'])
    })

    it('rejects an authenticated cross-tenant booking against a ready bridge event', () => {
      expect(() => transaction(`
        ${asRole('service_role', null, `
          ${call('materialize-cross-tenant-booking')}
          select set_config(
            'test.ready_bridge_event_id',
            (
              select materialization.event_id::text
              from public.builder_event_materializations as materialization
              where materialization.idempotency_key = 'materialize-cross-tenant-booking'
            ),
            true
          );
        `)}
        ${asRole('authenticated', ids.attacker, `
          insert into public.venue_bookings (
            id, venue_id, event_id, organizer_id, booking_date, status
          )
          select
            '9d000000-0000-4000-8000-000000000003',
            '${ids.venue}',
            current_setting('test.ready_bridge_event_id')::uuid,
            '${ids.attacker}',
            '2026-09-01',
            'pending'
          ;
        `)}
      `)).toThrow(/ready_legacy_booking_organizer_does_not_match_plan_owner/)
    })

    it('allows the venue owner to update only provenance-free legacy bookings', () => {
      const output = transaction(`
        insert into public.venue_bookings (
          id, venue_id, event_id, organizer_id, booking_date, status
        ) values (
          '9d000000-0000-4000-8000-000000000004', '${ids.venue}',
          '${ids.event}', '${ids.organizer}', '2026-08-01', 'pending'
        );

        ${asRole('authenticated', ids.attacker, `
          with updated as (
            update public.venue_bookings
            set status = 'declined'
            where id = '9d000000-0000-4000-8000-000000000004'
            returning id
          )
          select count(*) from updated;
        `)}

        ${asRole('authenticated', ids.venueOwner, `
          with updated as (
            update public.venue_bookings
            set status = 'confirmed'
            where id = '9d000000-0000-4000-8000-000000000004'
            returning id
          )
          select count(*) from updated;
        `)}

        select status from public.venue_bookings
        where id = '9d000000-0000-4000-8000-000000000004';
      `)

      expect(output.split('\n')).toEqual(['0', '1', 'confirmed'])
    })

    it('prevents a venue owner from rebinding a legacy booking into a ready bridge', () => {
      expect(() => transaction(`
        insert into public.venue_bookings (
          id, venue_id, event_id, organizer_id, booking_date, status
        ) values (
          '9d000000-0000-4000-8000-000000000005', '${ids.venue}',
          '${ids.event}', '${ids.organizer}', '2026-08-01', 'pending'
        );

        ${asRole('service_role', null, `
          ${call('materialize-rebind-defense')}
          select set_config(
            'test.ready_bridge_event_id',
            (
              select materialization.event_id::text
              from public.builder_event_materializations as materialization
              where materialization.idempotency_key = 'materialize-rebind-defense'
            ),
            true
          );
        `)}

        ${asRole('authenticated', ids.venueOwner, `
          update public.venue_bookings
          set event_id = current_setting('test.ready_bridge_event_id')::uuid,
              booking_date = '2026-09-01'
          where id = '9d000000-0000-4000-8000-000000000005';
        `)}
      `)).toThrow(/ready_legacy_booking_identity_is_immutable/)
    })

    it('rolls back the request, plan, event, and counters when billing fails', () => {
      const output = transaction(asRole('service_role', null, `
        update public.builder_profiles
        set free_events_used = free_events_granted, paid_event_credits = 0
        where id = '${ids.builder}';

        do $billing_failure$
        declare
          v_billing_failed boolean := false;
        begin
          begin
            perform public.materialize_builder_event_with_access(
              '${ids.organizer}',
              '${ids.builder}',
              'materialize-billing-failure',
              '${payloadHash}',
              'Billing failure event',
              null,
              'networking',
              '2026-09-02',
              '18:00',
              '21:00',
              3,
              40,
              250000,
              'draft'
            );
          exception
            when sqlstate 'P0001' then
              if sqlerrm = 'builder_billing_required' then
                v_billing_failed := true;
              else
                raise;
              end if;
          end;

          if not v_billing_failed then
            raise exception 'expected builder_billing_required'
              using errcode = 'P0004';
          end if;
        end;
        $billing_failure$;

        reset role;
        select count(*) from public.builder_event_materializations
        where idempotency_key = 'materialize-billing-failure';
        select count(*) from public.plans where title = 'Billing failure event';
        select count(*) from public.events where event_name = 'Billing failure event';
        select count(*) from public.builder_event_access_consumptions
        where builder_id = '${ids.builder}';
        select free_events_used from public.builder_profiles where id = '${ids.builder}';
      `))

      expect(output.split('\n')).toEqual(['0', '0', '0', '0', '2'])
    })

    it('returns the original identities and consumes once on a same-key retry', () => {
      const output = transaction(asRole('service_role', null, `
        update public.builder_profiles
        set free_events_used = 1
        where id = '${ids.builder}';
        ${call('materialize-retry-001')}
        ${call('materialize-retry-001')}
        reset role;
        select count(*) from public.builder_event_materializations
        where idempotency_key = 'materialize-retry-001';
        select count(*) from public.plans where title = 'Atomic materialized event';
        select count(*) from public.events where event_name = 'Atomic materialized event';
        select count(*) from public.builder_event_access_consumptions
        where builder_id = '${ids.builder}';
        select free_events_used from public.builder_profiles where id = '${ids.builder}';
      `))

      const lines = output.split('\n')
      const first = lines[0].split('|')
      const second = lines[1].split('|')
      expect(first.slice(0, 3)).toEqual(second.slice(0, 3))
      expect(first[5]).toBe('false')
      expect(second[5]).toBe('true')
      expect(lines.slice(2)).toEqual(['1', '1', '1', '1', '2'])
    })

    it('denies anonymous and authenticated callers at the function ACL', () => {
      expect(() => transaction(asRole('anon', null, call('materialize-anon-001')))).toThrow()
      expect(() => transaction(asRole(
        'authenticated',
        ids.organizer,
        call('materialize-authenticated-001'),
      ))).toThrow()
    })
  })

  describe('create_vendor_invite', () => {
    const call = `
      select vendor_id || '|' || relationship_id || '|' || rate_agreement_id || '|' || existing
      from public.create_vendor_invite(
        '${ids.organizer}', 'DB Function DJ', 'db-functions-dj@example.com',
        '415-555-0100', 'dj', 'flat', 450, '${ids.event}'
      );
    `

    it('creates the vendor, relationship, and rate agreement against PostgreSQL', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        ${call}
        reset role;
        select count(*) from public.vendor_profiles
        where contact_email = 'db-functions-dj@example.com' and claim_status = 'invited_unclaimed';
        select amount || '|' || source_event_id
        from public.vendor_rate_agreements where organizer_user_id = '${ids.organizer}';
      `))

      const lines = output.split('\n')
      expect(lines[0]).toMatch(/^[0-9a-f-]{36}\|[0-9a-f-]{36}\|[0-9a-f-]{36}\|false$/)
      expect(lines.slice(1)).toEqual(['1', `450.00|${ids.event}`])
    })

    it('returns the same invite as existing without adding duplicate rows', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        ${call}
        ${call}
        reset role;
        select count(*) from public.vendor_profiles
        where contact_email = 'db-functions-dj@example.com';
        select count(*) from public.organizer_vendor_relationships
        where organizer_user_id = '${ids.organizer}';
        select count(*) from public.vendor_rate_agreements
        where organizer_user_id = '${ids.organizer}';
      `))

      const lines = output.split('\n')
      expect(lines[0].endsWith('|false')).toBe(true)
      expect(lines[1].endsWith('|true')).toBe(true)
      expect(lines.slice(2)).toEqual(['1', '1', '1'])
    })

    it('denies an organizer mismatch and an event the organizer does not own', () => {
      expect(() => transaction(asRole('authenticated', ids.attacker, call))).toThrow()
      expect(() => transaction(asRole('authenticated', ids.organizer, `
        select * from public.create_vendor_invite(
          '${ids.organizer}', 'DB Function DJ', 'db-functions-dj@example.com',
          null, 'dj', 'flat', 450, gen_random_uuid()
        );
      `))).toThrow()
    })
  })

  describe('create_venue_invite', () => {
    const call = `
      select venue_id || '|' || relationship_id || '|' || term_agreement_id || '|' || existing
      from public.create_venue_invite(
        '${ids.organizer}', 'DB Function Restaurant', 'db-functions-restaurant@example.com',
        'Morgan', 'Events Manager', 'restaurant', 'Oakland', 'CA', 80, 40,
        'flat_rental', 180000, '${ids.event}'
      );
    `

    it('creates the venue, relationship, and cents-based term agreement', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        ${call}
        reset role;
        select count(*) from public.venues
        where contact_email = 'db-functions-restaurant@example.com'
          and claim_status = 'invited_unclaimed';
        select amount_cents || '|' || source_event_id
        from public.venue_term_agreements where organizer_user_id = '${ids.organizer}';
      `))

      const lines = output.split('\n')
      expect(lines[0]).toMatch(/^[0-9a-f-]{36}\|[0-9a-f-]{36}\|[0-9a-f-]{36}\|false$/)
      expect(lines.slice(1)).toEqual(['1', `180000|${ids.event}`])
    })

    it('returns the same invite as existing without adding duplicate rows', () => {
      const output = transaction(asRole('authenticated', ids.organizer, `
        ${call}
        ${call}
        reset role;
        select count(*) from public.venues
        where contact_email = 'db-functions-restaurant@example.com';
        select count(*) from public.organizer_venue_relationships
        where organizer_user_id = '${ids.organizer}';
        select count(*) from public.venue_term_agreements
        where organizer_user_id = '${ids.organizer}';
      `))

      const lines = output.split('\n')
      expect(lines[0].endsWith('|false')).toBe(true)
      expect(lines[1].endsWith('|true')).toBe(true)
      expect(lines.slice(2)).toEqual(['1', '1', '1'])
    })

    it('denies an organizer mismatch and an event the organizer does not own', () => {
      expect(() => transaction(asRole('authenticated', ids.attacker, call))).toThrow()
      expect(() => transaction(asRole('authenticated', ids.organizer, `
        select * from public.create_venue_invite(
          '${ids.organizer}', 'DB Function Restaurant', 'db-functions-restaurant@example.com',
          null, null, 'restaurant', 'Oakland', 'CA', 80, 40,
          'flat_rental', 180000, gen_random_uuid()
        );
      `))).toThrow()
    })
  })
})
