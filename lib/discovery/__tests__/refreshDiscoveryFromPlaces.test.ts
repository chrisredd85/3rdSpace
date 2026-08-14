jest.mock('server-only', () => ({}))

const searchGooglePlacesTextMock = jest.fn()
const captureMessageMock = jest.fn()

jest.mock('@/lib/server/google-places-client', () => ({
  searchGooglePlacesText: (...args: unknown[]) => searchGooglePlacesTextMock(...args),
}))

jest.mock('@/lib/discovery/cascadeInvalidation', () => ({
  cascadeInvalidationForEntityChange: jest.fn(),
}))

jest.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}))

import fs from 'node:fs'
import path from 'node:path'

import {
  DISCOVERY_CHANGE_LOG_SOURCES,
  PLACES_REFRESH_CHANGE_SOURCE,
} from '@/lib/discovery/changeLogSources'
import { refreshDiscoveryEntityFromPlaces } from '@/lib/discovery/refreshDiscoveryFromPlaces'

const CONSTRAINT_SOURCES = [
  'places_refresh',
  'outreach_extraction',
  'admin_override',
  'vendor_self_update',
  'stripe_account_event',
  'organizer_report',
] as const

describe('discovery Places refresh change-log contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    searchGooglePlacesTextMock.mockResolvedValue({
      places: [{
        id: 'places/venue-places-id',
        displayName: { text: 'Mission Room' },
        formattedAddress: '100 Mission St, San Francisco, CA',
        nationalPhoneNumber: '(415) 555-0100',
        websiteUri: 'https://mission-room.example.com',
        businessStatus: 'OPERATIONAL',
        rating: 4.7,
        userRatingCount: 120,
      }],
      request: {},
    })
  })

  it('keeps the TypeScript source allowlist equal to the database CHECK list', () => {
    expect(DISCOVERY_CHANGE_LOG_SOURCES).toEqual(CONSTRAINT_SOURCES)
    expect(PLACES_REFRESH_CHANGE_SOURCE).toBe('places_refresh')

    const migration = fs.readFileSync(path.join(
      process.cwd(),
      'supabase/migrations/20260626001000_add_vendor_city_and_discovery_freshness.sql'
    ), 'utf8')
    const checkBody = migration.match(/CONSTRAINT discovery_change_source_check\s+CHECK \(source IN \(\s*([\s\S]*?)\s*\)\)/)?.[1]
    expect(checkBody).toBeDefined()
    const sqlSources = Array.from(checkBody?.matchAll(/'([^']+)'/g) ?? [], (match) => match[1])
    expect(sqlSources).toEqual(CONSTRAINT_SOURCES)
  })

  it('writes the constraint-valid places_refresh source', async () => {
    const db = createRefreshDb()

    await refreshDiscoveryEntityFromPlaces({
      supabase: db.client as any,
      entityType: 'discovery_venue',
      entityId: 'venue-1',
      apiKey: 'test-key',
    })

    expect(db.changeLogInserts).toHaveLength(1)
    expect(db.changeLogInserts[0]).toEqual(expect.objectContaining({
      source: 'places_refresh',
      field_name: 'google_rating',
    }))
    expect(CONSTRAINT_SOURCES).toContain(db.changeLogInserts[0].source as typeof CONSTRAINT_SOURCES[number])
  })

  it('alerts Sentry on the first change-log constraint violation', async () => {
    const db = createRefreshDb({
      changeLogError: {
        code: '23514',
        message: 'new row violates check constraint "discovery_change_source_check"',
      },
    })

    await refreshDiscoveryEntityFromPlaces({
      supabase: db.client as any,
      entityType: 'discovery_venue',
      entityId: 'venue-1',
      apiKey: 'test-key',
    })

    expect(captureMessageMock).toHaveBeenCalledTimes(1)
    expect(captureMessageMock).toHaveBeenCalledWith(
      'discovery_change_log_constraint',
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({
          alert_class: 'discovery_change_log_constraint',
          postgres_code: '23514',
        }),
      })
    )
  })
})

function createRefreshDb(input: {
  changeLogError?: { code: string; message: string }
} = {}) {
  const venue = {
    id: 'venue-1',
    source_external_id: 'venue-places-id',
    google_place_id: 'venue-places-id',
    name: 'Mission Room',
    address: '100 Mission St, San Francisco, CA',
    city: 'San Francisco',
    contact_phone: '(415) 555-0100',
    website: 'https://mission-room.example.com',
    business_status: 'OPERATIONAL',
    google_rating: 4.5,
    google_user_ratings_total: 120,
    last_meaningful_change_at: null,
  }
  const changeLogInserts: Array<Record<string, unknown>> = []

  const client = {
    from(table: string) {
      return new RefreshQuery(table, venue, changeLogInserts, input.changeLogError)
    },
  }

  return { client, changeLogInserts, venue }
}

class RefreshQuery {
  private operation: 'select' | 'insert' | 'update' = 'select'
  private insertPayload: Record<string, unknown> | null = null
  private updatePayload: Record<string, unknown> | null = null

  constructor(
    private readonly table: string,
    private readonly venue: Record<string, unknown>,
    private readonly changeLogInserts: Array<Record<string, unknown>>,
    private readonly changeLogError?: { code: string; message: string }
  ) {}

  select() {
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.operation = 'insert'
    this.insertPayload = payload
    this.changeLogInserts.push(payload)
    return this
  }

  update(payload: Record<string, unknown>) {
    this.operation = 'update'
    this.updatePayload = payload
    return this
  }

  eq() {
    if (this.operation === 'update' && this.table === 'discovery_venues' && this.updatePayload) {
      Object.assign(this.venue, this.updatePayload)
    }
    return this
  }

  maybeSingle() {
    if (this.operation === 'insert') {
      return Promise.resolve({
        data: this.changeLogError ? null : { id: 'change-1' },
        error: this.changeLogError ?? null,
      })
    }
    return Promise.resolve({ data: this.venue, error: null })
  }

  then(resolve: (value: { data: null; error: null }) => void) {
    resolve({ data: null, error: null })
  }
}
