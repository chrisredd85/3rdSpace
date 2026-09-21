import {
  buildVenueNightlyRateFields,
  ensureBuilderProfile,
  ensureVendorProfile,
} from '@/lib/server/account-setup'

describe('account setup signup persistence', () => {
  it('persists creator organizer context with optional ticketing setup', async () => {
    const upserts: Array<{ table: string; payload: Record<string, unknown> }> = []
    const db = {
      from: jest.fn((table: string) => ({
        upsert: (payload: Record<string, unknown>) => {
          upserts.push({ table, payload })
          return {
            select: () => ({
              single: async () => ({ data: { id: 'builder-1' }, error: null }),
            }),
          }
        },
      })),
    }

    await ensureBuilderProfile(db, {
      userId: 'user-1',
      name: 'Alex Rivera',
      organizationName: 'Sunset Social Club',
      organizationType: 'Community',
      socialHandle: '@sunsetsocial',
      website: 'https://sunsetsocial.example.com',
      bio: 'Recurring founder dinners.',
      eventTypes: ['Networking mixer'],
      preferredAmenities: ['Full bar'],
      ticketPlatforms: [],
      typicalAttendanceMin: 80,
      typicalAttendanceMax: 120,
      bulkBookingEnabled: true,
      inviteCollaborators: ['cohost@example.com', 'COHOST@example.com', 'bad-value'],
    })

    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      table: 'builder_profiles',
      payload: expect.objectContaining({
        organization_name: 'Sunset Social Club',
        organization_type: 'Community',
        social_handle: '@sunsetsocial',
        website: 'https://sunsetsocial.example.com',
        bio: 'Recurring founder dinners.',
        preferred_ticket_platforms: [],
        typical_attendance_min: 80,
        typical_attendance_max: 120,
        bulk_booking_enabled: true,
        invite_collaborators: ['cohost@example.com'],
      }),
    })
  })

  it('persists all selected vendor services and creates a starter package', async () => {
    const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
    const db = {
      from: jest.fn((table: string) => {
        if (table === 'vendor_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: (payload: Record<string, unknown>) => {
              inserts.push({ table, payload })
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'vendor-1' }, error: null }),
                }),
              }
            },
          }
        }

        if (table === 'vendor_packages') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            insert: async (payload: Record<string, unknown>) => {
              inserts.push({ table, payload })
              return { error: null }
            },
          }
        }

        throw new Error(`Unexpected table ${table}`)
      }),
    }

    await ensureVendorProfile(db, {
      userId: 'user-1',
      name: 'Sam Carter',
      businessName: 'DJ Solstice',
      serviceType: 'dj',
      servicesOffered: ['DJ', 'Photographer'],
      availabilityNotes: 'Available Fridays.',
      basePrice: 95.5,
      packageName: 'DJ + photo starter',
      packageDetails: 'Four hours of DJ coverage, arrival photos, and basic lighting.',
    })

    expect(inserts).toEqual([
      {
        table: 'vendor_profiles',
        payload: expect.objectContaining({
          service_type: 'dj',
          services_offered: ['DJ', 'Photographer'],
          base_rate: 9550,
        }),
      },
      {
        table: 'vendor_packages',
        payload: expect.objectContaining({
          vendor_id: 'vendor-1',
          package_name: 'DJ + photo starter',
          description: 'Four hours of DJ coverage, arrival photos, and basic lighting.',
          price: 95.5,
          inclusions: ['Four hours of DJ coverage', 'arrival photos', 'and basic lighting.'],
          display_order: 0,
        }),
      },
    ])
  })

  it('persists the venue nightly input once in integer cents', () => {
    const fields = buildVenueNightlyRateFields(95.5)

    expect(fields).toEqual({
      price_per_night_cents: 9550,
    })
    expect(fields).not.toHaveProperty('hourly_rate_cents')
    expect(fields).not.toHaveProperty('daily_rate_cents')
  })
})
