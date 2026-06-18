jest.mock('server-only', () => ({}))
jest.mock('@sentry/nextjs', () => ({
  addBreadcrumb: jest.fn(),
}))

import * as Sentry from '@sentry/nextjs'

import { FORBIDDEN_CALCULATION_BASES } from '@/lib/finance/community-host-incentive/compliance'
import { resolveChiRate } from '../chi-rate-resolver'

type QueryResult<T> = {
  data: T | null
  error: { message?: string } | null
}

function createBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, jest.Mock> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
  }

  return builder
}

function createDb(builders: Record<string, Record<string, jest.Mock>>) {
  return {
    from: jest.fn((table: string) => {
      const builder = builders[table]
      if (!builder) throw new Error(`Unexpected table ${table}`)
      return builder
    }),
  }
}

const baseInput = {
  organizerId: '00000000-0000-4000-8000-000000000001',
  archetype: 'founder_dinner',
  venueType: 'bar',
  neighborhood: 'Mission',
}

describe('resolveChiRate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves from measured rate when the group has at least two events', async () => {
    const measuredBuilder = createBuilder({
      data: { per_attendee_cents: 4100, derived_from_event_count: 3 },
      error: null,
    })
    const networkBuilder = createBuilder({ data: null, error: null })
    const db = createDb({
      chi_rate_history: measuredBuilder,
      chi_network_defaults: networkBuilder,
    })

    const result = await resolveChiRate(db as never, baseInput)

    expect(result).toEqual({
      perAttendeeCents: 4100,
      source: 'measured',
      derivedFromEventCount: 3,
      notes: 'Using measured group CHI rate from prior settled events.',
    })
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      category: 'finance.chi_rate',
      data: expect.objectContaining({ source: 'measured' }),
    }))
  })

  it('falls back to network default when measured rate has fewer than two events', async () => {
    const measuredBuilder = createBuilder({
      data: { per_attendee_cents: 3900, derived_from_event_count: 1 },
      error: null,
    })
    const networkBuilder = createBuilder({
      data: { per_attendee_cents: 4000, sample_size: 0 },
      error: null,
    })
    const db = createDb({
      chi_rate_history: measuredBuilder,
      chi_network_defaults: networkBuilder,
    })

    const result = await resolveChiRate(db as never, baseInput)

    expect(result).toMatchObject({
      perAttendeeCents: 4000,
      source: 'network_default',
      derivedFromEventCount: 0,
    })
  })

  it('returns no_rate_available when neither measured nor network rates exist', async () => {
    const db = createDb({
      chi_rate_history: createBuilder({ data: null, error: null }),
      chi_network_defaults: createBuilder({ data: null, error: null }),
    })

    await expect(resolveChiRate(db as never, baseInput)).resolves.toEqual({
      perAttendeeCents: 0,
      source: 'no_rate_available',
      derivedFromEventCount: 0,
      notes: 'No CHI rate is available. Caller must block settlement until a rate is approved.',
    })
  })

  it('never returns non-integer cents', async () => {
    const db = createDb({
      chi_rate_history: createBuilder({
        data: { per_attendee_cents: 4100.5, derived_from_event_count: 3 },
        error: null,
      }),
      chi_network_defaults: createBuilder({ data: null, error: null }),
    })

    await expect(resolveChiRate(db as never, baseInput)).rejects.toThrow('perAttendeeCents must be a safe integer')
  })

  it('rejects forbidden calculation base inputs', async () => {
    const forbiddenBasis = Array.from(FORBIDDEN_CALCULATION_BASES)[0]
    const db = createDb({
      chi_rate_history: createBuilder({ data: null, error: null }),
      chi_network_defaults: createBuilder({ data: null, error: null }),
    })

    await expect(resolveChiRate(db as never, {
      ...baseInput,
      archetype: forbiddenBasis,
    })).rejects.toThrow('Forbidden CHI settlement basis')
  })
})
