import { execFileSync } from 'node:child_process'

const databaseUrl = process.env.VENDOR_RATE_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_VENDOR_RATE_DB_TESTS === '1'
const vendorId = '95000000-0000-4000-8000-000000000001'

function psql(sql: string): string {
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

function errorText(callback: () => unknown): string {
  try {
    callback()
    return ''
  } catch (error) {
    const stderr = error && typeof error === 'object'
      ? (error as { stderr?: Buffer | string }).stderr
      : null
    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
    if (typeof stderr === 'string') return stderr
    return error instanceof Error ? error.message : String(error)
  }
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

function cleanup() {
  psql(`
    delete from public.admin_audit_log
     where entity_type = 'vendor_profiles' and entity_id = '${vendorId}';
    delete from public.vendor_profiles where id = '${vendorId}';
  `)
}

function resetFixture() {
  cleanup()
  psql(`
    insert into public.vendor_profiles (
      id, user_id, name, vendor_type, pricing_model, base_rate, is_published, is_admin_seeded
    ) values (
      '${vendorId}', null, 'Atomic Repair Vendor', 'Caterer', 'flat_rate', 95.50, false, true
    );
  `)
}

function callAsServiceRole(args: {
  expected: number
  next: number | null
  action: string | null
}) {
  const nextSql = args.next === null ? 'null' : String(args.next)
  const actionSql = args.action === null ? 'null' : `'${args.action}'`
  return psql(`
    set role service_role;
    set request.jwt.claim.role = 'service_role';
    select public.repair_vendor_base_rate_atomic(
      '${vendorId}', ${args.expected}, ${nextSql}, ${actionSql}, null, '{"test":true}'::jsonb
    );
  `)
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('atomic vendor base-rate repair RPC', () => {
  beforeEach(resetFixture)
  afterAll(cleanup)

  it('updates the rate and appends exactly one audit row in the same call', () => {
    const result = JSON.parse(callAsServiceRole({
      expected: 95.5,
      next: 9550,
      action: 'vendor_base_rate_unit_repaired',
    })) as Record<string, unknown>

    expect(Number(result.after_base_rate)).toBe(9550)
    expect(result.updated).toBe(true)
    expect(psql(`select base_rate::text from public.vendor_profiles where id = '${vendorId}';`)).toBe('9550.00')
    expect(psql(`
      select count(*) from public.admin_audit_log
       where entity_type = 'vendor_profiles' and entity_id = '${vendorId}';
    `)).toBe('1')
  })

  it('rejects a stale expected value without updating or auditing', () => {
    const error = errorText(() => callAsServiceRole({
      expected: 96,
      next: 9600,
      action: 'vendor_base_rate_unit_repaired',
    }))

    expect(error).toContain('vendor_base_rate_stale')
    expect(psql(`select base_rate::text from public.vendor_profiles where id = '${vendorId}';`)).toBe('95.50')
    expect(psql(`select count(*) from public.admin_audit_log where entity_id = '${vendorId}';`)).toBe('0')
  })

  it('records an ambiguous-row review without changing its rate', () => {
    const result = JSON.parse(callAsServiceRole({
      expected: 95.5,
      next: null,
      action: 'vendor_base_rate_unit_review_required',
    })) as Record<string, unknown>

    expect(result.updated).toBe(false)
    expect(psql(`select base_rate::text from public.vendor_profiles where id = '${vendorId}';`)).toBe('95.50')
    expect(psql(`select count(*) from public.admin_audit_log where entity_id = '${vendorId}';`)).toBe('1')
  })

  it('rolls back the update when the audit insert fails', () => {
    const error = errorText(() => callAsServiceRole({
      expected: 95.5,
      next: 9550,
      action: null,
    }))

    expect(error).toMatch(/null value.*action|not-null constraint/i)
    expect(psql(`select base_rate::text from public.vendor_profiles where id = '${vendorId}';`)).toBe('95.50')
    expect(psql(`select count(*) from public.admin_audit_log where entity_id = '${vendorId}';`)).toBe('0')
  })

  it('does not grant execute privilege to application roles', () => {
    expect(psql(`
      select has_function_privilege(
        'authenticated',
        'public.repair_vendor_base_rate_atomic(uuid,numeric,integer,text,uuid,jsonb)',
        'EXECUTE'
      );
    `)).toBe('f')
    expect(psql(`
      select has_function_privilege(
        'anon',
        'public.repair_vendor_base_rate_atomic(uuid,numeric,integer,text,uuid,jsonb)',
        'EXECUTE'
      );
    `)).toBe('f')
    expect(psql(`select base_rate::text from public.vendor_profiles where id = '${vendorId}';`)).toBe('95.50')
  })
})
