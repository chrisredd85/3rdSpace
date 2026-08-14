import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const databaseUrl = process.env.RLS_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL
const apiUrl = process.env.RLS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const jwtSecret = process.env.RLS_TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const forceRun = process.env.RUN_RLS_DB_TESTS === '1'

const ownerReadableTables = [
  'agent_actions',
  'approvals',
  'agent_authorizations',
  'payment_intents',
  'plan_derived_state',
  'plan_versions',
  'plan_revisions',
  'planner_plan_updates',
  'plan_activity',
  'audit_logs',
  'agent_action_audit_log',
  'agent_runs',
  'venue_booking_approval_audit',
  'plan_messages',
  'outreach_threads',
  'outreach_messages',
  'creator_outreach_policies',
  'venue_opportunity_briefs',
  'venue_opportunity_invites',
  'vendor_opportunity_briefs',
  'vendor_opportunity_invites',
  'vendor_transactions',
  'platform_fee_transactions',
  'settlement_charges',
] as const

const serviceOnlyTables = [
  'admin_tasks',
  'kickback_payments',
] as const

const trustedTables = [...ownerReadableTables, ...serviceOnlyTables] as const

const updateProbeByTable: Record<(typeof trustedTables)[number], Record<string, unknown>> = {
  agent_actions: { status: 'pending' },
  approvals: { status: 'pending' },
  agent_authorizations: { pause_agent_spending: true },
  payment_intents: { status: 'failed' },
  plan_derived_state: { computed_at: '2099-01-01T00:00:00Z' },
  plan_versions: { change_reason: 'forbidden probe' },
  plan_revisions: { impact_summary: {} },
  planner_plan_updates: { new_value: {} },
  plan_activity: { summary: 'forbidden probe' },
  audit_logs: { action: 'forbidden.probe' },
  agent_action_audit_log: { reason: 'forbidden probe' },
  agent_runs: { error: 'forbidden probe' },
  venue_booking_approval_audit: { message: 'forbidden probe' },
  plan_messages: { content: 'forbidden probe' },
  outreach_threads: { needs_attention: true },
  outreach_messages: { subject: 'forbidden probe' },
  creator_outreach_policies: { max_inquiries_per_event: 1 },
  venue_opportunity_briefs: { title: 'forbidden probe' },
  venue_opportunity_invites: { status: 'cancelled' },
  vendor_opportunity_briefs: { summary: 'forbidden probe' },
  vendor_opportunity_invites: { status: 'cancelled' },
  vendor_transactions: { status: 'failed' },
  platform_fee_transactions: { status: 'failed' },
  settlement_charges: { status: 'failed' },
  admin_tasks: { status: 'cancelled' },
  kickback_payments: { status: 'failed' },
}

const ids = {
  userA: 'a1000000-0000-4000-8000-000000000001',
  userB: 'a1000000-0000-4000-8000-000000000002',
  builderA: 'a2000000-0000-4000-8000-000000000001',
  builderB: 'a2000000-0000-4000-8000-000000000002',
  planA: 'a3000000-0000-4000-8000-000000000001',
  planB: 'a3000000-0000-4000-8000-000000000002',
  eventA: 'a4000000-0000-4000-8000-000000000001',
  eventB: 'a4000000-0000-4000-8000-000000000002',
  actionA: 'a5000000-0000-4000-8000-000000000001',
  actionB: 'a5000000-0000-4000-8000-000000000002',
  approvalA: 'a6000000-0000-4000-8000-000000000001',
  approvalB: 'a6000000-0000-4000-8000-000000000002',
  messageA: 'a7000000-0000-4000-8000-000000000001',
  messageB: 'a7000000-0000-4000-8000-000000000002',
  outreachA: 'a8000000-0000-4000-8000-000000000001',
  outreachB: 'a8000000-0000-4000-8000-000000000002',
  venueBriefA: 'a9000000-0000-4000-8000-000000000001',
  venueBriefB: 'a9000000-0000-4000-8000-000000000002',
  vendorBriefA: 'aa000000-0000-4000-8000-000000000001',
  vendorBriefB: 'aa000000-0000-4000-8000-000000000002',
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
  return /database system is (starting up|in recovery mode)|connection .* failed|the database system is shutting down/i
    .test(commandErrorText(error))
}

function commandErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: Buffer | string }).stderr
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

function expectTransactionError(sql: string, pattern: RegExp): void {
  try {
    transaction(sql)
  } catch (error) {
    expect(commandErrorText(error)).toMatch(pattern)
    return
  }

  throw new Error(`Expected transaction to fail: ${sql}`)
}

function roleToken(role: 'anon' | 'authenticated', userId: string | null): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'supabase-demo',
    role,
    ...(userId ? { sub: userId, aud: 'authenticated' } : {}),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url')
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function postgrest(
  table: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
) {
  const token = roleToken('authenticated', ids.userA)
  const keyColumn = table === 'plan_derived_state' ? 'plan_id' : 'id'
  const query = method === 'POST' ? '' : `?${keyColumn}=eq.00000000-0000-4000-8000-000000000000`
  return fetch(`${apiUrl}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: token,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function expectPostgrestPermissionDenied(
  table: (typeof trustedTables)[number],
  method: 'POST' | 'PATCH' | 'DELETE',
): Promise<void> {
  const body = method === 'POST' ? {} : method === 'PATCH' ? updateProbeByTable[table] : undefined
  const response = await postgrest(table, method, body)
  const responseBody = await response.text()

  expect(response.status).toBe(403)
  expect(responseBody).toMatch(new RegExp(`permission denied for table ${table}`, 'i'))
}

function baseFixtureSql(): string {
  return `
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.userA}', 'authenticated', 'authenticated', 'control-plane-a@example.com', now(), now()),
      ('${ids.userB}', 'authenticated', 'authenticated', 'control-plane-b@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values
      ('${ids.userA}', 'control-plane-a@example.com', 'builder', 'community_builder'),
      ('${ids.userB}', 'control-plane-b@example.com', 'builder', 'community_builder');

    insert into public.builder_profiles (id, user_id, name)
    values
      ('${ids.builderA}', '${ids.userA}', 'Control Plane Builder A'),
      ('${ids.builderB}', '${ids.userB}', 'Control Plane Builder B');

    insert into public.plans (id, user_id, title)
    values
      ('${ids.planA}', '${ids.userA}', 'Control Plane Plan A'),
      ('${ids.planB}', '${ids.userB}', 'Control Plane Plan B');

    insert into public.events (
      id, builder_id, event_name, event_type, event_date, start_time, end_time, duration_hours
    ) values
      ('${ids.eventA}', '${ids.builderA}', 'Control Plane Event A', 'networking', '2026-09-01', '18:00', '21:00', 3),
      ('${ids.eventB}', '${ids.builderB}', 'Control Plane Event B', 'networking', '2026-09-02', '18:00', '21:00', 3);

    insert into public.venues (
      id, owner_id, venue_name, venue_type, is_published, slug
    ) values
      ('ac000000-0000-4000-8000-000000000001', '${ids.userA}', 'Control Plane Venue A', 'gallery', false, 'control-plane-venue-a'),
      ('ac000000-0000-4000-8000-000000000002', '${ids.userB}', 'Control Plane Venue B', 'gallery', false, 'control-plane-venue-b');

    insert into public.vendor_profiles (id, user_id, name, vendor_type)
    values
      ('ac000000-0000-4000-8000-000000000003', '${ids.userA}', 'Control Plane Vendor A', 'Caterer'),
      ('ac000000-0000-4000-8000-000000000004', '${ids.userB}', 'Control Plane Vendor B', 'Caterer');

    insert into public.venue_bookings (
      id, venue_id, event_id, organizer_id, booking_date, status
    ) values
      ('ac000000-0000-4000-8000-000000000005', 'ac000000-0000-4000-8000-000000000001', '${ids.eventA}', '${ids.userA}', '2026-09-01', 'pending'),
      ('ac000000-0000-4000-8000-000000000006', 'ac000000-0000-4000-8000-000000000002', '${ids.eventB}', '${ids.userB}', '2026-09-02', 'pending');

    insert into public.vendor_bookings (
      id, vendor_id, event_id, organizer_id, booking_date, status
    ) values
      ('ac000000-0000-4000-8000-000000000007', 'ac000000-0000-4000-8000-000000000003', '${ids.eventA}', '${ids.userA}', '2026-09-01', 'confirmed'),
      ('ac000000-0000-4000-8000-000000000008', 'ac000000-0000-4000-8000-000000000004', '${ids.eventB}', '${ids.userB}', '2026-09-02', 'confirmed');

    insert into public.agent_actions (id, plan_id, action_type, description, status)
    values
      ('${ids.actionA}', '${ids.planA}', 'hold_request', 'Control Plane Action A', 'pending'),
      ('${ids.actionB}', '${ids.planB}', 'hold_request', 'Control Plane Action B', 'pending');

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, status, requested_amount_cents, snapshot_hash
    ) values
      ('${ids.approvalA}', '${ids.planA}', '${ids.actionA}', 'Approve action A', 'pending', 1000, 'snapshot-a'),
      ('${ids.approvalB}', '${ids.planB}', '${ids.actionB}', 'Approve action B', 'pending', 1000, 'snapshot-b');

    insert into public.settlement_runs (
      id, event_id, organizer_id, venue_id, archetype, venue_type,
      neighborhood, scheduled_settle_at, status
    ) values
      (
        'ac000000-0000-4000-8000-000000000009', '${ids.eventA}', '${ids.userA}',
        'ac000000-0000-4000-8000-000000000001', 'community_social', 'gallery',
        'Mission', now() + interval '1 day', 'pending'
      ),
      (
        'ac000000-0000-4000-8000-00000000000a', '${ids.eventB}', '${ids.userB}',
        'ac000000-0000-4000-8000-000000000002', 'community_social', 'gallery',
        'Mission', now() + interval '1 day', 'pending'
      );

    insert into public.agent_actions (
      id, plan_id, action_type, description, status
    ) values
      ('ac000000-0000-4000-8000-00000000000b', '${ids.planA}', 'payment', 'Settlement action A', 'approved'),
      ('ac000000-0000-4000-8000-00000000000c', '${ids.planB}', 'payment', 'Settlement action B', 'approved');

    insert into public.approvals (
      id, plan_id, agent_action_id, action_label, status,
      requested_amount_cents, authorized_amount_cents,
      authorized_by, authorized_at, snapshot_hash,
      approval_type, settlement_run_id
    ) values
      (
        'ac000000-0000-4000-8000-00000000000d', '${ids.planA}',
        'ac000000-0000-4000-8000-00000000000b', 'Settlement approval A', 'authorized',
        1000, 1000, '${ids.userA}', now(), 'settlement-snapshot-a',
        'chi_settlement', 'ac000000-0000-4000-8000-000000000009'
      ),
      (
        'ac000000-0000-4000-8000-00000000000e', '${ids.planB}',
        'ac000000-0000-4000-8000-00000000000c', 'Settlement approval B', 'authorized',
        1000, 1000, '${ids.userB}', now(), 'settlement-snapshot-b',
        'chi_settlement', 'ac000000-0000-4000-8000-00000000000a'
      );

    update public.agent_actions
    set approval_id = case id
      when '${ids.actionA}' then '${ids.approvalA}'::uuid
      when '${ids.actionB}' then '${ids.approvalB}'::uuid
      when 'ac000000-0000-4000-8000-00000000000b' then 'ac000000-0000-4000-8000-00000000000d'::uuid
      when 'ac000000-0000-4000-8000-00000000000c' then 'ac000000-0000-4000-8000-00000000000e'::uuid
    end
    where id in (
      '${ids.actionA}', '${ids.actionB}',
      'ac000000-0000-4000-8000-00000000000b',
      'ac000000-0000-4000-8000-00000000000c'
    );

    insert into public.agent_authorizations (user_id, plan_id)
    values
      ('${ids.userA}', '${ids.planA}'),
      ('${ids.userB}', '${ids.planB}');

    insert into public.payment_intents (
      plan_id, approval_id, partner_kind, partner_id, amount_cents, status
    ) values
      ('${ids.planA}', '${ids.approvalA}', 'venue', 'ac000000-0000-4000-8000-000000000001', 1000, 'failed'),
      ('${ids.planB}', '${ids.approvalB}', 'venue', 'ac000000-0000-4000-8000-000000000002', 1000, 'failed');

    insert into public.plan_messages (id, plan_id, role, content)
    values
      ('${ids.messageA}', '${ids.planA}', 'user', 'Owner A message'),
      ('${ids.messageB}', '${ids.planB}', 'user', 'Owner B message');

    insert into public.plan_derived_state (plan_id)
    values ('${ids.planA}'), ('${ids.planB}');

    insert into public.plan_versions (plan_id, version_number, snapshot, changed_by)
    values
      ('${ids.planA}', 1, '{}'::jsonb, '${ids.userA}'),
      ('${ids.planB}', 1, '{}'::jsonb, '${ids.userB}');

    insert into public.plan_revisions (
      plan_id, triggered_by_user_id, trigger_type, trigger_payload, impact_summary
    ) values
      ('${ids.planA}', '${ids.userA}', 'budget_change', '{}'::jsonb, '{}'::jsonb),
      ('${ids.planB}', '${ids.userB}', 'budget_change', '{}'::jsonb, '{}'::jsonb);

    insert into public.planner_plan_updates (plan_id, field, old_value, new_value)
    values
      ('${ids.planA}', 'budget_cap_cents', '1000'::jsonb, '2000'::jsonb),
      ('${ids.planB}', 'budget_cap_cents', '1000'::jsonb, '2000'::jsonb);

    insert into public.plan_activity (plan_id, kind, summary)
    values
      ('${ids.planA}', 'system', 'Activity A'),
      ('${ids.planB}', 'system', 'Activity B');

    insert into public.audit_logs (user_id, plan_id, action, entity_type)
    values
      ('${ids.userA}', '${ids.planA}', 'control_plane.a', 'plan'),
      ('${ids.userB}', '${ids.planB}', 'control_plane.b', 'plan');

    insert into public.agent_action_audit_log (
      action_id, plan_id, to_status, actor_id, reason
    ) values
      ('${ids.actionA}', '${ids.planA}', 'pending', '${ids.userA}', 'control_plane.a'),
      ('${ids.actionB}', '${ids.planB}', 'pending', '${ids.userB}', 'control_plane.b');

    insert into public.agent_runs (user_id, plan_id, agent_name, status)
    values
      ('${ids.userA}', '${ids.planA}', 'control-plane', 'succeeded'),
      ('${ids.userB}', '${ids.planB}', 'control-plane', 'succeeded');

    insert into public.venue_booking_approval_audit (
      venue_id, booking_id, actor_id, action, previous_status, new_status
    ) values
      (
        'ac000000-0000-4000-8000-000000000001',
        'ac000000-0000-4000-8000-000000000005',
        '${ids.userA}', 'bulk_approve', 'pending', 'confirmed'
      ),
      (
        'ac000000-0000-4000-8000-000000000002',
        'ac000000-0000-4000-8000-000000000006',
        '${ids.userB}', 'bulk_approve', 'pending', 'confirmed'
      );

    insert into public.outreach_threads (
      id, plan_id, user_id, target_type, target_name, target_email
    ) values
      ('${ids.outreachA}', '${ids.planA}', '${ids.userA}', 'venue', 'Venue A', 'venue-a@example.com'),
      ('${ids.outreachB}', '${ids.planB}', '${ids.userB}', 'venue', 'Venue B', 'venue-b@example.com');

    insert into public.outreach_messages (
      thread_id, agent_action_id, approval_id, direction, subject, body_text
    ) values
      ('${ids.outreachA}', '${ids.actionA}', '${ids.approvalA}', 'outbound', 'Subject A', 'Body A'),
      ('${ids.outreachB}', '${ids.actionB}', '${ids.approvalB}', 'outbound', 'Subject B', 'Body B');

    insert into public.creator_outreach_policies (user_id, version)
    values ('${ids.userA}', 1), ('${ids.userB}', 1);

    insert into public.venue_opportunity_briefs (
      id, plan_id, organizer_user_id, title
    ) values
      ('${ids.venueBriefA}', '${ids.planA}', '${ids.userA}', 'Venue brief A'),
      ('${ids.venueBriefB}', '${ids.planB}', '${ids.userB}', 'Venue brief B');

    insert into public.venue_opportunity_invites (
      opportunity_id, brief_id, target_type, status
    ) values
      ('${ids.venueBriefA}', '${ids.venueBriefA}', 'concierge', 'queued'),
      ('${ids.venueBriefB}', '${ids.venueBriefB}', 'concierge', 'queued');

    insert into public.vendor_opportunity_briefs (
      id, plan_id, organizer_user_id, package_type, summary
    ) values
      ('${ids.vendorBriefA}', '${ids.planA}', '${ids.userA}', 'catering', 'Vendor brief A'),
      ('${ids.vendorBriefB}', '${ids.planB}', '${ids.userB}', 'catering', 'Vendor brief B');

    insert into public.vendor_opportunity_invites (brief_id, vendor_id, status)
    values
      ('${ids.vendorBriefA}', 'ac000000-0000-4000-8000-000000000003', 'queued'),
      ('${ids.vendorBriefB}', 'ac000000-0000-4000-8000-000000000004', 'queued');

    insert into public.vendor_transactions (
      booking_id, vendor_id, builder_id,
      amount, platform_fee, stripe_fee, vendor_payout,
      amount_cents, platform_fee_cents, stripe_fee_cents, vendor_payout_cents,
      payment_type, status
    ) values
      (
        'ac000000-0000-4000-8000-000000000007',
        'ac000000-0000-4000-8000-000000000003', '${ids.builderA}',
        10, 1, 0, 9, 1000, 100, 0, 900, 'deposit', 'failed'
      ),
      (
        'ac000000-0000-4000-8000-000000000008',
        'ac000000-0000-4000-8000-000000000004', '${ids.builderB}',
        10, 1, 0, 9, 1000, 100, 0, 900, 'deposit', 'failed'
      );

    insert into public.platform_fee_transactions (
      builder_id, booking_id, amount, amount_cents, fee_type, status
    ) values
      ('${ids.builderA}', 'ac000000-0000-4000-8000-000000000007', 10, 1000, 'per_event', 'failed'),
      ('${ids.builderB}', 'ac000000-0000-4000-8000-000000000008', 10, 1000, 'per_event', 'failed');

    insert into public.settlement_charges (
      settlement_run_id, approval_id, organizer_id, venue_id,
      amount_cents, platform_fee_cents, organizer_payout_cents, status
    ) values
      (
        'ac000000-0000-4000-8000-000000000009',
        'ac000000-0000-4000-8000-00000000000d', '${ids.userA}',
        'ac000000-0000-4000-8000-000000000001', 1000, 0, 1000, 'checkout_created'
      ),
      (
        'ac000000-0000-4000-8000-00000000000a',
        'ac000000-0000-4000-8000-00000000000e', '${ids.userB}',
        'ac000000-0000-4000-8000-000000000002', 1000, 0, 1000, 'checkout_created'
      );

    insert into public.admin_tasks (plan_id, task_type, description)
    values
      ('${ids.planA}', 'concierge_booking', 'Internal task A'),
      ('${ids.planB}', 'concierge_booking', 'Internal task B');
  `
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('server-owned execution control plane', () => {
  describe('realized ACL classification', () => {
    it.each(ownerReadableTables)('%s grants authenticated SELECT but no DML', (table) => {
      expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'SELECT');`)).toBe('t')
      expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'INSERT,UPDATE,DELETE');`)).toBe('f')
      expect(psql(`select has_table_privilege('anon', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE');`)).toBe('f')
      expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE');`)).toBe('t')
    })

    it.each(serviceOnlyTables)('%s is inaccessible to browser roles', (table) => {
      expect(psql(`select has_table_privilege('authenticated', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE');`)).toBe('f')
      expect(psql(`select has_table_privilege('anon', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE');`)).toBe('f')
      expect(psql(`select has_table_privilege('service_role', 'public.${table}', 'SELECT,INSERT,UPDATE,DELETE');`)).toBe('t')
    })

    it('has no browser mutation policy on any trusted table', () => {
      const unsafePolicies = psql(`
        select tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',')
        from pg_policies
        where schemaname = 'public'
          and tablename = any(array[${trustedTables.map((table) => `'${table}'`).join(',')}])
          and cmd <> 'SELECT'
          and (
            not ('service_role' = any(roles))
            or cardinality(roles) <> 1
          )
        order by tablename, policyname;
      `)

      expect(unsafePolicies).toBe('')
    })

    it('keeps both invariant trigger functions SECURITY INVOKER', () => {
      expect(psql(`
        select string_agg(proname || '|' || prosecdef::text, ',' order by proname)
        from pg_proc
        where pronamespace = 'public'::regnamespace
          and proname in (
            'enforce_agent_action_approval_consistency',
            'enforce_approval_execution_invariants'
          );
      `)).toBe(
        'enforce_agent_action_approval_consistency|false,enforce_approval_execution_invariants|false',
      )
    })
  })

  describe('direct PostgREST mutation denial', () => {
    it.each(trustedTables)('%s rejects authenticated INSERT, UPDATE, and DELETE', async (table) => {
      await expectPostgrestPermissionDenied(table, 'POST')
      await expectPostgrestPermissionDenied(table, 'PATCH')
      await expectPostgrestPermissionDenied(table, 'DELETE')
    })

    it('does not expose admin task internal columns to a plan owner', async () => {
      const response = await postgrest('admin_tasks', 'GET')
      const body = await response.text()
      expect(response.status).toBe(403)
      expect(body).toMatch(/permission denied for table admin_tasks/i)
    })
  })

  describe('owner-scoped reads', () => {
    it('shows exactly one owned row and hides the unrelated row for every retained SELECT class', () => {
      const tableCounts = ownerReadableTables
        .map((table) => `(select count(*) from public.${table})`)
        .join(',')
      const result = transaction(asRole('authenticated', ids.userA, `
        select concat_ws('|', ${tableCounts});
      `))

      const expectedCounts = ownerReadableTables.map((table) => (
        table === 'agent_actions' || table === 'approvals' ? '2' : '1'
      ))
      expect(result.split('|')).toEqual(expectedCounts)
    })

    it('denies direct base-table reads of internal admin tasks', () => {
      expectTransactionError(
        asRole('authenticated', ids.userA, 'select * from public.admin_tasks;'),
        /permission denied for table admin_tasks/i,
      )
    })
  })

  describe('database impossible-state guards', () => {
    it('rejects a second active approval for one action', () => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.approvals (
          plan_id, agent_action_id, action_label, status, requested_amount_cents, snapshot_hash
        ) values (
          '${ids.planA}', '${ids.actionA}', 'Duplicate approval', 'pending', 1000, 'snapshot-duplicate'
        );
      `), /approvals_one_active_per_action/i)
    })

    it('rejects an approval whose plan differs from its action', () => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.agent_actions (
          id, plan_id, action_type, description, status
        ) values (
          'ab000000-0000-4000-8000-000000000001', '${ids.planA}',
          'hold_request', 'Cross-plan action', 'pending'
        );
        insert into public.approvals (
          plan_id, agent_action_id, action_label, status, requested_amount_cents, snapshot_hash
        ) values (
          '${ids.planB}', 'ab000000-0000-4000-8000-000000000001',
          'Cross-plan approval', 'pending', 1000, 'snapshot-cross-plan'
        );
      `), /approvals_action_plan_consistency_fkey/i)
    })

    it('rejects an authorization above the requested amount', () => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.agent_actions (
          id, plan_id, action_type, description, status
        ) values (
          'ab000000-0000-4000-8000-000000000002', '${ids.planA}',
          'hold_request', 'Amount guard action', 'pending'
        );
        insert into public.approvals (
          plan_id, agent_action_id, action_label, status,
          requested_amount_cents, authorized_amount_cents, snapshot_hash
        ) values (
          '${ids.planA}', 'ab000000-0000-4000-8000-000000000002',
          'Amount guard approval', 'pending', 1000, 1001, 'snapshot-amount'
        );
      `), /approvals_authorized_not_above_requested_check/i)
    })

    it.each([
      [
        'approved without snapshot',
        `'approved', '${ids.userA}', now(), null, now() + interval '1 hour'`,
        /approval_executable_requires_snapshot_hash/i,
      ],
      [
        'authorized without actor',
        `'authorized', null, now(), 'snapshot-actor', now() + interval '1 hour'`,
        /approval_executable_requires_actor_and_timestamp/i,
      ],
      [
        'authorized without timestamp',
        `'authorized', '${ids.userA}', null, 'snapshot-time', now() + interval '1 hour'`,
        /approval_executable_requires_actor_and_timestamp/i,
      ],
      [
        'expired authorized approval',
        `'authorized', '${ids.userA}', now(), 'snapshot-expired', now() - interval '1 second'`,
        /approval_executable_cannot_be_expired/i,
      ],
    ])('rejects %s', (_label, executableValues, expectedError) => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.agent_actions (
          id, plan_id, action_type, description, status
        ) values (
          'ab000000-0000-4000-8000-000000000003', '${ids.planA}',
          'hold_request', 'Executable guard action', 'pending'
        );
        insert into public.approvals (
          plan_id, agent_action_id, action_label,
          status, authorized_by, authorized_at, snapshot_hash, expires_at,
          requested_amount_cents, authorized_amount_cents
        ) values (
          '${ids.planA}', 'ab000000-0000-4000-8000-000000000003',
          'Executable guard approval', ${executableValues}, 1000, 1000
        );
      `), expectedError)
    })

    it('rejects an action pointer to another action approval', () => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.agent_actions (
          id, plan_id, action_type, description, status
        ) values (
          'ab000000-0000-4000-8000-000000000004', '${ids.planA}',
          'hold_request', 'Reciprocal guard action', 'pending'
        );
        update public.agent_actions
        set approval_id = '${ids.approvalA}'
        where id = 'ab000000-0000-4000-8000-000000000004';
      `), /agent_action_approval_pointer_mismatch/i)
    })

    it('rejects a payment intent linked to an approval from another plan', () => {
      expectTransactionError(asRole('service_role', null, `
        insert into public.payment_intents (
          plan_id, approval_id, partner_kind, partner_id,
          amount_cents, currency, status
        ) values (
          '${ids.planB}', '${ids.approvalA}', 'venue',
          'ab000000-0000-4000-8000-000000000005', 1000, 'usd', 'failed'
        );
      `), /payment_intents_approval_plan_consistency_fkey/i)
    })

    it('rejects a settlement charge linked to another settlement run approval', () => {
      expectTransactionError(asRole('service_role', null, `
        update public.settlement_charges
        set approval_id = 'ac000000-0000-4000-8000-00000000000d'
        where settlement_run_id = 'ac000000-0000-4000-8000-00000000000a';
      `), /settlement_charges_approval_run_consistency_fkey/i)
    })

    it('accepts a complete executable approval and matching reciprocal pointer', () => {
      const result = transaction(asRole('service_role', null, `
        insert into public.agent_actions (
          id, plan_id, action_type, description, status
        ) values (
          'ab000000-0000-4000-8000-00000000000c', '${ids.planA}',
          'hold_request', 'Valid executable action', 'pending'
        );

        insert into public.approvals (
          id, plan_id, agent_action_id, action_label, status,
          requested_amount_cents, authorized_amount_cents,
          authorized_by, authorized_at, snapshot_hash, expires_at
        ) values (
          'ab000000-0000-4000-8000-00000000000d', '${ids.planA}',
          'ab000000-0000-4000-8000-00000000000c', 'Valid executable approval',
          'approved', 1000, 1000, '${ids.userA}', now(),
          'snapshot-valid', now() + interval '1 hour'
        );

        update public.agent_actions
        set approval_id = 'ab000000-0000-4000-8000-00000000000d'
        where id = 'ab000000-0000-4000-8000-00000000000c';

        select action.approval_id || '|' || approval.status
        from public.agent_actions action
        join public.approvals approval on approval.id = action.approval_id
        where action.id = 'ab000000-0000-4000-8000-00000000000c';
      `))

      expect(result).toBe('ab000000-0000-4000-8000-00000000000d|approved')
    })
  })
})
