jest.mock('server-only', () => ({}))

import { updateChiRateFromSettlement } from '../chi-rate-trueup'

type QueryResult<T> = {
  data: T | null
  error: { code?: string; message?: string } | null
}

function createBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    update: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
    single: jest.fn(async () => result),
    then: jest.fn((resolve: (value: QueryResult<T>) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
    ),
  }

  return builder
}

function createQueuedDb(buildersByTable: Record<string, Array<Record<string, jest.Mock>>>) {
  return {
    from: jest.fn((table: string) => {
      const queue = buildersByTable[table]
      const builder = queue?.shift()
      if (!builder) throw new Error(`Unexpected table ${table}`)
      return builder
    }),
  }
}

const input = {
  organizerId: '00000000-0000-4000-8000-000000000001',
  archetype: 'founder_dinner',
  venueType: 'bar',
}

describe('updateChiRateFromSettlement', () => {
  it('no-ops when the future settlement_runs table does not exist yet', async () => {
    const settlementBuilder = createBuilder({
      data: null,
      error: { code: '42P01', message: 'relation "settlement_runs" does not exist' },
    })
    const db = createQueuedDb({ settlement_runs: [settlementBuilder] })

    await expect(updateChiRateFromSettlement(db as never, input)).resolves.toEqual({
      newRateCents: 0,
      supersededHistoryId: null,
    })
  })

  it('computes a weighted average from completed settlement runs', async () => {
    const settlementBuilder = createBuilder({
      data: [
        { attendance_count: 50, attendee_count: null, verified_attendees: null, total_cents: 150000, organizer_payout_cents: null },
        { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 400000, organizer_payout_cents: null },
      ],
      error: null,
    })
    const currentBuilder = createBuilder({ data: null, error: null })
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [settlementBuilder],
      chi_rate_history: [currentBuilder, insertBuilder],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toEqual({ newRateCents: 3667, supersededHistoryId: null })
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 3667,
      derived_from_event_count: 2,
    }))
  })

  it('inserts a new history row and supersedes the prior current row with an optimistic lock', async () => {
    const settlementBuilder = createBuilder({
      data: [
        { attendance_count: 10, attendee_count: null, verified_attendees: null, total_cents: 50000, organizer_payout_cents: null },
      ],
      error: null,
    })
    const currentBuilder = createBuilder({ data: { id: 'current-history' }, error: null })
    const updateBuilder = createBuilder({ data: { id: 'current-history' }, error: null })
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [settlementBuilder],
      chi_rate_history: [currentBuilder, updateBuilder, insertBuilder],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toEqual({ newRateCents: 5000, supersededHistoryId: 'current-history' })
    expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      superseded_at: expect.any(String),
    }))
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'current-history')
    expect(updateBuilder.is).toHaveBeenCalledWith('superseded_at', null)
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 5000,
    }))
  })

  it('bails when the current history row loses the optimistic lock race', async () => {
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 10, attendee_count: null, verified_attendees: null, total_cents: 50000, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [
        createBuilder({ data: { id: 'current-history' }, error: null }),
        createBuilder({ data: null, error: null }),
      ],
    })

    await expect(updateChiRateFromSettlement(db as never, input)).rejects.toThrow(
      'Current CHI rate history was updated by another request',
    )
  })

  it('is forward-only and does not modify settled event records', async () => {
    const settlementBuilder = createBuilder({
      data: [
        { attendance_count: null, attendee_count: null, verified_attendees: 25, total_cents: null, organizer_payout_cents: 100000 },
      ],
      error: null,
    })
    const currentBuilder = createBuilder({ data: null, error: null })
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [settlementBuilder],
      chi_rate_history: [currentBuilder, insertBuilder],
    })

    await updateChiRateFromSettlement(db as never, input)

    expect(settlementBuilder.update).not.toHaveBeenCalled()
    expect(settlementBuilder.insert).not.toHaveBeenCalled()
  })
})
