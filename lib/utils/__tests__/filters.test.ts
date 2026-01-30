import { buildFilterQuery, parseFiltersFromURL, updateURLWithFilters, clearFiltersFromURL } from '../filters'
import type { FilterConfig } from '../filters'

// Mock Supabase query builder
const createMockQuery = () => {
  const query: any = {
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    textSearch: jest.fn().mockReturnThis(),
  }
  return query
}

describe('buildFilterQuery', () => {
  it('should apply equals filter', () => {
    const query = createMockQuery()
    const filters: FilterConfig[] = [
      { type: 'equals', column: 'venue_type', value: 'loft_warehouse' },
    ]

    buildFilterQuery(query, filters)

    expect(query.eq).toHaveBeenCalledWith('venue_type', 'loft_warehouse')
  })

  it('should apply in filter', () => {
    const query = createMockQuery()
    const filters: FilterConfig[] = [
      { type: 'in', column: 'city', value: ['SF', 'Oakland'] },
    ]

    buildFilterQuery(query, filters)

    expect(query.in).toHaveBeenCalledWith('city', ['SF', 'Oakland'])
  })

  it('should apply between filter', () => {
    const query = createMockQuery()
    const filters: FilterConfig[] = [
      { type: 'between', column: 'hourly_rate', value: [100, 500] },
    ]

    buildFilterQuery(query, filters)

    expect(query.gte).toHaveBeenCalledWith('hourly_rate', 100)
    expect(query.lte).toHaveBeenCalledWith('hourly_rate', 500)
  })

  it('should skip null values', () => {
    const query = createMockQuery()
    const filters: FilterConfig[] = [
      { type: 'equals', column: 'venue_type', value: null },
    ]

    buildFilterQuery(query, filters)

    expect(query.eq).not.toHaveBeenCalled()
  })

  it('should apply multiple filters', () => {
    const query = createMockQuery()
    const filters: FilterConfig[] = [
      { type: 'equals', column: 'venue_type', value: 'loft_warehouse' },
      { type: 'gte', column: 'capacity', value: 50 },
      { type: 'lte', column: 'hourly_rate', value: 500 },
    ]

    buildFilterQuery(query, filters)

    expect(query.eq).toHaveBeenCalledWith('venue_type', 'loft_warehouse')
    expect(query.gte).toHaveBeenCalledWith('capacity', 50)
    expect(query.lte).toHaveBeenCalledWith('hourly_rate', 500)
  })
})

describe('parseFiltersFromURL', () => {
  it('should parse filters from URL', () => {
    const params = new URLSearchParams()
    params.set('venue_type', 'loft_warehouse')
    params.set('city', 'SF')
    params.set('price_range', '100-500')

    const filters = parseFiltersFromURL(params)

    expect(filters.venue_type).toEqual(['loft_warehouse'])
    expect(filters.city).toEqual(['SF'])
    expect(filters.price_range).toEqual([100, 500])
  })
})

describe('updateURLWithFilters', () => {
  beforeEach(() => {
    // Mock window.history
    Object.defineProperty(window, 'history', {
      value: {
        pushState: jest.fn(),
      },
      writable: true,
    })
  })

  it('should update URL with filters', () => {
    const filters = {
      venue_type: ['loft_warehouse'],
      city: ['SF'],
    }

    updateURLWithFilters(filters)

    expect(window.history.pushState).toHaveBeenCalled()
  })
})

describe('clearFiltersFromURL', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'history', {
      value: {
        pushState: jest.fn(),
      },
      writable: true,
    })
  })

  it('should clear all filters', () => {
    clearFiltersFromURL()

    expect(window.history.pushState).toHaveBeenCalled()
  })
})
