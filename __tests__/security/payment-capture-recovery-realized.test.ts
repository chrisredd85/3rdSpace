import { execFileSync, spawn } from 'node:child_process'

const databaseUrl = process.env.RLS_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_RLS_DB_TESTS === '1'

function psql(sql: string) {
  return execFileSync('psql', [
    databaseUrl,
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    sql,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function psqlUntilSentinel(sql: string, sentinel: string) {
  const child = spawn('psql', [
    databaseUrl,
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    sql,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let sentinelSeen = false
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const done = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      if (!sentinelSeen && stdout.includes(sentinel)) {
        sentinelSeen = true
        resolveReady()
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      rejectReady(error)
      reject(error)
    })
    child.on('close', (code) => {
      if (!sentinelSeen) {
        rejectReady(new Error(stderr || `psql exited before ${sentinel}`))
      }
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr || `psql exited with code ${code}`))
    })
  })
  return { ready, done }
}

function canConnect() {
  try {
    psql('select 1')
    return true
  } catch (error) {
    if (forceRun) throw error
    return false
  }
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('realized payment capture recovery schema', () => {
  it('preserves capturing rows while blocking later not-yet-started account payments', () => {
    const output = psql(`
      begin;

      insert into auth.users (id, aud, role, email, created_at, updated_at)
      values (
        '91000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'capture-owner@example.com',
        now(),
        now()
      );

      insert into public.users (id, email, role, user_type)
      values
        ('91000000-0000-4000-8000-000000000001', 'capture-owner@example.com', 'builder', 'community_builder'),
        ('91000000-0000-4000-8000-000000000002', 'capture-vendor@example.com', 'vendor', 'vendor');

      insert into public.vendor_profiles (id, user_id, name, vendor_type, is_published, slug)
      values (
        '91000000-0000-4000-8000-000000000010',
        '91000000-0000-4000-8000-000000000002',
        'Capture Recovery Vendor',
        'Caterer',
        false,
        'capture-recovery-vendor'
      );

      insert into public.vendor_stripe_accounts (
        id, vendor_id, stripe_account_id, account_status, charges_enabled, payouts_enabled
      ) values (
        '91000000-0000-4000-8000-000000000011',
        '91000000-0000-4000-8000-000000000010',
        'acct_capture_recovery',
        'active',
        true,
        true
      );

      insert into public.plans (id, user_id, title)
      values (
        '91000000-0000-4000-8000-000000000020',
        '91000000-0000-4000-8000-000000000001',
        'Capture recovery realized test'
      );

      insert into public.agent_actions (
        id, plan_id, action_type, description, status, amount_cents
      ) values
        (
          '91000000-0000-4000-8000-000000000030',
          '91000000-0000-4000-8000-000000000020',
          'payment',
          'In-flight payment',
          'executing',
          25000
        ),
        (
          '91000000-0000-4000-8000-000000000031',
          '91000000-0000-4000-8000-000000000020',
          'payment',
          'Future payment',
          'approved',
          30000
        ),
        (
          '91000000-0000-4000-8000-000000000032',
          '91000000-0000-4000-8000-000000000020',
          'payment',
          'Refunded payment',
          'complete',
          25000
        );

      insert into public.approvals (
        id, plan_id, agent_action_id, action_label, status,
        requested_amount_cents, authorized_amount_cents,
        snapshot_hash, authorized_by, authorized_at
      ) values
        (
          '91000000-0000-4000-8000-000000000040',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000030',
          'In-flight payment',
          'authorized',
          25000,
          25000,
          'capture-inflight-snapshot',
          '91000000-0000-4000-8000-000000000001',
          now()
        ),
        (
          '91000000-0000-4000-8000-000000000041',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000031',
          'Future payment',
          'authorized',
          30000,
          30000,
          'capture-future-snapshot',
          '91000000-0000-4000-8000-000000000001',
          now()
        ),
        (
          '91000000-0000-4000-8000-000000000042',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000032',
          'Refunded payment',
          'authorized',
          25000,
          25000,
          'capture-refunded-snapshot',
          '91000000-0000-4000-8000-000000000001',
          now()
        );

      update public.agent_actions
      set approval_id = case id
        when '91000000-0000-4000-8000-000000000030'::uuid
          then '91000000-0000-4000-8000-000000000040'::uuid
        when '91000000-0000-4000-8000-000000000031'::uuid
          then '91000000-0000-4000-8000-000000000041'::uuid
        else '91000000-0000-4000-8000-000000000042'::uuid
      end
      where id in (
        '91000000-0000-4000-8000-000000000030',
        '91000000-0000-4000-8000-000000000031',
        '91000000-0000-4000-8000-000000000032'
      );

      insert into public.payment_intents (
        id, plan_id, approval_id, partner_kind, partner_id,
        amount_cents, status, stripe_payment_intent_id,
        capture_attempt_id, capture_started_at
      ) values
        (
          '91000000-0000-4000-8000-000000000050',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000040',
          'vendor',
          '91000000-0000-4000-8000-000000000010',
          25000,
          'capturing',
          'pi_capture_recovery_inflight',
          '91000000-0000-4000-8000-000000000060',
          now() - interval '10 minutes'
        ),
        (
          '91000000-0000-4000-8000-000000000051',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000041',
          'vendor',
          '91000000-0000-4000-8000-000000000010',
          30000,
          'authorized',
          'pi_capture_recovery_future',
          null,
          null
        ),
        (
          '91000000-0000-4000-8000-000000000052',
          '91000000-0000-4000-8000-000000000020',
          '91000000-0000-4000-8000-000000000042',
          'vendor',
          '91000000-0000-4000-8000-000000000010',
          25000,
          'captured',
          'pi_capture_recovery_refund',
          '91000000-0000-4000-8000-000000000062',
          now() - interval '10 minutes'
        );

      update public.payment_intents
      set
        platform_fee_cents = 1000,
        captured_at = now(),
        capture_effects_completed_at = now()
      where id = '91000000-0000-4000-8000-000000000052';

      insert into public.payouts (
        id, payment_intent_id, partner_kind, partner_id, amount_cents, currency, status
      ) values (
        '91000000-0000-4000-8000-000000000070',
        '91000000-0000-4000-8000-000000000052',
        'vendor',
        '91000000-0000-4000-8000-000000000010',
        24000,
        'usd',
        'pending'
      );

      do $$
      begin
        begin
          update public.payment_intents
          set
            status = 'capturing',
            stripe_payment_intent_id = null,
            capture_attempt_id = '91000000-0000-4000-8000-000000000061',
            capture_started_at = now()
          where id = '91000000-0000-4000-8000-000000000051';
          raise exception 'capturing without Stripe PaymentIntent was accepted';
        exception
          when check_violation then null;
        end;
      end
      $$;

      select position(
        'stripe_payment_intent_id IS NOT NULL'
        in pg_get_constraintdef(oid)
      ) > 0
      from pg_constraint
      where conrelid = 'public.payment_intents'::regclass
        and conname = 'payment_intents_capture_attempt_check';

      select position(
        'blocked_by_account_state'
        in pg_get_indexdef(indexrelid)
      ) > 0 AND position(
        'refunded'
        in pg_get_indexdef(indexrelid)
      ) > 0
      from pg_index
      where indexrelid = 'public.payment_intents_one_active_per_approval'::regclass;

      select
        (result->>'payment_intents') || '|' ||
        (result->>'capturing_payment_intents_preserved')
      from (
        select public.block_inflight_stripe_account_payments(
          'acct_capture_recovery',
          'account.application.deauthorized',
          'evt_capture_recovery'
        ) result
      ) blocked;

      do $$
      begin
        begin
          insert into public.payment_intents (
            id, plan_id, approval_id, partner_kind, partner_id, amount_cents, status
          ) values (
            '91000000-0000-4000-8000-000000000053',
            '91000000-0000-4000-8000-000000000020',
            '91000000-0000-4000-8000-000000000041',
            'vendor',
            '91000000-0000-4000-8000-000000000010',
            30000,
            'pending'
          );
          raise exception 'account-blocked Stripe hold did not retain the approval uniqueness guard';
        exception
          when unique_violation then null;
        end;
      end
      $$;

      select id || '|' || status || '|' || coalesce(capture_attempt_id::text, '')
      from public.payment_intents
      where id in (
        '91000000-0000-4000-8000-000000000050',
        '91000000-0000-4000-8000-000000000051'
      )
      order by id;

      -- Exact origin/main compatibility shape: the deployed helper updates only
      -- status and ignores Supabase errors. This must succeed while preserving
      -- unknown refund truth as durable reconciliation work.
      update public.payment_intents
      set status = 'refunded'
      where id = '91000000-0000-4000-8000-000000000052';

      select status || '|' || refunded_amount_cents
      from public.payment_intents
      where id = '91000000-0000-4000-8000-000000000052';

      do $$
      begin
        begin
          insert into public.payment_intents (
            id, plan_id, approval_id, partner_kind, partner_id, amount_cents, status
          ) values (
            '91000000-0000-4000-8000-000000000055',
            '91000000-0000-4000-8000-000000000020',
            '91000000-0000-4000-8000-000000000042',
            'vendor',
            '91000000-0000-4000-8000-000000000010',
            25000,
            'pending'
          );
          raise exception 'unknown refund work reopened the original approval';
        exception
          when unique_violation then null;
        end;
      end
      $$;

      select
        (result->>'status') || '|' ||
        (result->>'refunded_amount_cents') || '|' ||
        (result->>'refund_delta_cents') || '|' ||
        (result->>'target_payout_amount_cents')
      from (
        select public.apply_planner_deposit_refund(
          'pi_capture_recovery_refund', 25000, 5000, 'usd', 'evt_refund_partial', false
        ) result
      ) applied;

      select
        (result->>'status') || '|' ||
        (result->>'refunded_amount_cents') || '|' ||
        (result->>'refund_delta_cents') || '|' ||
        (result->>'target_payout_amount_cents')
      from (
        select public.apply_planner_deposit_refund(
          'pi_capture_recovery_refund', 25000, 2500, 'usd', 'evt_refund_older', false
        ) result
      ) applied;

      select
        (result->>'status') || '|' ||
        (result->>'refunded_amount_cents') || '|' ||
        (result->>'refund_delta_cents') || '|' ||
        (result->>'target_payout_amount_cents')
      from (
        select public.apply_planner_deposit_refund(
          'pi_capture_recovery_refund', 25000, 25000, 'usd', 'evt_refund_full', true
        ) result
      ) applied;

      select amount_cents || '|' || status
      from public.payouts
      where id = '91000000-0000-4000-8000-000000000070';

      do $$
      begin
        begin
          update public.payment_intents
          set platform_fee_cents = amount_cents + 1
          where id = '91000000-0000-4000-8000-000000000052';
          raise exception 'platform fee above payment amount was accepted';
        exception
          when check_violation then null;
        end;

        begin
          insert into public.payment_intents (
            id, plan_id, approval_id, partner_kind, partner_id, amount_cents, status
          ) values (
            '91000000-0000-4000-8000-000000000054',
            '91000000-0000-4000-8000-000000000020',
            '91000000-0000-4000-8000-000000000042',
            'vendor',
            '91000000-0000-4000-8000-000000000010',
            25000,
            'pending'
          );
          raise exception 'fully refunded payment reopened the original approval';
        exception
          when unique_violation then null;
        end;
      end
      $$;

      rollback;
    `)

    expect(output.split('\n')).toEqual([
      't',
      't',
      '1|1',
      '91000000-0000-4000-8000-000000000050|capturing|91000000-0000-4000-8000-000000000060',
      '91000000-0000-4000-8000-000000000051|blocked_by_account_state|',
      'refund_reconciliation_required|0',
      'captured|5000|5000|19000',
      'captured|5000|0|19000',
      'refunded|25000|20000|0',
      '0|cancelled',
    ])
  })

  it('keeps external refund reversal work cumulative and leaves legacy full refunds effects-eligible', () => {
    const output = psql(`
      begin;

      insert into auth.users (id, aud, role, email, created_at, updated_at)
      values (
        '92000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'refund-owner@example.com',
        now(),
        now()
      );

      insert into public.users (id, email, role, user_type)
      values
        ('92000000-0000-4000-8000-000000000001', 'refund-owner@example.com', 'builder', 'community_builder'),
        ('92000000-0000-4000-8000-000000000002', 'refund-vendor@example.com', 'vendor', 'vendor');

      insert into public.vendor_profiles (id, user_id, name, vendor_type, is_published, slug)
      values (
        '92000000-0000-4000-8000-000000000010',
        '92000000-0000-4000-8000-000000000002',
        'Refund Recovery Vendor',
        'Caterer',
        false,
        'refund-recovery-vendor'
      );

      insert into public.plans (id, user_id, title)
      values (
        '92000000-0000-4000-8000-000000000020',
        '92000000-0000-4000-8000-000000000001',
        'Refund recovery realized test'
      );

      insert into public.agent_actions (
        id, plan_id, action_type, description, status, amount_cents
      ) values
        (
          '92000000-0000-4000-8000-000000000030',
          '92000000-0000-4000-8000-000000000020',
          'payment',
          'Externally paid refund',
          'complete',
          25000
        ),
        (
          '92000000-0000-4000-8000-000000000031',
          '92000000-0000-4000-8000-000000000020',
          'payment',
          'Legacy full refund',
          'executing',
          25000
        );

      insert into public.approvals (
        id, plan_id, agent_action_id, action_label, status,
        requested_amount_cents, authorized_amount_cents,
        snapshot_hash, authorized_by, authorized_at
      ) values
        (
          '92000000-0000-4000-8000-000000000040',
          '92000000-0000-4000-8000-000000000020',
          '92000000-0000-4000-8000-000000000030',
          'Externally paid refund',
          'authorized',
          25000,
          25000,
          'external-refund-snapshot',
          '92000000-0000-4000-8000-000000000001',
          now()
        ),
        (
          '92000000-0000-4000-8000-000000000041',
          '92000000-0000-4000-8000-000000000020',
          '92000000-0000-4000-8000-000000000031',
          'Legacy full refund',
          'authorized',
          25000,
          25000,
          'legacy-refund-snapshot',
          '92000000-0000-4000-8000-000000000001',
          now()
        );

      update public.agent_actions
      set approval_id = case id
        when '92000000-0000-4000-8000-000000000030'::uuid
          then '92000000-0000-4000-8000-000000000040'::uuid
        else '92000000-0000-4000-8000-000000000041'::uuid
      end
      where id in (
        '92000000-0000-4000-8000-000000000030',
        '92000000-0000-4000-8000-000000000031'
      );

      insert into public.payment_intents (
        id, plan_id, approval_id, partner_kind, partner_id,
        amount_cents, platform_fee_cents, status, stripe_payment_intent_id,
        capture_attempt_id, capture_started_at, captured_at,
        capture_effects_completed_at
      ) values
        (
          '92000000-0000-4000-8000-000000000050',
          '92000000-0000-4000-8000-000000000020',
          '92000000-0000-4000-8000-000000000040',
          'vendor',
          '92000000-0000-4000-8000-000000000010',
          25000,
          1000,
          'captured',
          'pi_external_refund_recovery',
          '92000000-0000-4000-8000-000000000060',
          now() - interval '10 minutes',
          now() - interval '9 minutes',
          now() - interval '8 minutes'
        ),
        (
          '92000000-0000-4000-8000-000000000051',
          '92000000-0000-4000-8000-000000000020',
          '92000000-0000-4000-8000-000000000041',
          'vendor',
          '92000000-0000-4000-8000-000000000010',
          25000,
          1000,
          'captured',
          'pi_legacy_null_attempt_refund',
          null,
          null,
          now() - interval '9 minutes',
          null
        );

      insert into public.payouts (
        id, payment_intent_id, partner_kind, partner_id, amount_cents,
        currency, status, stripe_payout_id
      ) values (
        '92000000-0000-4000-8000-000000000070',
        '92000000-0000-4000-8000-000000000050',
        'vendor',
        '92000000-0000-4000-8000-000000000010',
        24000,
        'usd',
        'paid',
        'po_external_refund_recovery'
      );

      select public.apply_planner_deposit_refund(
        'pi_external_refund_recovery', 25000, 5000, 'usd', 'evt_external_partial', false
      )->>'refund_delta_cents';

      select
        status || '|' ||
        (metadata->>'refunded_amount_cents') || '|' ||
        (metadata->>'target_payout_amount_cents') || '|' ||
        count(*) over ()
      from public.admin_tasks
      where task_type = 'payment_refund_reversal'
        and metadata->>'payment_intent_id' = '92000000-0000-4000-8000-000000000050';

      update public.admin_tasks
      set status = 'complete', completed_at = now()
      where task_type = 'payment_refund_reversal'
        and metadata->>'payment_intent_id' = '92000000-0000-4000-8000-000000000050';

      select public.apply_planner_deposit_refund(
        'pi_external_refund_recovery', 25000, 25000, 'usd', 'evt_external_full', true
      )->>'refund_delta_cents';

      select
        status || '|' ||
        (metadata->>'refunded_amount_cents') || '|' ||
        (metadata->>'target_payout_amount_cents') || '|' ||
        (completed_at is null)::text || '|' ||
        count(*) over ()
      from public.admin_tasks
      where task_type = 'payment_refund_reversal'
        and metadata->>'payment_intent_id' = '92000000-0000-4000-8000-000000000050';

      update public.admin_tasks
      set status = 'complete', completed_at = now()
      where task_type = 'payment_refund_reversal'
        and metadata->>'payment_intent_id' = '92000000-0000-4000-8000-000000000050';

      select public.apply_planner_deposit_refund(
        'pi_external_refund_recovery', 25000, 2500, 'usd', 'evt_external_older', false
      )->>'refund_delta_cents';

      select
        status || '|' ||
        (metadata->>'refunded_amount_cents') || '|' ||
        (metadata->>'target_payout_amount_cents') || '|' ||
        count(*) over ()
      from public.admin_tasks
      where task_type = 'payment_refund_reversal'
        and metadata->>'payment_intent_id' = '92000000-0000-4000-8000-000000000050';

      select public.apply_planner_deposit_refund(
        'pi_legacy_null_attempt_refund', 25000, 25000, 'usd', 'evt_legacy_full', true
      )->>'status';

      select status || '|' ||
        coalesce(capture_attempt_id::text, 'null') || '|' ||
        (capture_effects_completed_at is null)::text
      from public.payment_intents
      where id = '92000000-0000-4000-8000-000000000051';

      select has_function_privilege(
        'service_role',
        'public.sync_planner_refund_reversal_task(uuid,uuid,uuid,text,integer,integer,text)',
        'EXECUTE'
      );

      rollback;
    `)

    expect(output.split('\n')).toEqual([
      '5000',
      'open|5000|19000|1',
      '20000',
      'open|25000|0|true|1',
      '0',
      'complete|25000|0|1',
      'refunded',
      'refunded|null|true',
      't',
    ])
  })

  it('revalidates approval truth inside the capture reservation transaction', () => {
    const output = psql(`
      begin;

      insert into auth.users (id, aud, role, email, created_at, updated_at)
      values (
        '93000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'capture-rpc-owner@example.com',
        now(),
        now()
      );

      insert into public.users (id, email, role, user_type)
      values ('93000000-0000-4000-8000-000000000001', 'capture-rpc-owner@example.com', 'builder', 'community_builder');

      insert into public.plans (id, user_id, title)
      values (
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000001',
        'Atomic capture reservation test'
      );

      insert into public.agent_actions (
        id, plan_id, action_type, description, status, amount_cents,
        target_type, target_id
      ) values (
        '93000000-0000-4000-8000-000000000020',
        '93000000-0000-4000-8000-000000000010',
        'payment',
        'Capture approved vendor deposit',
        'executing',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030'
      );

      insert into public.approvals (
        id, plan_id, agent_action_id, action_label, status,
        requested_amount_cents, authorized_amount_cents, fees_cents,
        authorized_by, authorized_at, snapshot_hash, expires_at
      ) values (
        '93000000-0000-4000-8000-000000000040',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000020',
        'Capture approved vendor deposit',
        'authorized',
        15000,
        15000,
        500,
        '93000000-0000-4000-8000-000000000001',
        now(),
        'snapshot-v1',
        now() + interval '1 day'
      );

      update public.agent_actions
      set approval_id = '93000000-0000-4000-8000-000000000040'
      where id = '93000000-0000-4000-8000-000000000020';

      insert into public.payment_intents (
        id, plan_id, approval_id, partner_kind, partner_id,
        amount_cents, platform_fee_cents, status, stripe_payment_intent_id,
        authorized_at
      ) values (
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        15000,
        500,
        'authorized',
        'pi_atomic_capture_reservation',
        now()
      );

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'stale-snapshot',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000060'
      );

      select status from public.payment_intents
      where id = '93000000-0000-4000-8000-000000000050';

      update public.approvals
      set status = 'superseded', superseded_at = now()
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000061'
      );

      -- Simulate a pre-control-plane legacy row. The final schema rejects new
      -- executable approvals without snapshots, but the capture RPC must remain
      -- safe for legacy NULL/NULL snapshot pairs that predate that trigger.
      set local session_replication_role = replica;

      update public.approvals
      set status = 'authorized', superseded_at = null, snapshot_hash = null
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        null,
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000062'
      );

      select status || '|' || coalesce(capture_attempt_id::text, 'null')
      from public.payment_intents
      where id = '93000000-0000-4000-8000-000000000050';

      update public.approvals
      set snapshot_hash = 'snapshot-v1', authorized_by = null
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000063'
      );

      update public.approvals
      set authorized_by = '93000000-0000-4000-8000-000000000001', authorized_at = null
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000064'
      );

      update public.approvals
      set authorized_at = now(), snapshot_hash = '   '
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000065'
      );

      update public.approvals
      set snapshot_hash = 'snapshot-v1', expires_at = now() - interval '1 minute'
      where id = '93000000-0000-4000-8000-000000000040';

      select count(*)
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000066'
      );

      update public.approvals
      set expires_at = now() + interval '1 day'
      where id = '93000000-0000-4000-8000-000000000040';

      select status || '|' || capture_attempt_id::text
      from public.reserve_planner_deposit_capture(
        '93000000-0000-4000-8000-000000000050',
        '93000000-0000-4000-8000-000000000010',
        '93000000-0000-4000-8000-000000000040',
        'snapshot-v1',
        15000,
        'vendor',
        '93000000-0000-4000-8000-000000000030',
        '93000000-0000-4000-8000-000000000067'
      );

      set local session_replication_role = origin;

      select has_function_privilege(
        'authenticated',
        'public.reserve_planner_deposit_capture(uuid,uuid,uuid,text,integer,text,uuid,uuid)',
        'EXECUTE'
      );

      select has_function_privilege(
        'anon',
        'public.reserve_planner_deposit_capture(uuid,uuid,uuid,text,integer,text,uuid,uuid)',
        'EXECUTE'
      );

      select has_function_privilege(
        'service_role',
        'public.reserve_planner_deposit_capture(uuid,uuid,uuid,text,integer,text,uuid,uuid)',
        'EXECUTE'
      );

      rollback;
    `)

    expect(output.split('\n')).toEqual([
      '0',
      'authorized',
      '0',
      '0',
      'authorized|null',
      '0',
      '0',
      '0',
      '0',
      'capturing|93000000-0000-4000-8000-000000000067',
      'f',
      'f',
      't',
    ])
  })

  it('serializes revision-first and reservation-first capture races without deadlock', async () => {
    const planId = '94000000-0000-4000-8000-000000000010'
    const approvalId = '94000000-0000-4000-8000-000000000040'
    const paymentId = '94000000-0000-4000-8000-000000000050'
    const partnerId = '94000000-0000-4000-8000-000000000030'
    const firstAttemptId = '94000000-0000-4000-8000-000000000060'
    const secondAttemptId = '94000000-0000-4000-8000-000000000061'

    psql(`
      insert into auth.users (id, aud, role, email, created_at, updated_at)
      values (
        '94000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'capture-race-owner@example.com',
        now(),
        now()
      );
      insert into public.users (id, email, role, user_type)
      values ('94000000-0000-4000-8000-000000000001', 'capture-race-owner@example.com', 'builder', 'community_builder');
      insert into public.plans (id, user_id, title)
      values ('${planId}', '94000000-0000-4000-8000-000000000001', 'Capture race test');
      insert into public.agent_actions (
        id, plan_id, action_type, description, status, amount_cents,
        target_type, target_id
      ) values (
        '94000000-0000-4000-8000-000000000020', '${planId}', 'payment',
        'Capture race action', 'executing', 17500, 'vendor', '${partnerId}'
      );
      insert into public.approvals (
        id, plan_id, agent_action_id, action_label, status,
        requested_amount_cents, authorized_amount_cents, fees_cents,
        authorized_by, authorized_at, snapshot_hash
      ) values (
        '${approvalId}', '${planId}', '94000000-0000-4000-8000-000000000020',
        'Capture race approval', 'authorized', 17500, 17500, 750,
        '94000000-0000-4000-8000-000000000001', now(), 'race-snapshot'
      );
      update public.agent_actions set approval_id = '${approvalId}'
      where id = '94000000-0000-4000-8000-000000000020';
      insert into public.payment_intents (
        id, plan_id, approval_id, partner_kind, partner_id, amount_cents,
        platform_fee_cents, status, stripe_payment_intent_id, authorized_at
      ) values (
        '${paymentId}', '${planId}', '${approvalId}', 'vendor', '${partnerId}',
        17500, 750, 'authorized', 'pi_capture_race', now()
      );
    `)

    try {
      const revisionFirst = psqlUntilSentinel(`
        begin;
        select 'REVISION_LOCKED' from public.plans where id = '${planId}' for update;
        select pg_sleep(0.25);
        update public.approvals
        set status = 'superseded', superseded_at = now()
        where id = '${approvalId}';
        commit;
      `, 'REVISION_LOCKED')
      await revisionFirst.ready

      expect(psql(`
        select count(*) from public.reserve_planner_deposit_capture(
          '${paymentId}', '${planId}', '${approvalId}', 'race-snapshot',
          17500, 'vendor', '${partnerId}', '${firstAttemptId}'
        );
      `)).toBe('0')
      await revisionFirst.done
      expect(psql(`select status from public.payment_intents where id = '${paymentId}'`))
        .toBe('authorized')

      psql(`
        update public.approvals
        set status = 'authorized', superseded_at = null
        where id = '${approvalId}';
      `)

      const reservationFirst = psqlUntilSentinel(`
        begin;
        select 'RESERVATION_LOCKED|' || status
        from public.reserve_planner_deposit_capture(
          '${paymentId}', '${planId}', '${approvalId}', 'race-snapshot',
          17500, 'vendor', '${partnerId}', '${secondAttemptId}'
        );
        select pg_sleep(0.25);
        commit;
      `, 'RESERVATION_LOCKED|capturing')
      await reservationFirst.ready

      psql(`
        begin;
        select 1 from public.plans where id = '${planId}' for update;
        update public.approvals
        set status = 'superseded', superseded_at = now()
        where id = '${approvalId}';
        commit;
      `)
      await reservationFirst.done

      expect(psql(`
        select status || '|' || capture_attempt_id::text
        from public.payment_intents where id = '${paymentId}';
      `)).toBe(`capturing|${secondAttemptId}`)
      expect(psql(`select status from public.approvals where id = '${approvalId}'`))
        .toBe('superseded')
    } finally {
      psql(`
        delete from public.plans where id = '${planId}';
        delete from public.users where id = '94000000-0000-4000-8000-000000000001';
        delete from auth.users where id = '94000000-0000-4000-8000-000000000001';
      `)
    }
  }, 15000)
})
