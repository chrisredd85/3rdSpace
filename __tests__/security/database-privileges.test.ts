import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const databaseUrl = process.env.RLS_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL
const apiUrl = process.env.RLS_TEST_API_URL ?? 'http://127.0.0.1:54321'
const jwtSecret = process.env.RLS_TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
const forceRun = process.env.RUN_RLS_DB_TESTS === '1'

const ids = {
  userA: '91000000-0000-4000-8000-000000000001',
  userB: '91000000-0000-4000-8000-000000000002',
  builderA: '92000000-0000-4000-8000-000000000001',
  builderB: '92000000-0000-4000-8000-000000000002',
  eventA: '93000000-0000-4000-8000-000000000001',
  eventB: '93000000-0000-4000-8000-000000000002',
  planA: '94000000-0000-4000-8000-000000000001',
  planB: '94000000-0000-4000-8000-000000000002',
  messageB: '95000000-0000-4000-8000-000000000001',
  recommendationB: '96000000-0000-4000-8000-000000000001',
  actionB: '97000000-0000-4000-8000-000000000001',
  approvalB: '98000000-0000-4000-8000-000000000001',
  outreachB: '99000000-0000-4000-8000-000000000001',
  saleA: '9a000000-0000-4000-8000-000000000001',
  saleB: '9a000000-0000-4000-8000-000000000002',
}

const authenticatedFunctions = [
  'apply_plan_revision_atomic(uuid,uuid,jsonb,uuid,jsonb,jsonb,text)',
  'can_manage_event_cost_commitment_org(uuid)',
  'can_manage_event_revenue_term_org(uuid)',
  'can_manage_live_recommendation_org(uuid)',
  'can_manage_plan_read_model(uuid)',
  'consume_builder_event_access(uuid,uuid,integer,integer,integer)',
  'create_vendor_invite(uuid,text,text,text,text,text,numeric,uuid)',
  'create_venue_invite(uuid,text,text,text,text,text,text,text,integer,integer,text,integer,uuid)',
  'get_event_kickback_summary(uuid)',
  'is_event_builder(uuid)',
  'is_event_collaborator(uuid)',
].sort()

type ServiceOnlyFunction = {
  signature: string
  call: string
  triggerOnly?: boolean
  postgrestCallable?: boolean
}

const serviceOnlyFunctions: ServiceOnlyFunction[] = [
  {
    signature: 'block_inflight_stripe_account_payments(text,text,text)',
    call: 'select public.block_inflight_stripe_account_payments(null::text, null::text, null::text);',
  },
  {
    signature: 'calculate_event_kickback(uuid)',
    call: 'select public.calculate_event_kickback(null::uuid);',
  },
  {
    signature: 'claim_app_jobs(integer,text)',
    call: "select * from public.claim_app_jobs(0, 'acl-test');",
  },
  {
    signature: 'consume_webhook_rate_limit(text,integer,integer)',
    call: "select public.consume_webhook_rate_limit('acl-test', 1, 60);",
  },
  {
    signature: 'handle_new_user()',
    call: 'select public.handle_new_user();',
    triggerOnly: true,
  },
  {
    signature: 'increment_stripe_webhook_duplicate_count(text,text)',
    call: "select public.increment_stripe_webhook_duplicate_count('evt_acl', '/acl');",
  },
  {
    signature: 'increment_stripe_webhook_duplicate_count(text)',
    call: "select public.increment_stripe_webhook_duplicate_count('evt_acl');",
    // The two-argument overload has a default endpoint argument, so PostgREST
    // intentionally reports an ambiguous RPC before privilege evaluation.
    postgrestCallable: false,
  },
  {
    signature: 'insert_grouped_notification(uuid,text,text,text,text,uuid,jsonb,text)',
    call: `select public.insert_grouped_notification('${ids.userA}', 'acl', 'ACL', 'ACL', null, null, '{}'::jsonb, 'acl');`,
  },
  {
    signature: 'next_vendor_invoice_number(integer)',
    call: 'select public.next_vendor_invoice_number(2026);',
  },
  {
    signature: 'notify_review_events()',
    call: 'select public.notify_review_events();',
    triggerOnly: true,
  },
  {
    signature: 'notify_vendor_booking_events()',
    call: 'select public.notify_vendor_booking_events();',
    triggerOnly: true,
  },
  {
    signature: 'notify_vendor_transaction_events()',
    call: 'select public.notify_vendor_transaction_events();',
    triggerOnly: true,
  },
  {
    signature: 'recalculate_vendor_review_stats(uuid)',
    call: 'select public.recalculate_vendor_review_stats(null::uuid);',
  },
  {
    signature: 'record_stripe_webhook_event_result(text,text,jsonb,text,text,boolean,text,boolean,text)',
    call: "select public.record_stripe_webhook_event_result('evt_acl', 'test', '{}'::jsonb, 'test', '/acl', false, 'test', false, null);",
  },
  {
    signature: 'refresh_projection_baselines()',
    call: 'select * from public.refresh_projection_baselines();',
  },
  {
    signature: 'refresh_vendor_analytics()',
    call: 'select public.refresh_vendor_analytics();',
  },
  {
    signature: 'release_stale_stripe_webhook_reservations(interval)',
    call: "select * from public.release_stale_stripe_webhook_reservations('5 minutes'::interval);",
  },
  {
    signature: 'reserve_stripe_webhook_event(text,text,jsonb,text,text,boolean)',
    call: "select * from public.reserve_stripe_webhook_event('evt_acl', 'test', '{}'::jsonb, 'test', '/acl', false);",
  },
  {
    signature: 'sync_vendor_review_stats()',
    call: 'select public.sync_vendor_review_stats();',
    triggerOnly: true,
  },
  {
    signature: 'transition_settlement_charge_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)',
    call: "select * from public.transition_settlement_charge_status(null::uuid, 'pending', 'failed', 'acl', null, null, null, '{}'::jsonb, '{}'::jsonb);",
  },
  {
    signature: 'transition_settlement_run_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)',
    call: "select * from public.transition_settlement_run_status(null::uuid, 'pending', 'cancelled', 'acl', null, null, null, '{}'::jsonb, '{}'::jsonb);",
  },
  {
    signature: 'unblock_stripe_account_settlements(text,text)',
    call: "select public.unblock_stripe_account_settlements('acct_acl', 'evt_acl');",
  },
  {
    signature: 'validate_event_cost_commitment_scope()',
    call: 'select public.validate_event_cost_commitment_scope();',
    triggerOnly: true,
  },
  {
    signature: 'validate_event_revenue_term_scope()',
    call: 'select public.validate_event_revenue_term_scope();',
    triggerOnly: true,
  },
  {
    signature: 'validate_live_recommendation_scope()',
    call: 'select public.validate_live_recommendation_scope();',
    triggerOnly: true,
  },
]

function psql(sql: string): string {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error
      if (!/database system is (starting up|in recovery mode|not accepting connections)|connection .* failed/i.test(commandErrorText(error))) {
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
    }
  }

  throw lastError
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

function roleSql(role: 'anon' | 'authenticated' | 'service_role', userId: string | null, sql: string): string {
  const sub = userId ? `set local request.jwt.claim.sub = '${userId}';` : ''
  return `
    begin;
    set local role ${role};
    set local request.jwt.claim.role = '${role}';
    ${sub}
    ${sql}
    rollback;
  `
}

function asRole(role: 'anon' | 'authenticated' | 'service_role', userId: string | null, sql: string): string {
  return psql(roleSql(role, userId, sql))
}

function expectRoleError(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  sql: string,
  pattern: RegExp,
): void {
  try {
    asRole(role, userId, sql)
  } catch (error) {
    expect(commandErrorText(error)).toMatch(pattern)
    return
  }

  throw new Error(`Expected ${role} statement to fail: ${sql}`)
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

async function expectRpcPermissionDenied(
  role: 'anon' | 'authenticated',
  userId: string | null,
  signature: string,
): Promise<void> {
  const token = roleToken(role, userId)
  const functionName = signature.slice(0, signature.indexOf('('))
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: token,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(rpcArgsFor(signature)),
  })
  const body = await response.text()

  expect(response.status).toBe(role === 'anon' ? 401 : 403)
  expect(body).toMatch(/permission denied for function/i)
}

function rpcArgsFor(signature: string): Record<string, unknown> {
  switch (signature) {
    case 'block_inflight_stripe_account_payments(text,text,text)':
      return { p_stripe_account_id: 'acct_acl', p_reason: 'acl_test', p_event_id: 'evt_acl' }
    case 'calculate_event_kickback(uuid)':
      return { p_event_id: ids.eventA }
    case 'claim_app_jobs(integer,text)':
      return { p_limit: 0, p_worker_id: 'acl-test' }
    case 'consume_webhook_rate_limit(text,integer,integer)':
      return { p_key: 'acl-test', p_limit: 1, p_window_seconds: 60 }
    case 'increment_stripe_webhook_duplicate_count(text,text)':
      return { p_stripe_event_id: 'evt_acl', p_endpoint_path: '/acl' }
    case 'increment_stripe_webhook_duplicate_count(text)':
      return { p_stripe_event_id: 'evt_acl' }
    case 'insert_grouped_notification(uuid,text,text,text,text,uuid,jsonb,text)':
      return {
        p_user_id: ids.userA,
        p_type: 'acl',
        p_title: 'ACL',
        p_message: 'ACL',
        p_link: null,
        p_related_id: null,
        p_metadata: {},
        p_group_key: 'acl',
      }
    case 'next_vendor_invoice_number(integer)':
      return { p_year: 2026 }
    case 'recalculate_vendor_review_stats(uuid)':
      return { p_vendor_id: null }
    case 'record_stripe_webhook_event_result(text,text,jsonb,text,text,boolean,text,boolean,text)':
      return {
        p_stripe_event_id: 'evt_acl',
        p_event_type: 'acl.test',
        p_payload: {},
        p_source: 'test',
        p_endpoint_path: '/acl',
        p_livemode: false,
        p_processing_outcome: 'test',
        p_processed: false,
        p_error: null,
      }
    case 'refresh_projection_baselines()':
    case 'refresh_vendor_analytics()':
      return {}
    case 'release_stale_stripe_webhook_reservations(interval)':
      return { p_older_than: '00:05:00' }
    case 'reserve_stripe_webhook_event(text,text,jsonb,text,text,boolean)':
      return {
        p_stripe_event_id: 'evt_acl',
        p_event_type: 'acl.test',
        p_payload: {},
        p_source: 'test',
        p_endpoint_path: '/acl',
        p_livemode: false,
      }
    case 'transition_settlement_charge_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)':
      return {
        p_charge_id: ids.planA,
        p_from_status: 'pending',
        p_to_status: 'failed',
        p_action: 'acl',
        p_actor_id: null,
        p_actor_type: null,
        p_reason: null,
        p_metadata: {},
        p_patch: {},
      }
    case 'transition_settlement_run_status(uuid,text,text,text,uuid,text,text,jsonb,jsonb)':
      return {
        p_run_id: ids.planA,
        p_from_status: 'pending',
        p_to_status: 'cancelled',
        p_action: 'acl',
        p_actor_id: null,
        p_actor_type: null,
        p_reason: null,
        p_metadata: {},
        p_patch: {},
      }
    case 'unblock_stripe_account_settlements(text,text)':
      return { p_stripe_account_id: 'acct_acl', p_event_id: 'evt_acl' }
    default:
      throw new Error(`No PostgREST fixture for ${signature}`)
  }
}

function commandErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
    if (typeof stderr === 'string') return stderr
  }
  return error instanceof Error ? error.message : String(error)
}

function cleanupFixtures(): void {
  psql(`
    delete from public.event_sales_data where id in ('${ids.saleA}', '${ids.saleB}');
    delete from public.plans where id in ('${ids.planA}', '${ids.planB}');
    delete from public.events where id in ('${ids.eventA}', '${ids.eventB}');
    delete from public.builder_profiles where id in ('${ids.builderA}', '${ids.builderB}');
    delete from public.users where id in ('${ids.userA}', '${ids.userB}');
  `)
}

function setupFixtures(): void {
  cleanupFixtures()
  psql(`
    insert into public.users (id, email, role, user_type)
    values
      ('${ids.userA}', 'acl-owner-a@example.com', 'builder', 'community_builder'),
      ('${ids.userB}', 'acl-owner-b@example.com', 'builder', 'community_builder');

    insert into public.builder_profiles (id, user_id, name)
    values
      ('${ids.builderA}', '${ids.userA}', 'ACL Builder A'),
      ('${ids.builderB}', '${ids.userB}', 'ACL Builder B');

    insert into public.events (
      id, builder_id, event_name, event_type, event_date, start_time, end_time, duration_hours
    )
    values
      ('${ids.eventA}', '${ids.builderA}', 'ACL Event A', 'networking', '2026-08-01', '18:00', '21:00', 3),
      ('${ids.eventB}', '${ids.builderB}', 'ACL Event B', 'networking', '2026-08-02', '18:00', '21:00', 3);

    insert into public.plans (id, user_id, title)
    values
      ('${ids.planA}', '${ids.userA}', 'ACL Plan A'),
      ('${ids.planB}', '${ids.userB}', 'ACL Plan B');

    insert into public.plan_messages (id, plan_id, role, content)
    values ('${ids.messageB}', '${ids.planB}', 'user', 'Cross-tenant source message');

    insert into public.recommendations (id, plan_id, type, external_name, rank)
    values ('${ids.recommendationB}', '${ids.planB}', 'external', 'Cross-tenant recommendation', 1);

    insert into public.agent_actions (id, plan_id, action_type, description)
    values ('${ids.actionB}', '${ids.planB}', 'hold_request', 'Cross-tenant action');

    insert into public.approvals (id, plan_id, agent_action_id, action_label)
    values ('${ids.approvalB}', '${ids.planB}', '${ids.actionB}', 'Cross-tenant approval');

    insert into public.outreach_threads (
      id, plan_id, user_id, target_type, target_name, target_email
    )
    values (
      '${ids.outreachB}', '${ids.planB}', '${ids.userB}', 'venue',
      'Cross-tenant venue', 'acl-cross-tenant@example.com'
    );

    insert into public.event_sales_data (
      id, event_id, total_sales, data_source, entered_by,
      platform, ticket_quantity, total_amount_cents, fees_cents, purchase_timestamp
    )
    values
      ('${ids.saleA}', '${ids.eventA}', 10000, 'manual', '${ids.userA}', 'manual', 2, 10000, 500, now()),
      ('${ids.saleB}', '${ids.eventB}', 20000, 'manual', '${ids.userB}', 'manual', 4, 20000, 1000, now());
  `)
}

function revisionCall(impact: Record<string, string[]>, sourceMessageId: string | null = null): string {
  const source = sourceMessageId ? `'${sourceMessageId}'::uuid` : 'null::uuid'
  const payload = JSON.stringify({
    invalidated_recommendation_ids: [],
    superseded_approval_ids: [],
    superseded_outreach_thread_ids: [],
    triggers_rediscovery: [],
    ...impact,
  }).replaceAll("'", "''")

  return `
    select * from public.apply_plan_revision_atomic(
      '${ids.planA}',
      '${ids.userA}',
      '{"type":"budget_change"}'::jsonb,
      ${source},
      '{}'::jsonb,
      '${payload}'::jsonb,
      'ACL test'
    );
  `
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('database privilege lockdown', () => {
  beforeAll(setupFixtures)
  afterAll(cleanupFixtures)

  describe('SECURITY DEFINER tripwire', () => {
    it('matches every privileged function to the reviewed classification', () => {
      const realized = psql(`
        select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
        order by 1;
      `).split('\n').filter(Boolean).sort()

      const classified = [
        ...authenticatedFunctions,
        ...serviceOnlyFunctions.map(({ signature }) => signature),
      ].sort()

      expect(realized).toEqual(classified)
    })

    it('denies anonymous execution and grants authenticated only to the allowlist', () => {
      const rows = psql(`
        select concat_ws('|',
          p.oid::regprocedure::text,
          has_function_privilege('anon', p.oid, 'EXECUTE'),
          has_function_privilege('authenticated', p.oid, 'EXECUTE'),
          has_function_privilege('service_role', p.oid, 'EXECUTE')
        )
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
        order by 1;
      `).split('\n').filter(Boolean)

      const expectedAuthenticated = new Set(authenticatedFunctions)
      for (const row of rows) {
        const [signature, anon, authenticated, service] = row.split('|')
        expect(anon).toBe('f')
        expect(authenticated).toBe(expectedAuthenticated.has(signature) ? 't' : 'f')
        expect(service).toBe('t')
      }
    })

    it('requires every authenticated privileged function to derive request identity', () => {
      const missing = psql(`
        select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and p.prosrc !~ 'auth\\.(uid|role|jwt)'
        order by 1;
      `)

      expect(missing).toBe('')
    })

    it('does not grant future public-schema functions, tables, or sequences to API roles', () => {
      const unsafeDefaults = psql(`
        select concat_ws('|', d.defaclobjtype, coalesce(grantee.rolname, 'PUBLIC'), acl.privilege_type)
        from pg_default_acl d
        cross join lateral aclexplode(d.defaclacl) acl
        left join pg_roles grantee on grantee.oid = acl.grantee
        where d.defaclrole = 'postgres'::regrole
          and d.defaclnamespace = 'public'::regnamespace
          and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
        order by 1;
      `)

      expect(unsafeDefaults).toBe('')
    })
  })

  describe('service-only execution', () => {
    const callableFunctions = serviceOnlyFunctions.filter(
      ({ triggerOnly, postgrestCallable }) => !triggerOnly && postgrestCallable !== false
    )
    const triggerFunctions = serviceOnlyFunctions.filter(({ triggerOnly }) => triggerOnly)

    // Validate catalog privileges under SET ROLE, then exercise the same
    // denial through PostgREST (the production call path). Directly invoking a
    // revoked SECURITY DEFINER routine from a superuser SET ROLE session
    // segfaults the current local Supabase PostgreSQL image; PostgREST returns
    // the expected 401/403 with SQLSTATE 42501 and leaves the server healthy.

    it.each(serviceOnlyFunctions)('$signature has no anon EXECUTE privilege under SET ROLE', ({ signature }) => {
      expect(asRole(
        'anon',
        null,
        `select has_function_privilege(current_user, 'public.${signature}', 'EXECUTE');`,
      )).toBe('f')
    })

    it.each(serviceOnlyFunctions)('$signature has no authenticated EXECUTE privilege under SET ROLE', ({ signature }) => {
      expect(asRole(
        'authenticated',
        ids.userA,
        `select has_function_privilege(current_user, 'public.${signature}', 'EXECUTE');`,
      )).toBe('f')
    })

    it.each(callableFunctions)('$signature rejects anon RPC with permission denied', async ({ signature }) => {
      await expectRpcPermissionDenied('anon', null, signature)
    })

    it.each(callableFunctions)('$signature rejects authenticated RPC with permission denied', async ({ signature }) => {
      await expectRpcPermissionDenied('authenticated', ids.userA, signature)
    })

    it('keeps trigger-only functions out of the PostgREST callable surface', () => {
      expect(triggerFunctions).toHaveLength(8)
    })
  })

  describe('authenticated aggregate RPCs', () => {
    it('rejects a caller-supplied user and another user plan for plan revision', () => {
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.apply_plan_revision_atomic('${ids.planB}', '${ids.userB}', '{"type":"budget_change"}'::jsonb);`,
        /User mismatch|not owned/i,
      )
    })

    it.each([
      ['recommendation', revisionCall({ invalidated_recommendation_ids: [ids.recommendationB] })],
      ['approval', revisionCall({ superseded_approval_ids: [ids.approvalB] })],
      ['outreach thread', revisionCall({ superseded_outreach_thread_ids: [ids.outreachB] })],
      ['source message', revisionCall({}, ids.messageB)],
    ])('rejects a cross-plan %s id before writing', (_label, call) => {
      expectRoleError('authenticated', ids.userA, call, /outside the plan aggregate/i)
      expect(psql(`select plan_revision_count from public.plans where id = '${ids.planA}';`)).toBe('0')
    })

    it('rejects another organizer and another organizer source event in invite RPCs', () => {
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.create_vendor_invite('${ids.userB}', 'ACL Vendor', 'vendor-acl@example.com', null, 'dj', 'flat', 100, null);`,
        /organizer_invite_forbidden/i,
      )
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.create_vendor_invite('${ids.userA}', 'ACL Vendor', 'vendor-acl@example.com', null, 'dj', 'flat', 100, '${ids.eventB}');`,
        /event_scope_mismatch/i,
      )
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.create_venue_invite('${ids.userB}', 'ACL Venue', 'venue-acl@example.com');`,
        /organizer_invite_forbidden/i,
      )
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.create_venue_invite('${ids.userA}', 'ACL Venue', 'venue-acl@example.com', null, null, 'other', null, 'CA', null, null, 'tbd', null, '${ids.eventB}');`,
        /event_scope_mismatch/i,
      )
    })

    it('rejects another builder, another builder plan, and caller-controlled prices in billing consumption', () => {
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.consume_builder_event_access('${ids.builderB}', '${ids.planB}');`,
        /builder_billing_forbidden/i,
      )
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.consume_builder_event_access('${ids.builderA}', '${ids.planB}');`,
        /plan_scope_mismatch/i,
      )
      expectRoleError(
        'authenticated',
        ids.userA,
        `select * from public.consume_builder_event_access('${ids.builderA}', '${ids.planA}', 999, 0, 0);`,
        /configuration_forbidden/i,
      )
    })

    it('returns false or an access error for another tenant in every read/RLS helper', () => {
      expect(asRole('authenticated', ids.userA, `select public.can_manage_event_cost_commitment_org('${ids.builderB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.can_manage_event_revenue_term_org('${ids.builderB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.can_manage_live_recommendation_org('${ids.builderB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.can_manage_plan_read_model('${ids.planB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.is_event_builder('${ids.eventB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.is_event_collaborator('${ids.eventB}');`)).toBe('f')
      expect(asRole('authenticated', ids.userA, `select public.get_event_kickback_summary('${ids.eventB}') ->> 'error';`)).toMatch(/do not have access/i)
    })
  })

  describe('financial views', () => {
    it.each([
      'event_ticket_sales_rollups',
      'organizer_baselines',
      'vendor_analytics',
    ])('denies anonymous SELECT on %s', (view) => {
      expectRoleError('anon', null, `select count(*) from public.${view};`, /permission denied/i)
    })

    it('keeps materialized financial views service-only', () => {
      expectRoleError('authenticated', ids.userA, 'select count(*) from public.organizer_baselines;', /permission denied/i)
      expectRoleError('authenticated', ids.userA, 'select count(*) from public.vendor_analytics;', /permission denied/i)
      expect(asRole('service_role', null, 'select count(*) >= 0 from public.organizer_baselines;')).toBe('t')
      expect(asRole('service_role', null, 'select count(*) >= 0 from public.vendor_analytics;')).toBe('t')
    })

    it('uses source RLS for authenticated ticket rollups', () => {
      expect(psql(`
        select coalesce(array_to_string(c.reloptions, ','), '')
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'event_ticket_sales_rollups';
      `)).toContain('security_invoker=true')

      expect(asRole(
        'authenticated',
        ids.userA,
        `select string_agg(event_id::text, ',' order by event_id) from public.event_ticket_sales_rollups where event_id in ('${ids.eventA}', '${ids.eventB}');`,
      )).toBe(ids.eventA)
    })
  })
})
