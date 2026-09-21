import { execFile, execFileSync } from 'node:child_process'

const DATABASE_URL = process.env.CANONICAL_VENDOR_CLAIM_TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const forceRun = process.env.RUN_CANONICAL_VENDOR_CLAIM_DB_TESTS === '1'

const ids = {
  vendorOneUser: 'e1100000-0000-4000-8000-000000000001',
  vendorTwoUser: 'e1100000-0000-4000-8000-000000000002',
  vendorThreeUser: 'e1100000-0000-4000-8000-000000000003',
  vendorOne: 'e1200000-0000-4000-8000-000000000001',
  vendorTwo: 'e1200000-0000-4000-8000-000000000002',
  vendorThree: 'e1200000-0000-4000-8000-000000000003',
  discoveryOne: 'e1300000-0000-4000-8000-000000000001',
  discoveryTwo: 'e1300000-0000-4000-8000-000000000002',
  ambiguousDiscovery: 'e1300000-0000-4000-8000-000000000003',
  ambiguousVendorOne: 'e1200000-0000-4000-8000-000000000004',
  ambiguousVendorTwo: 'e1200000-0000-4000-8000-000000000005',
  ambiguousVendorThree: 'e1200000-0000-4000-8000-000000000006',
  concurrentDiscovery: 'e1400000-0000-4000-8000-000000000001',
  concurrentVendorOne: 'e1400000-0000-4000-8000-000000000002',
  concurrentVendorTwo: 'e1400000-0000-4000-8000-000000000003',
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
        DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql,
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
      DATABASE_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql,
    ], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }))
        return
      }
      resolve(stdout.trim())
    })
  })
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

function fixtureSql(): string {
  return `
    insert into auth.users (id, aud, role, email, created_at, updated_at)
    values
      ('${ids.vendorOneUser}', 'authenticated', 'authenticated', 'claim-vendor-one@example.com', now(), now()),
      ('${ids.vendorTwoUser}', 'authenticated', 'authenticated', 'claim-vendor-two@example.com', now(), now()),
      ('${ids.vendorThreeUser}', 'authenticated', 'authenticated', 'claim-vendor-three@example.com', now(), now());

    insert into public.users (id, email, role, user_type)
    values
      ('${ids.vendorOneUser}', 'claim-vendor-one@example.com', 'vendor', 'vendor'),
      ('${ids.vendorTwoUser}', 'claim-vendor-two@example.com', 'vendor', 'vendor'),
      ('${ids.vendorThreeUser}', 'claim-vendor-three@example.com', 'vendor', 'vendor');

    insert into public.discovery_vendors (id, source, name, service_type)
    values
      ('${ids.discoveryOne}', 'manual_seed', 'Claim Discovery One', 'catering'),
      ('${ids.discoveryTwo}', 'manual_seed', 'Claim Discovery Two', 'photography');

    insert into public.vendor_profiles (id, user_id, name, vendor_type)
    values
      ('${ids.vendorOne}', '${ids.vendorOneUser}', 'Claim Vendor One', 'Caterer'),
      ('${ids.vendorTwo}', '${ids.vendorTwoUser}', 'Claim Vendor Two', 'Photographer');
  `
}

function asAuthenticated(userId: string, sql: string): string {
  return `
    set local role authenticated;
    set local request.jwt.claim.role = 'authenticated';
    set local request.jwt.claim.sub = '${userId}';
    ${sql}
    reset role;
  `
}

function asService(sql: string): string {
  return `
    set local role service_role;
    set local request.jwt.claim.role = 'service_role';
    ${sql}
    reset role;
  `
}

function transaction(sql: string): string {
  return `
    begin;
    ${fixtureSql()}
    ${sql}
    rollback;
  `
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

function cleanupConcurrentFixtures(): void {
  psql(`
    delete from public.vendor_profiles
    where id in ('${ids.concurrentVendorOne}', '${ids.concurrentVendorTwo}');
    delete from public.discovery_vendors where id = '${ids.concurrentDiscovery}';
  `)
}

describeIfDatabase('realized canonical discovery-vendor claim binding', () => {
  it('prevents an authenticated vendor from claiming a readable discovery vendor id', () => {
    expect(() => psql(transaction(asAuthenticated(ids.vendorOneUser, `
      update public.vendor_profiles
      set discovery_vendor_id = '${ids.discoveryOne}'
      where id = '${ids.vendorOne}';
    `)))).toThrow(/vendor_profile_discovery_claim_requires_service_command/)
  })

  it('blocks browser inserts, clears, and rebinding while preserving null-link signup', () => {
    expect(() => psql(transaction(asAuthenticated(ids.vendorThreeUser, `
      insert into public.vendor_profiles (
        id, user_id, name, vendor_type, discovery_vendor_id
      ) values (
        '${ids.vendorThree}', '${ids.vendorThreeUser}', 'Browser Claim Vendor',
        'Caterer', '${ids.discoveryOne}'
      );
    `)))).toThrow(/vendor_profile_discovery_claim_requires_service_command/)

    expect(psql(transaction(asService(`
      insert into public.vendor_profiles (id, user_id, name, vendor_type)
      values (
        '${ids.vendorThree}', '${ids.vendorThreeUser}', 'Service Null Link Vendor', 'Caterer'
      )
      returning (discovery_vendor_id is null)::text;
    `)))).toBe('true')

    for (const discoveryVendorSql of ['null', `'${ids.discoveryTwo}'`]) {
      expect(() => psql(transaction(`
        ${asService(`
          select public.bind_discovery_vendor_claim(
            '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
          );
        `)}
        ${asAuthenticated(ids.vendorOneUser, `
          update public.vendor_profiles
          set discovery_vendor_id = ${discoveryVendorSql}
          where id = '${ids.vendorOne}';
        `)}
      `))).toThrow(/vendor_profile_discovery_claim_is_immutable/)
    }
  })

  it('binds once through the service command and returns the exact replay', () => {
    const result = psql(transaction(asService(`
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      ) ->> 'existing';
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      ) ->> 'existing';
      select count(*)::text || '|' ||
        (select (discovery_vendor_id = '${ids.discoveryOne}')::text
         from public.vendor_profiles where id = '${ids.vendorOne}')
      from public.discovery_vendor_claims
      where discovery_vendor_id = '${ids.discoveryOne}'
        and vendor_profile_id = '${ids.vendorOne}';
    `)))

    expect(result.split('\n')).toEqual(['false', 'true', '1|true'])
  })

  it('refuses discovery collisions and physical-profile rebinding', () => {
    expect(() => psql(transaction(asService(`
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      );
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorTwo}', '${ids.vendorTwoUser}'
      );
    `)))).toThrow(/bind_discovery_vendor_claim_(collision|legacy_collision)/)

    expect(() => psql(transaction(asService(`
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      );
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryTwo}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      );
    `)))).toThrow(/bind_discovery_vendor_claim_rebind_forbidden/)
  })

  it('keeps both the profile link and authoritative claim immutable', () => {
    expect(() => psql(transaction(asService(`
      select public.bind_discovery_vendor_claim(
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
      );
      update public.vendor_profiles
      set discovery_vendor_id = '${ids.discoveryTwo}'
      where id = '${ids.vendorOne}';
    `)))).toThrow(/vendor_profile_discovery_claim_is_immutable/)

    expect(() => psql(transaction(`
      ${asService(`
        select public.bind_discovery_vendor_claim(
          '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}'
        );
      `)}
      update public.discovery_vendor_claims
      set vendor_profile_id = '${ids.vendorTwo}'
      where discovery_vendor_id = '${ids.discoveryOne}';
    `))).toThrow(/discovery_vendor_claim_is_immutable/)
  })

  it('denies direct service DML against both authority tables', () => {
    expect(() => psql(transaction(asService(`
      insert into public.discovery_vendor_claims (
        discovery_vendor_id, vendor_profile_id, bound_by, binding_source
      ) values (
        '${ids.discoveryOne}', '${ids.vendorOne}', '${ids.vendorOneUser}', 'service_command'
      );
    `)))).toThrow(/permission denied for table discovery_vendor_claims/)

    expect(() => psql(transaction(asService(`
      insert into public.canonical_booking_partner_bindings (
        plan_id, agent_action_id, approval_id, booking_kind,
        discovery_partner_id, physical_partner_id, approval_snapshot_hash
      ) values (
        null, null, null, 'vendor', '${ids.discoveryOne}', '${ids.vendorOne}', 'forged'
      );
    `)))).toThrow(/permission denied for table canonical_booking_partner_bindings/)
  })

  it('keeps ambiguous legacy links unauthoritative on the service profile-trigger path', () => {
    expect(() => psql(transaction(`
      insert into public.discovery_vendors (id, source, name, service_type)
      values (
        '${ids.ambiguousDiscovery}', 'manual_seed', 'Ambiguous Legacy Vendor', 'catering'
      );

      alter table public.vendor_profiles
        disable trigger protect_vendor_profile_discovery_claim_link_trigger;
      alter table public.vendor_profiles
        disable trigger sync_vendor_profile_discovery_claim_link_trigger;
      insert into public.vendor_profiles (
        id, name, vendor_type, discovery_vendor_id, is_admin_seeded, claim_status
      ) values
        (
          '${ids.ambiguousVendorOne}', 'Ambiguous Legacy One', 'Caterer',
          '${ids.ambiguousDiscovery}', true, 'invited_unclaimed'
        ),
        (
          '${ids.ambiguousVendorTwo}', 'Ambiguous Legacy Two', 'Caterer',
          '${ids.ambiguousDiscovery}', true, 'invited_unclaimed'
        );
      alter table public.vendor_profiles
        enable trigger protect_vendor_profile_discovery_claim_link_trigger;
      alter table public.vendor_profiles
        enable trigger sync_vendor_profile_discovery_claim_link_trigger;

      ${asService(`
        insert into public.vendor_profiles (
          id, name, vendor_type, discovery_vendor_id, is_admin_seeded, claim_status
        ) values (
          '${ids.ambiguousVendorThree}', 'Attempted Authority', 'Caterer',
          '${ids.ambiguousDiscovery}', true, 'invited_unclaimed'
        );
      `)}
    `))).toThrow(/vendor_profile_discovery_claim_legacy_collision/)
  })

  it('serializes concurrent claims so exactly one physical profile wins', async () => {
    cleanupConcurrentFixtures()
    psql(`
      insert into public.discovery_vendors (id, source, name, service_type)
      values (
        '${ids.concurrentDiscovery}', 'manual_seed', 'Concurrent Claim Vendor', 'catering'
      );
      insert into public.vendor_profiles (
        id, name, vendor_type, is_admin_seeded, claim_status
      ) values
        (
          '${ids.concurrentVendorOne}', 'Concurrent Vendor One', 'Caterer',
          true, 'invited_unclaimed'
        ),
        (
          '${ids.concurrentVendorTwo}', 'Concurrent Vendor Two', 'Caterer',
          true, 'invited_unclaimed'
        );
    `)

    try {
      const calls = [ids.concurrentVendorOne, ids.concurrentVendorTwo].map((vendorId) => psqlAsync(`
        begin;
        set local role service_role;
        set local request.jwt.claim.role = 'service_role';
        set local statement_timeout = '10s';
        select public.bind_discovery_vendor_claim(
          '${ids.concurrentDiscovery}', '${vendorId}', null
        ) ->> 'vendor_profile_id';
        commit;
      `))
      const results = await Promise.allSettled(calls)
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(errorText((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason))
        .toMatch(/bind_discovery_vendor_claim_(legacy_)?collision/)
      expect(psql(`
        select count(*)::text || '|' ||
          (select count(*)::text from public.vendor_profiles
           where discovery_vendor_id = '${ids.concurrentDiscovery}')
        from public.discovery_vendor_claims
        where discovery_vendor_id = '${ids.concurrentDiscovery}';
      `)).toBe('1|1')
    } finally {
      cleanupConcurrentFixtures()
    }
  })
})
