import type { PostgrestFilterBuilder } from '@supabase/postgrest-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface FilterConfig {
  /**
   * Filter type
   */
  type: 'equals' | 'in' | 'gte' | 'lte' | 'between' | 'ilike' | 'textSearch'
  /**
   * Column name
   */
  column: string
  /**
   * Filter value
   */
  value: string | string[] | number | [number, number] | null
}

/**
 * Build Supabase query from filter configuration
 * 
 * @param query - Supabase query builder
 * @param filters - Array of filter configurations
 * @returns Updated query builder
 * 
 * @example
 * ```tsx
 * const filters = [
 *   { type: 'equals', column: 'venue_type', value: 'loft_warehouse' },
 *   { type: 'in', column: 'city', value: ['SF', 'Oakland'] },
 *   { type: 'between', column: 'hourly_rate', value: [100, 500] },
 * ]
 * let query = supabase.from('venues').select('*')
 * query = buildFilterQuery(query, filters)
 * ```
 */
export function buildFilterQuery(
  query: PostgrestFilterBuilder<any, any, any, any>,
  filters: FilterConfig[]
): PostgrestFilterBuilder<any, any, any, any> {
  let filteredQuery = query

  filters.forEach((filter) => {
    if (filter.value === null || filter.value === undefined) return

    switch (filter.type) {
      case 'equals':
        if (typeof filter.value === 'string') {
          filteredQuery = filteredQuery.eq(filter.column, filter.value)
        }
        break

      case 'in':
        if (Array.isArray(filter.value) && filter.value.length > 0) {
          filteredQuery = filteredQuery.in(filter.column, filter.value)
        }
        break

      case 'gte':
        if (typeof filter.value === 'number') {
          filteredQuery = filteredQuery.gte(filter.column, filter.value)
        }
        break

      case 'lte':
        if (typeof filter.value === 'number') {
          filteredQuery = filteredQuery.lte(filter.column, filter.value)
        }
        break

      case 'between':
        if (Array.isArray(filter.value) && filter.value.length === 2) {
          const [min, max] = filter.value as [number, number]
          filteredQuery = filteredQuery
            .gte(filter.column, min)
            .lte(filter.column, max)
        }
        break

      case 'ilike':
        if (typeof filter.value === 'string' && filter.value.trim()) {
          filteredQuery = filteredQuery.ilike(filter.column, `%${filter.value}%`)
        }
        break

      case 'textSearch':
        if (typeof filter.value === 'string' && filter.value.trim()) {
          // For full-text search, you might need to use a different approach
          // depending on your Supabase setup (e.g., using Postgres full-text search)
          filteredQuery = filteredQuery.ilike(filter.column, `%${filter.value}%`)
        }
        break
    }
  })

  return filteredQuery
}

/**
 * Parse filters from URL search params
 * 
 * @param searchParams - URL search params
 * @returns Parsed filter values
 * 
 * @example
 * ```tsx
 * const params = new URLSearchParams(window.location.search)
 * const filters = parseFiltersFromURL(params)
 * // Returns: { venue_type: ['loft'], city: ['SF'], price_range: [100, 500] }
 * ```
 */
export function parseFiltersFromURL(
  searchParams: URLSearchParams
): Record<string, string[] | [number, number]> {
  const filters: Record<string, string[] | [number, number]> = {}

  searchParams.forEach((value, key) => {
    if (key.endsWith('_range')) {
      // Handle range filters (e.g., price_range=100-500)
      const [min, max] = value.split('-').map(Number)
      if (!isNaN(min) && !isNaN(max)) {
        filters[key] = [min, max]
      }
    } else {
      // Handle array filters (comma-separated)
      filters[key] = value.split(',').filter(Boolean)
    }
  })

  return filters
}

/**
 * Update URL with filters without page reload
 * 
 * @param filters - Filter values to set in URL
 * @param router - Next.js router (optional, for App Router)
 * 
 * @example
 * ```tsx
 * updateURLWithFilters({ venue_type: ['loft'], city: ['SF'] })
 * ```
 */
export function updateURLWithFilters(
  filters: Record<string, string[] | [number, number]>,
  router?: any
) {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams()

  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === 'number') {
        // Range filter
        params.set(key, `${value[0]}-${value[1]}`)
      } else if (value.length > 0) {
        // Array filter
        params.set(key, (value as string[]).join(','))
      }
    }
  })

  const newUrl = `${window.location.pathname}?${params.toString()}`
  
  if (router) {
    router.push(newUrl, { scroll: false })
  } else {
    window.history.pushState({}, '', newUrl)
  }
}

/**
 * Clear all filters from URL
 * 
 * @param router - Next.js router (optional)
 */
export function clearFiltersFromURL(router?: any) {
  if (typeof window === 'undefined') return

  const newUrl = window.location.pathname
  
  if (router) {
    router.push(newUrl, { scroll: false })
  } else {
    window.history.pushState({}, '', newUrl)
  }
}

/**
 * Convert filter values to FilterConfig array
 * 
 * @param filterValues - Filter values from UI
 * @param columnMap - Map of filter IDs to column names
 * @returns Array of FilterConfig
 */
export function convertFiltersToConfig(
  filterValues: Record<string, string[] | [number, number]>,
  columnMap: Record<string, string>
): FilterConfig[] {
  const configs: FilterConfig[] = []

  Object.entries(filterValues).forEach(([filterId, value]) => {
    const column = columnMap[filterId]
    if (!column || !value) return

    if (Array.isArray(value)) {
      if (value.length === 2 && typeof value[0] === 'number') {
        // Range filter
        configs.push({
          type: 'between',
          column,
          value: value as [number, number],
        })
      } else if (value.length > 0) {
        // Array filter (in)
        configs.push({
          type: 'in',
          column,
          value: value as string[],
        })
      }
    }
  })

  return configs
}
