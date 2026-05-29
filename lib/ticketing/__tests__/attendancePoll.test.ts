jest.mock('server-only', () => ({}))

jest.mock('@/lib/server/account-setup', () => ({
  getBuilderConnectedTicketingPlatforms: jest.fn(),
}))

jest.mock('@/lib/ticketing/eventbritePoll', () => ({
  pollEventbriteCheckedInCount: jest.fn(),
}))

jest.mock('@/lib/ticketing/lumaPoll', () => ({
  pollLumaRsvpCount: jest.fn(),
}))

import { getBuilderConnectedTicketingPlatforms } from '@/lib/server/account-setup'
import { clearAttendancePollCacheForTest, pollAttendanceForPlan } from '@/lib/ticketing/attendancePoll'
import { pollEventbriteCheckedInCount } from '@/lib/ticketing/eventbritePoll'
import { pollLumaRsvpCount } from '@/lib/ticketing/lumaPoll'

type Row = Record<string, unknown>

class MemoryDb {
  rows: Record<string, Row[]> = {
    plans: [],
    builder_profiles: [],
    provider_connections: [],
    event_kickback_agreements: [],
    external_event_integrations: [],
    events: [],
    builder_ticketing_connections: [],
  }

  from(table: string) {
    return new MemoryQuery(this, table)
  }
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private limitCount: number | null = null
  private orderField: string | null = null
  private ascending = true

  constructor(private db: MemoryDb, private table: string) {}

  select(_columns = '*') {
    return this
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field
    this.ascending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    const rows = this.apply()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.apply(), error: null }).then(onfulfilled, onrejected)
  }

  private apply() {
    let rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)))
    if (this.orderField) {
      rows = [...rows].sort((first, second) => {
        const firstValue = String(first[this.orderField!] ?? '')
        const secondValue = String(second[this.orderField!] ?? '')
        return this.ascending ? firstValue.localeCompare(secondValue) : secondValue.localeCompare(firstValue)
      })
    }
    return this.limitCount === null ? rows : rows.slice(0, this.limitCount)
  }
}

describe('pollAttendanceForPlan', () => {
  const originalLumaApiKey = process.env.LUMA_API_KEY

  beforeEach(() => {
    jest.clearAllMocks()
    clearAttendancePollCacheForTest()
    process.env.LUMA_API_KEY = originalLumaApiKey
    ;(getBuilderConnectedTicketingPlatforms as jest.Mock).mockResolvedValue([])
  })

  it('polls Eventbrite checked-in attendance from a plan-scoped provider connection', async () => {
    const db = new MemoryDb()
    db.rows.plans = [{ id: 'plan-1', user_id: 'user-1', title: 'Tech Mixer', date_window_start: '2026-05-12' }]
    db.rows.builder_profiles = [{ id: 'builder-1', user_id: 'user-1' }]
    db.rows.provider_connections = [{
      provider: 'eventbrite',
      status: 'connected',
      plan_id: 'plan-1',
      external_account_id: 'eventbrite-event-1',
      encrypted_credentials: { access_token: 'eventbrite-token' },
      config: {},
      updated_at: '2026-05-12T00:00:00.000Z',
    }]
    ;(getBuilderConnectedTicketingPlatforms as jest.Mock).mockResolvedValue(['eventbrite'])
    ;(pollEventbriteCheckedInCount as jest.Mock).mockResolvedValue({
      checkedInCount: 87,
      rawResponse: { pages: 1 },
    })

    const result = await pollAttendanceForPlan(db as never, 'plan-1')

    expect(result).toMatchObject({
      source: 'eventbrite',
      attendance_count: 87,
      count_type: 'checked_in',
      confidence: 'high',
    })
    expect(pollEventbriteCheckedInCount).toHaveBeenCalledWith({
      accessToken: 'eventbrite-token',
      eventbriteEventId: 'eventbrite-event-1',
    })
  })

  it('polls Luma RSVP count from a linked legacy event integration', async () => {
    const db = new MemoryDb()
    db.rows.plans = [{ id: 'plan-2', user_id: 'user-1', title: 'Dinner Club', date_window_start: '2026-05-14' }]
    db.rows.builder_profiles = [{ id: 'builder-1', user_id: 'user-1' }]
    db.rows.event_kickback_agreements = [{ id: 'agreement-1', plan_id: 'plan-2', event_id: 'event-1' }]
    db.rows.external_event_integrations = [{
      event_id: 'event-1',
      platform: 'luma',
      external_event_id: 'luma-event-1',
      config: {},
      updated_at: '2026-05-14T00:00:00.000Z',
    }]
    process.env.LUMA_API_KEY = 'luma-key'
    ;(getBuilderConnectedTicketingPlatforms as jest.Mock).mockResolvedValue(['luma'])
    ;(pollLumaRsvpCount as jest.Mock).mockResolvedValue({
      rsvpCount: 64,
      rawResponse: { guests: [] },
    })

    const result = await pollAttendanceForPlan(db as never, 'plan-2')

    expect(result).toMatchObject({
      source: 'luma',
      attendance_count: 64,
      count_type: 'rsvp_only',
      confidence: 'medium',
    })
    expect(pollLumaRsvpCount).toHaveBeenCalledWith({
      apiKey: 'luma-key',
      eventApiId: 'luma-event-1',
    })
  })

  it('does not invent attendance for platforms without public APIs', async () => {
    const db = new MemoryDb()
    db.rows.plans = [{ id: 'plan-3', user_id: 'user-1', title: 'House Party', date_window_start: '2026-05-16' }]
    db.rows.builder_profiles = [{ id: 'builder-1', user_id: 'user-1' }]
    ;(getBuilderConnectedTicketingPlatforms as jest.Mock).mockResolvedValue(['partiful'])

    const result = await pollAttendanceForPlan(db as never, 'plan-3')

    expect(result).toMatchObject({
      source: 'partiful',
      attendance_count: null,
      count_type: 'unavailable',
      confidence: 'low',
    })
    expect(pollEventbriteCheckedInCount).not.toHaveBeenCalled()
    expect(pollLumaRsvpCount).not.toHaveBeenCalled()
  })
})
