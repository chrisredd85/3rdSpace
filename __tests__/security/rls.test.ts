import { execFileSync } from 'node:child_process'

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const databaseUrl = process.env.RLS_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL
const forceRun = process.env.RUN_RLS_DB_TESTS === '1'

const ids = {
  builderUser: '10000000-0000-4000-8000-000000000001',
  otherBuilderUser: '10000000-0000-4000-8000-000000000002',
  collaboratorUser: '10000000-0000-4000-8000-000000000003',
  organizerUser: '10000000-0000-4000-8000-000000000004',
  otherOrganizerUser: '10000000-0000-4000-8000-000000000005',
  vendorUser: '10000000-0000-4000-8000-000000000006',
  otherVendorUser: '10000000-0000-4000-8000-000000000007',
  venueOwnerUser: '10000000-0000-4000-8000-000000000008',
  otherVenueOwnerUser: '10000000-0000-4000-8000-000000000009',
  planOwnerUser: '10000000-0000-4000-8000-000000000010',
  otherPlanOwnerUser: '10000000-0000-4000-8000-000000000011',
  publicVendorUser: '10000000-0000-4000-8000-000000000012',
  builderProfile: '20000000-0000-4000-8000-000000000001',
  otherBuilderProfile: '20000000-0000-4000-8000-000000000002',
  ownEvent: '30000000-0000-4000-8000-000000000001',
  otherEvent: '30000000-0000-4000-8000-000000000002',
  collaborator: '40000000-0000-4000-8000-000000000001',
  vendorProfile: '50000000-0000-4000-8000-000000000001',
  otherVendorProfile: '50000000-0000-4000-8000-000000000002',
  publicVendorProfile: '50000000-0000-4000-8000-000000000003',
  vendorBooking: '60000000-0000-4000-8000-000000000001',
  otherVendorBooking: '60000000-0000-4000-8000-000000000002',
  publishedVenue: '70000000-0000-4000-8000-000000000001',
  unpublishedVenue: '70000000-0000-4000-8000-000000000002',
  otherUnpublishedVenue: '70000000-0000-4000-8000-000000000003',
  ownPlan: '80000000-0000-4000-8000-000000000001',
  otherPlan: '80000000-0000-4000-8000-000000000002',
}

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
      if (!isTransientPostgresError(error)) {
        throw error
      }
      sleep(500)
    }
  }

  throw lastError
}

function isTransientPostgresError(error: unknown): boolean {
  const message = getCommandErrorText(error)
  return /database system is (starting up|in recovery mode)|connection .* failed|the database system is shutting down/i.test(message)
}

function getCommandErrorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: Buffer | string }).stderr
    if (Buffer.isBuffer(stderr)) return stderr.toString('utf8')
    if (typeof stderr === 'string') return stderr
  }
  return error instanceof Error ? error.message : String(error)
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function canConnect(): boolean {
  try {
    psql('select 1')
    return true
  } catch (error) {
    if (forceRun) {
      throw error
    }
    return false
  }
}

function asRole(role: 'anon' | 'authenticated' | 'service_role', userId: string | null, sql: string): string {
  const jwtRole = role === 'service_role' ? 'service_role' : role
  const sub = userId ? `set local request.jwt.claim.sub = '${userId}';` : ''
  return psql(`
    begin;
    set local role ${role};
    set local request.jwt.claim.role = '${jwtRole}';
    ${sub}
    ${sql}
    rollback;
  `)
}

function cleanupFixtures(): void {
  psql(`
    delete from public.webhook_rate_limits where rate_limit_key like 'rls-test:%';
    delete from public.vendor_bookings where id in ('${ids.vendorBooking}', '${ids.otherVendorBooking}');
    delete from public.collaborators where id = '${ids.collaborator}';
    delete from public.plans where id in ('${ids.ownPlan}', '${ids.otherPlan}');
    delete from public.events where id in ('${ids.ownEvent}', '${ids.otherEvent}');
    delete from public.venues where id in ('${ids.publishedVenue}', '${ids.unpublishedVenue}', '${ids.otherUnpublishedVenue}');
    delete from public.vendor_profiles where id in ('${ids.vendorProfile}', '${ids.otherVendorProfile}', '${ids.publicVendorProfile}');
    delete from public.builder_profiles where id in ('${ids.builderProfile}', '${ids.otherBuilderProfile}');
    delete from public.notifications where user_id in (
      '${ids.builderUser}',
      '${ids.otherBuilderUser}',
      '${ids.collaboratorUser}',
      '${ids.organizerUser}',
      '${ids.otherOrganizerUser}',
      '${ids.vendorUser}',
      '${ids.otherVendorUser}',
      '${ids.venueOwnerUser}',
      '${ids.otherVenueOwnerUser}',
      '${ids.planOwnerUser}',
      '${ids.otherPlanOwnerUser}',
      '${ids.publicVendorUser}'
    );
    delete from public.users where id in (
      '${ids.builderUser}',
      '${ids.otherBuilderUser}',
      '${ids.collaboratorUser}',
      '${ids.organizerUser}',
      '${ids.otherOrganizerUser}',
      '${ids.vendorUser}',
      '${ids.otherVendorUser}',
      '${ids.venueOwnerUser}',
      '${ids.otherVenueOwnerUser}',
      '${ids.planOwnerUser}',
      '${ids.otherPlanOwnerUser}',
      '${ids.publicVendorUser}'
    );
  `)
}

function setupFixtures(): void {
  cleanupFixtures()
  psql(`
    insert into public.users (id, email, role, user_type)
    values
      ('${ids.builderUser}', 'rls-builder@example.com', 'builder', 'community_builder'),
      ('${ids.otherBuilderUser}', 'rls-other-builder@example.com', 'builder', 'community_builder'),
      ('${ids.collaboratorUser}', 'rls-collaborator@example.com', 'builder', 'community_builder'),
      ('${ids.organizerUser}', 'rls-organizer@example.com', 'builder', 'community_builder'),
      ('${ids.otherOrganizerUser}', 'rls-other-organizer@example.com', 'builder', 'community_builder'),
      ('${ids.vendorUser}', 'rls-vendor@example.com', 'vendor', 'vendor'),
      ('${ids.otherVendorUser}', 'rls-other-vendor@example.com', 'vendor', 'vendor'),
      ('${ids.venueOwnerUser}', 'rls-venue-owner@example.com', 'owner', 'venue_owner'),
      ('${ids.otherVenueOwnerUser}', 'rls-other-venue-owner@example.com', 'owner', 'venue_owner'),
      ('${ids.planOwnerUser}', 'rls-plan-owner@example.com', 'builder', 'community_builder'),
      ('${ids.otherPlanOwnerUser}', 'rls-other-plan-owner@example.com', 'builder', 'community_builder'),
      ('${ids.publicVendorUser}', 'rls-public-vendor@example.com', 'vendor', 'vendor');

    insert into public.builder_profiles (id, user_id, name)
    values
      ('${ids.builderProfile}', '${ids.builderUser}', 'RLS Builder'),
      ('${ids.otherBuilderProfile}', '${ids.otherBuilderUser}', 'RLS Other Builder');

    insert into public.events (
      id, builder_id, event_name, event_type, event_date, start_time, end_time, duration_hours
    )
    values
      ('${ids.ownEvent}', '${ids.builderProfile}', 'RLS Own Event', 'networking', '2026-07-01', '18:00', '21:00', 3),
      ('${ids.otherEvent}', '${ids.otherBuilderProfile}', 'RLS Other Event', 'networking', '2026-07-02', '18:00', '21:00', 3);

    insert into public.collaborators (id, event_id, user_id, invited_by, role, status)
    values ('${ids.collaborator}', '${ids.ownEvent}', '${ids.collaboratorUser}', '${ids.builderUser}', 'co_organizer', 'pending');

    insert into public.vendor_profiles (id, user_id, name, vendor_type, is_published, slug)
    values
      ('${ids.vendorProfile}', '${ids.vendorUser}', 'RLS Private Vendor', 'Caterer', false, 'rls-private-vendor'),
      ('${ids.otherVendorProfile}', '${ids.otherVendorUser}', 'RLS Other Private Vendor', 'DJ / Music', false, 'rls-other-private-vendor'),
      ('${ids.publicVendorProfile}', '${ids.publicVendorUser}', 'RLS Public Vendor', 'DJ / Music', true, 'rls-public-vendor');

    insert into public.vendor_bookings (id, vendor_id, event_id, organizer_id, booking_date, status)
    values
      ('${ids.vendorBooking}', '${ids.vendorProfile}', '${ids.ownEvent}', '${ids.organizerUser}', '2026-07-01', 'pending'),
      ('${ids.otherVendorBooking}', '${ids.otherVendorProfile}', '${ids.otherEvent}', '${ids.otherOrganizerUser}', '2026-07-02', 'pending');

    insert into public.venues (id, owner_id, venue_name, venue_type, is_published, slug)
    values
      ('${ids.publishedVenue}', '${ids.venueOwnerUser}', 'RLS Published Venue', 'gallery', true, 'rls-published-venue'),
      ('${ids.unpublishedVenue}', '${ids.venueOwnerUser}', 'RLS Private Venue', 'gallery', false, 'rls-private-venue'),
      ('${ids.otherUnpublishedVenue}', '${ids.otherVenueOwnerUser}', 'RLS Other Private Venue', 'gallery', false, 'rls-other-private-venue');

    insert into public.plans (id, user_id, title)
    values
      ('${ids.ownPlan}', '${ids.planOwnerUser}', 'RLS Own Plan'),
      ('${ids.otherPlan}', '${ids.otherPlanOwnerUser}', 'RLS Other Plan');
  `)
}

const describeIfDatabase = forceRun && canConnect() ? describe : describe.skip

describeIfDatabase('RLS security baseline', () => {
  beforeAll(setupFixtures)
  afterAll(cleanupFixtures)

  describe('events', () => {
    it('lets a builder read own events but not other builders events', () => {
      expect(asRole('authenticated', ids.builderUser, `select count(*) from public.events where id = '${ids.ownEvent}';`)).toBe('1')
      expect(asRole('authenticated', ids.builderUser, `select count(*) from public.events where id = '${ids.otherEvent}';`)).toBe('0')
    })

    it('lets a collaborator read collaborated events and blocks anonymous reads', () => {
      expect(asRole('authenticated', ids.collaboratorUser, `select count(*) from public.events where id = '${ids.ownEvent}';`)).toBe('1')
      expect(asRole('anon', null, `select count(*) from public.events where id = '${ids.ownEvent}';`)).toBe('0')
    })
  })

  describe('collaborators', () => {
    it('lets a builder list event collaborators without policy recursion', () => {
      expect(asRole('authenticated', ids.builderUser, `select count(*) from public.collaborators where event_id = '${ids.ownEvent}';`)).toBe('1')
    })

    it('lets a collaborator update own status and blocks anonymous reads', () => {
      expect(asRole('authenticated', ids.collaboratorUser, `
        update public.collaborators
        set status = 'accepted'
        where id = '${ids.collaborator}'
        returning status;
      `)).toBe('accepted')
      expect(asRole('anon', null, `select count(*) from public.collaborators where event_id = '${ids.ownEvent}';`)).toBe('0')
    })
  })

  describe('vendor_bookings', () => {
    it('lets organizers and vendors read their own bookings and blocks anonymous reads', () => {
      expect(asRole('authenticated', ids.organizerUser, `select count(*) from public.vendor_bookings where id = '${ids.vendorBooking}';`)).toBe('1')
      expect(asRole('authenticated', ids.organizerUser, `select count(*) from public.vendor_bookings where id = '${ids.otherVendorBooking}';`)).toBe('0')
      expect(asRole('authenticated', ids.vendorUser, `select count(*) from public.vendor_bookings where id = '${ids.vendorBooking}';`)).toBe('1')
      expect(asRole('authenticated', ids.vendorUser, `select count(*) from public.vendor_bookings where id = '${ids.otherVendorBooking}';`)).toBe('0')
      expect(asRole('anon', null, 'select count(*) from public.vendor_bookings;')).toBe('0')
    })
  })

  describe('webhook_rate_limits', () => {
    it('denies anon and authenticated RPC calls but allows service role', () => {
      expect(() => asRole('anon', null, "select public.consume_webhook_rate_limit('rls-test:anon', 1, 60);")).toThrow()
      expect(() => asRole('authenticated', ids.builderUser, "select public.consume_webhook_rate_limit('rls-test:authenticated', 1, 60);")).toThrow()
      expect(asRole('service_role', null, "select public.consume_webhook_rate_limit('rls-test:service', 1, 60);")).toBe('t')
    })
  })

  describe('plans', () => {
    it('lets owners read own plans and blocks anonymous reads', () => {
      expect(asRole('authenticated', ids.planOwnerUser, `select count(*) from public.plans where id = '${ids.ownPlan}';`)).toBe('1')
      expect(asRole('authenticated', ids.planOwnerUser, `select count(*) from public.plans where id = '${ids.otherPlan}';`)).toBe('0')
      expect(asRole('anon', null, 'select count(*) from public.plans;')).toBe('0')
    })
  })

  describe('venues', () => {
    it('keeps published venues public and unpublished venues owner-only', () => {
      expect(asRole('anon', null, `select count(*) from public.venues where id = '${ids.publishedVenue}';`)).toBe('1')
      expect(asRole('anon', null, `select count(*) from public.venues where id = '${ids.unpublishedVenue}';`)).toBe('0')
      expect(asRole('authenticated', ids.venueOwnerUser, `select count(*) from public.venues where id = '${ids.unpublishedVenue}';`)).toBe('1')
      expect(asRole('authenticated', ids.otherVenueOwnerUser, `select count(*) from public.venues where id = '${ids.unpublishedVenue}';`)).toBe('0')
    })
  })

  describe('vendor_profiles', () => {
    it('documents existing public visibility before the vendor profile privacy follow-up', () => {
      expect(asRole('anon', null, `select count(*) from public.vendor_profiles where id = '${ids.publicVendorProfile}';`)).toBe('1')
      expect(asRole('anon', null, `select count(*) from public.vendor_profiles where id = '${ids.vendorProfile}';`)).toBe('1')
      expect(asRole('authenticated', ids.vendorUser, `select count(*) from public.vendor_profiles where id = '${ids.vendorProfile}';`)).toBe('1')
      expect(asRole('authenticated', ids.otherVendorUser, `select count(*) from public.vendor_profiles where id = '${ids.vendorProfile}';`)).toBe('1')
    })
  })
})
