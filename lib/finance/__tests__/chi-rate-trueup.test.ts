jest.mock('server-only', () => ({}))

jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: jest.fn(),
}))

import * as Sentry from '@sentry/nextjs'

import {
  reviewChiTrueupManualReview,
  updateChiRateFromSettlement,
} from '../chi-rate-trueup'

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
    gte: jest.fn(() => builder),
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
  venueId: '00000000-0000-4000-8000-000000000002',
  archetype: 'founder_dinner',
  venueType: 'bar',
  settlementRunId: '00000000-0000-4000-8000-000000000003',
}

const currentRate = {
  id: 'current-history',
  per_attendee_cents: 1000,
}

describe('updateChiRateFromSettlement', () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.CHI_TRUEUP_MAX_MOVEMENT_PCT
    delete process.env.CHI_TRUEUP_ALERT_THRESHOLD_PCT
  })

  afterAll(() => {
    warnSpy.mockRestore()
  })

  it('no-ops when the future settlement_runs table does not exist yet', async () => {
    const settlementBuilder = createBuilder({
      data: null,
      error: { code: '42P01', message: 'relation "settlement_runs" does not exist' },
    })
    const db = createQueuedDb({ settlement_runs: [settlementBuilder] })

    await expect(updateChiRateFromSettlement(db as never, input)).resolves.toEqual({
      newRateCents: 0,
      supersededHistoryId: null,
      applied: false,
      queued_for_review: false,
      manualReviewId: null,
      movementPct: null,
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

    expect(result).toEqual({
      newRateCents: 3667,
      supersededHistoryId: null,
      applied: true,
      queued_for_review: false,
      manualReviewId: null,
      movementPct: null,
    })
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 3667,
      derived_from_event_count: 2,
      movement_pct: null,
      movement_bucket: 'no-current-rate',
    }))
  })

  it('applies a 5% movement and emits warning observability', async () => {
    const settlementBuilder = createBuilder({
      data: [
        { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 105000, organizer_payout_cents: null },
      ],
      error: null,
    })
    const currentBuilder = createBuilder({ data: currentRate, error: null })
    const updateBuilder = createBuilder({ data: { id: 'current-history' }, error: null })
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [settlementBuilder],
      chi_rate_history: [currentBuilder, updateBuilder, insertBuilder],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toMatchObject({
      newRateCents: 1050,
      supersededHistoryId: 'current-history',
      applied: true,
      queued_for_review: false,
      movementPct: 0.05,
    })
    expect(warnSpy).toHaveBeenCalledWith('[CHI trueup] significant movement', expect.objectContaining({
      movement_pct: 0.05,
      chi_trueup_movement_bucket: '5-20%',
    }))
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'finance.chi_trueup',
      message: 'significant_movement',
      data: expect.objectContaining({
        chi_trueup_movement_bucket: '5-20%',
      }),
    }))
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 1050,
      movement_pct: 0.05,
      movement_bucket: '5-20%',
    }))
  })

  it('queues a 25% movement for manual review instead of applying it', async () => {
    const manualReviewBuilder = createBuilder({ data: { id: 'review-1' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 125000, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [createBuilder({ data: currentRate, error: null })],
      chi_trueup_manual_review: [manualReviewBuilder],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toMatchObject({
      newRateCents: 1250,
      supersededHistoryId: null,
      applied: false,
      queued_for_review: true,
      manualReviewId: 'review-1',
      movementPct: 0.25,
    })
    expect(manualReviewBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      organizer_id: input.organizerId,
      venue_id: input.venueId,
      current_rate_cents: 1000,
      proposed_rate_cents: 1250,
      movement_pct: 0.25,
      movement_bucket: '>20%',
      triggering_settlement_run_id: input.settlementRunId,
      reason: 'movement_cap_exceeded',
    }))
    expect(Sentry.captureMessage).toHaveBeenCalledWith('CHI trueup cap exceeded', expect.objectContaining({
      level: 'warning',
      tags: expect.objectContaining({
        chi_trueup_movement_bucket: '>20%',
      }),
    }))
  })

  it('applies movement exactly at the default 20% cap boundary', async () => {
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 120000, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [
        createBuilder({ data: currentRate, error: null }),
        createBuilder({ data: { id: 'current-history' }, error: null }),
        insertBuilder,
      ],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toMatchObject({
      newRateCents: 1200,
      supersededHistoryId: 'current-history',
      applied: true,
      queued_for_review: false,
      movementPct: 0.2,
    })
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 1200,
      movement_bucket: '5-20%',
    }))
  })

  it('uses env override caps before applying a true-up', async () => {
    process.env.CHI_TRUEUP_MAX_MOVEMENT_PCT = '0.10'
    const manualReviewBuilder = createBuilder({ data: { id: 'review-override' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 115000, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [createBuilder({ data: currentRate, error: null })],
      chi_trueup_manual_review: [manualReviewBuilder],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toMatchObject({
      applied: false,
      queued_for_review: true,
      manualReviewId: 'review-override',
      movementPct: 0.15,
    })
  })

  it('applies normally when the current rate is zero', async () => {
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 100, attendee_count: null, verified_attendees: null, total_cents: 80000, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [
        createBuilder({ data: { id: 'current-history', per_attendee_cents: 0 }, error: null }),
        createBuilder({ data: { id: 'current-history' }, error: null }),
        insertBuilder,
      ],
    })

    const result = await updateChiRateFromSettlement(db as never, input)

    expect(result).toMatchObject({
      newRateCents: 800,
      applied: true,
      queued_for_review: false,
      movementPct: null,
    })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      movement_pct: null,
      movement_bucket: 'no-current-rate',
    }))
  })

  it('applies a manually approved review through the cap bypass path', async () => {
    const reviewBuilder = createBuilder({
      data: {
        id: 'review-1',
        organizer_id: input.organizerId,
        venue_id: input.venueId,
        archetype: input.archetype,
        venue_type: input.venueType,
        proposed_rate_cents: 1250,
        derived_from_event_count: 3,
        reviewed_at: null,
      },
      error: null,
    })
    const reviewUpdateBuilder = createBuilder({ data: [{ id: 'review-1' }], error: null })
    const insertBuilder = createBuilder({ data: { id: 'new-history' }, error: null })
    const db = createQueuedDb({
      chi_trueup_manual_review: [reviewBuilder, reviewUpdateBuilder],
      chi_rate_history: [
        createBuilder({ data: currentRate, error: null }),
        createBuilder({ data: { id: 'current-history' }, error: null }),
        insertBuilder,
      ],
    })

    const result = await reviewChiTrueupManualReview(db as never, {
      reviewId: 'review-1',
      reviewerUserId: 'admin-user',
      decision: 'approve',
      reviewNotes: 'Looks correct against settlement sample.',
    })

    expect(result).toEqual({
      applied: true,
      appliedRateCents: 1250,
      supersededHistoryId: 'current-history',
    })
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      per_attendee_cents: 1250,
      derived_from_event_count: 3,
      movement_pct: 0.25,
      movement_bucket: '>20%',
    }))
    expect(reviewUpdateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({
      reviewed_by: 'admin-user',
      applied: true,
      applied_rate_cents: 1250,
      review_notes: 'Looks correct against settlement sample.',
    }))
  })

  it('bails when the current history row loses the optimistic lock race', async () => {
    const db = createQueuedDb({
      settlement_runs: [createBuilder({
        data: [
          { attendance_count: 10, attendee_count: null, verified_attendees: null, total_cents: 10500, organizer_payout_cents: null },
        ],
        error: null,
      })],
      chi_rate_history: [
        createBuilder({ data: currentRate, error: null }),
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
        { attendance_count: null, attendee_count: null, verified_attendees: 25, total_cents: null, organizer_payout_cents: 25000 },
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
