/**
 * @jest-environment node
 */

import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const databaseUrl = process.env.RLS_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_WRITE_PAUSE_DB_TESTS === '1'

function psql(sql: string): string {
  return execFileSync('psql', [
    databaseUrl,
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    sql,
  ], { encoding: 'utf8' }).trim()
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

const describeDb = canConnect() ? describe : describe.skip

describeDb('realized durable write-pause control', () => {
  afterEach(() => {
    psql(`
      update public.release_runtime_controls
      set enabled = false,
          reason = 'test cleanup',
          changed_by = 'write-pause-realized-test'
      where control_key = 'write_pause';

      delete from public.stripe_webhook_events
      where stripe_event_id like 'evt_write_pause_realized%';
    `)
  })

  it('exposes only read-only public status columns and keeps mutation service-owned', () => {
    expect(psql(`
      select
        has_column_privilege('anon', 'public.release_runtime_controls', 'enabled', 'SELECT'),
        has_column_privilege('anon', 'public.release_runtime_controls', 'changed_by', 'SELECT'),
        has_table_privilege('anon', 'public.release_runtime_controls', 'UPDATE'),
        has_table_privilege('authenticated', 'public.release_runtime_controls', 'UPDATE'),
        has_table_privilege('service_role', 'public.release_runtime_controls', 'UPDATE');
    `)).toBe('t|f|f|f|t')

    expect(psql(`
      begin;
      set local role anon;
      select control_key || '|' || enabled::text || '|' || revision::text
      from public.release_runtime_controls
      where control_key = 'write_pause';
      rollback;
    `)).toMatch(/^write_pause\|false\|\d+$/)
  })

  it('serializes concurrent compare-and-swap flips to one winner', async () => {
    const revision = Number(psql(`
      select revision
      from public.release_runtime_controls
      where control_key = 'write_pause';
    `))
    const update = (enabled: boolean, actor: string) => execFileAsync('psql', [
      databaseUrl,
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      `
        begin;
        set local role service_role;
        update public.release_runtime_controls
        set enabled = ${enabled ? 'true' : 'false'},
            reason = 'concurrent realized test',
            changed_by = '${actor}'
        where control_key = 'write_pause'
          and revision = ${revision}
        returning revision;
        commit;
      `,
    ], { encoding: 'utf8' })

    const results = await Promise.all([
      update(true, 'actor-a'),
      update(false, 'actor-b'),
    ])
    const returnedRevisions = results
      .map((result) => result.stdout.trim())
      .filter(Boolean)

    expect(returnedRevisions).toEqual([String(revision + 1)])
    expect(Number(psql(`
      select revision
      from public.release_runtime_controls
      where control_key = 'write_pause';
    `))).toBe(revision + 1)
  })

  it('protects lazy plan-cache writes and every read-on-write backing table', () => {
    expect(psql(`
      select count(*)
      from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and trigger.tgname = 'reject_write_during_release_pause'
        and relation.relname in (
          'plans',
          'partnership_threads',
          'partnership_messages',
          'partnership_milestones',
          'partnership_documents',
          'event_financial_summary'
        );
    `)).toBe('6')

    psql(`
      update public.release_runtime_controls
      set enabled = true,
          reason = 'realized plan-cache protection test',
          changed_by = 'write-pause-realized-test'
      where control_key = 'write_pause';
    `)

    expect(() => psql(`
      begin;
      set local role service_role;
      select set_config('request.jwt.claim.role', 'service_role', true);
      update public.plans
      set metadata = metadata
      where false;
      rollback;
    `)).toThrow()
  })

  it('realizes the deferred Stripe queue state and partial index', () => {
    expect(psql(`
      insert into public.stripe_webhook_events (
        stripe_event_id,
        event_type,
        payload,
        processed,
        source,
        endpoint_path,
        livemode,
        processing_outcome,
        received_at,
        in_flight,
        maintenance_deferred_at
      ) values (
        'evt_write_pause_realized',
        'invoice.paid',
        '{"id":"evt_write_pause_realized","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        false,
        'platform',
        '/api/webhooks/stripe',
        false,
        'deferred_maintenance',
        now(),
        false,
        now()
      )
      returning processing_outcome || '|' || processed::text || '|' || in_flight::text;
    `)).toBe('deferred_maintenance|false|false')

    expect(psql(`
      select count(*)
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'idx_stripe_webhook_events_maintenance_deferred'
        and indexdef like '%WHERE ((maintenance_deferred_at IS NOT NULL) AND (processed IS FALSE))%';
    `)).toBe('1')
  })

  it('realizes state-aware deferral, replay fencing, stale reclaim, and atomic drain completion', () => {
    psql(`
      update public.release_runtime_controls
      set state = 'paused',
          reason = 'realized webhook state-machine test',
          changed_by = 'write-pause-realized-test'
      where control_key = 'write_pause';
    `)

    expect(psql(`
      begin;
      set local role service_role;
      select
        deferred::text || '|' ||
        control_state || '|' ||
        in_flight::text || '|' ||
        reserved_now::text || '|' ||
        (reservation_token is null)::text
      from public.reserve_stripe_webhook_event(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        false
      );
      commit;
    `)).toBe('true|paused|false|false|true')

    expect(psql(`
      select processing_outcome || '|' || processed::text || '|' || in_flight::text
      from public.stripe_webhook_events
      where stripe_event_id = 'evt_write_pause_realized_replay';
    `)).toBe('deferred_maintenance|false|false')

    expect(psql(`
      begin;
      set local role service_role;
      select in_flight::text || '|' || reserved_now::text
      from public.reserve_stripe_webhook_event(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false
      );
      commit;
    `)).toBe('true|false')

    const pausedRevision = Number(psql(`
      select revision
      from public.release_runtime_controls
      where control_key = 'write_pause';
    `))
    const drainingTransition = JSON.parse(psql(`
      begin;
      set local role service_role;
      select public.transition_release_runtime_control(
        ${pausedRevision},
        'draining',
        'realized webhook drain',
        'write-pause-realized-test'
      );
      commit;
    `)) as { applied: boolean; code: string; control: { state: string } }
    expect(drainingTransition).toMatchObject({
      applied: true,
      code: 'state_changed',
      control: { state: 'draining' },
    })

    expect(psql(`
      begin;
      set local role service_role;
      select deferred::text || '|' || control_state
      from public.reserve_stripe_webhook_event(
        'evt_write_pause_realized_external_during_drain',
        'account.updated',
        '{"id":"evt_write_pause_realized_external_during_drain","type":"account.updated","data":{"object":{}}}'::jsonb,
        'connect',
        '/api/webhooks/stripe/connect',
        false,
        false
      );
      commit;
    `)).toBe('true|draining')

    const staleToken = psql(`
      begin;
      set local role service_role;
      select reservation_token::text
      from public.reserve_stripe_webhook_event(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        true
      );
      commit;
    `)
    expect(staleToken).toMatch(/^[0-9a-f-]{36}$/)

    psql(`
      update public.stripe_webhook_events
      set reserved_at = clock_timestamp() - interval '10 minutes'
      where stripe_event_id = 'evt_write_pause_realized_replay';
    `)
    expect(Number(psql(`
      begin;
      set local role service_role;
      select released_count
      from public.release_stale_stripe_webhook_reservations('5 minutes'::interval);
      commit;
    `))).toBeGreaterThanOrEqual(1)

    const currentToken = psql(`
      begin;
      set local role service_role;
      select reservation_token::text
      from public.reserve_stripe_webhook_event(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        true
      );
      commit;
    `)
    expect(currentToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(currentToken).not.toBe(staleToken)

    expect(() => psql(`
      begin;
      set local role service_role;
      select public.record_stripe_webhook_event_result(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        'processed',
        true,
        null,
        '${staleToken}'::uuid
      );
      rollback;
    `)).toThrow()

    expect(psql(`
      begin;
      set local role service_role;
      select public.record_stripe_webhook_event_result(
        'evt_write_pause_realized_replay',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_replay","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        'processed',
        true,
        null,
        '${currentToken}'::uuid
      )->>'processed';
      commit;
    `)).toBe('true')

    const drainingRevision = Number(psql(`
      select revision
      from public.release_runtime_controls
      where control_key = 'write_pause';
    `))
    const refusedOpen = JSON.parse(psql(`
      begin;
      set local role service_role;
      select public.complete_write_pause_drain(
        ${drainingRevision},
        'realized drain complete',
        'write-pause-realized-test'
      );
      commit;
    `)) as { applied: boolean; opened: boolean; code: string; remaining: number; control: { state: string } }
    expect(refusedOpen).toMatchObject({
      applied: false,
      opened: false,
      code: 'queue_not_empty',
      remaining: 1,
      control: { state: 'draining' },
    })

    psql(`
      delete from public.stripe_webhook_events
      where stripe_event_id = 'evt_write_pause_realized_external_during_drain';
    `)
    const completedOpen = JSON.parse(psql(`
      begin;
      set local role service_role;
      select public.complete_write_pause_drain(
        ${drainingRevision},
        'realized drain complete',
        'write-pause-realized-test'
      );
      commit;
    `)) as { applied: boolean; opened: boolean; code: string; remaining: number; control: { state: string } }
    expect(completedOpen).toMatchObject({
      applied: true,
      opened: true,
      code: 'drain_complete',
      remaining: 0,
      control: { state: 'open' },
    })

    expect(psql(`
      begin;
      set local role service_role;
      with reservation as (
        select *
        from public.reserve_stripe_webhook_event(
          'evt_write_pause_realized_legacy_open',
          'invoice.paid',
          '{"id":"evt_write_pause_realized_legacy_open","type":"invoice.paid","data":{"object":{}}}'::jsonb,
          'platform',
          '/api/webhooks/stripe',
          false
        )
      )
      select in_flight::text || '|' || reserved_now::text
      from reservation;
      commit;
    `)).toBe('true|true')

    expect(psql(`
      begin;
      set local role service_role;
      select public.record_stripe_webhook_event_result(
        'evt_write_pause_realized_legacy_open',
        'invoice.paid',
        '{"id":"evt_write_pause_realized_legacy_open","type":"invoice.paid","data":{"object":{}}}'::jsonb,
        'platform',
        '/api/webhooks/stripe',
        false,
        'processed',
        true,
        null
      )->>'processed';
      commit;
    `)).toBe('true')
  })
})
